/*
 * Bindings for Skia's PDF and SVG backends, which npm's CanvasKit leaves out, and for reading text as
 * shapes:
 *
 * - PDFDocument and SVGDocument each hand out an ordinary CanvasKit Canvas, so the same drawing code
 *   that draws on a surface draws into the file.
 * - DrawTextAsPaths(canvas, picture, keepColourGlyphs) plays a picture onto a canvas with its text
 *   drawn as the glyphs' outlines in the text's own paint, every positioning included (turned,
 *   RSXform glyphs too), for text a PDF must not hold twice. A glyph with no outline (a colour
 *   emoji) is passed on to the canvas as text, in its place, when keepColourGlyphs is set, and
 *   dropped otherwise.
 * - GlyphOutlines(picture) gives the outlines of every glyph a picture draws, placed as drawn (every
 *   positioning and the canvas's matrix), as one Path; everything else the picture draws is ignored.
 */

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkDocument.h"
#include "include/core/SkDrawable.h"
#include "include/core/SkFont.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkPicture.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRSXform.h"
#include "include/core/SkRect.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkStream.h"
#include "include/core/SkString.h"
#include "include/core/SkTextBlob.h"
#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"
#include "include/encode/SkPngEncoder.h"
#include "include/svg/SkSVGCanvas.h"
#include "include/utils/SkNWayCanvas.h"
#include "include/utils/SkNoDrawCanvas.h"
#include "src/core/SkTextBlobPriv.h"

#include <emscripten.h>
#include <emscripten/bind.h>

#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace emscripten;

namespace {

val bytesOf(SkDynamicMemoryWStream& stream) {
    sk_sp<SkData> data = stream.detachAsData();
    // slice() copies the bytes out of wasm memory before the data is freed.
    return val(typed_memory_view(data->size(), data->bytes())).call<val>("slice");
}

struct PDFOptions {
    std::string title;
    std::string author;
    std::string creator;
    std::string producer;
    std::string lang;
    float rasterDPI;
    int encodingQuality;
};

class PDFDocument {
public:
    explicit PDFDocument(const PDFOptions& options) {
        SkPDF::Metadata metadata = SkPDF::JPEG::MetadataWithCallbacks();
        metadata.fTitle = SkString(options.title.c_str());
        metadata.fAuthor = SkString(options.author.c_str());
        metadata.fCreator = SkString(options.creator.c_str());
        metadata.fProducer = SkString(options.producer.c_str());
        metadata.fLang = SkString(options.lang.c_str());
        metadata.fRasterDPI = options.rasterDPI;
        metadata.fEncodingQuality = options.encodingQuality;
        fDocument = SkPDF::MakeDocument(&fStream, metadata);
    }

    SkCanvas* beginPage(float width, float height) {
        return fDocument ? fDocument->beginPage(width, height) : nullptr;
    }

    void endPage() {
        if (fDocument) {
            fDocument->endPage();
        }
    }

    val close() {
        if (!fDocument) {
            return val::null();
        }
        fDocument->close();
        fDocument = nullptr;
        return bytesOf(fStream);
    }

private:
    SkDynamicMemoryWStream fStream;
    sk_sp<SkDocument> fDocument;
};

bool encodePng(SkWStream* dst, const SkPixmap& src) {
    return SkPngEncoder::Encode(dst, src, SkPngEncoder::Options());
}

class SVGDocument {
public:
    SVGDocument(float width, float height, uint32_t flags) {
        SkSVGCanvas::Options options;
        options.flags = static_cast<SkSVGCanvas::Flags>(flags);
        options.pngEncoder = encodePng;
        fCanvas = SkSVGCanvas::Make(SkRect::MakeWH(width, height), &fStream, options);
    }

    SkCanvas* canvas() { return fCanvas.get(); }

    val close() {
        if (!fCanvas) {
            return val::null();
        }
        // The SVG is only complete once its canvas is gone.
        fCanvas.reset();
        return bytesOf(fStream);
    }

private:
    SkDynamicMemoryWStream fStream;
    std::unique_ptr<SkCanvas> fCanvas;
};

// Wide enough that nothing drawn is ever cut by a canvas's own bounds.
constexpr int kReach = 1 << 20;

// Adds the outline of every glyph a text blob draws at origin to outlines, each placed as the blob
// places it: moved to its position, or moved, turned and scaled by its RSXform. A glyph with no
// outline (a colour emoji) goes into noOutlines, in its place, when it is given, and is dropped
// otherwise.
void addGlyphOutlines(const SkTextBlob* blob, SkPoint origin, SkPathBuilder* outlines,
                      SkTextBlobBuilder* noOutlines) {
    for (SkTextBlobRunIterator run(blob); !run.done(); run.next()) {
        const SkFont& font = run.font();
        const size_t count = run.glyphCount();
        const SkGlyphID* glyphs = run.glyphs();
        const SkPoint offset = run.offset() + origin;
        const bool turned = run.positioning() == SkTextBlobRunIterator::kRSXform_Positioning;
        std::vector<SkPoint> at(count);
        std::vector<SkRSXform> xforms;
        switch (run.positioning()) {
            case SkTextBlobRunIterator::kDefault_Positioning:
                font.getPos({glyphs, count}, at, offset);
                break;
            case SkTextBlobRunIterator::kHorizontal_Positioning:
                for (size_t i = 0; i < count; ++i) {
                    at[i] = SkPoint::Make(offset.x() + run.pos()[i], offset.y());
                }
                break;
            case SkTextBlobRunIterator::kFull_Positioning:
                for (size_t i = 0; i < count; ++i) {
                    at[i] = offset + run.points()[i];
                }
                break;
            case SkTextBlobRunIterator::kRSXform_Positioning:
                xforms.resize(count);
                for (size_t i = 0; i < count; ++i) {
                    SkRSXform xform = run.xforms()[i];
                    xform.fTx += offset.x();
                    xform.fTy += offset.y();
                    xforms[i] = xform;
                }
                break;
        }
        std::vector<size_t> unshaped;
        for (size_t i = 0; i < count; ++i) {
            if (std::optional<SkPath> glyph = font.getPath(glyphs[i])) {
                if (turned) {
                    outlines->addPath(*glyph, SkMatrix().setRSXform(xforms[i]));
                } else {
                    outlines->addPath(*glyph, at[i].x(), at[i].y());
                }
            } else if (noOutlines) {
                unshaped.push_back(i);
            }
        }
        if (unshaped.empty()) {
            continue;
        }
        const int kept = static_cast<int>(unshaped.size());
        if (turned) {
            const SkTextBlobBuilder::RunBuffer& buffer = noOutlines->allocRunRSXform(font, kept);
            for (int k = 0; k < kept; ++k) {
                buffer.glyphs[k] = glyphs[unshaped[k]];
                buffer.xforms()[k] = xforms[unshaped[k]];
            }
        } else {
            const SkTextBlobBuilder::RunBuffer& buffer = noOutlines->allocRunPos(font, kept);
            for (int k = 0; k < kept; ++k) {
                buffer.glyphs[k] = glyphs[unshaped[k]];
                buffer.points()[k] = at[unshaped[k]];
            }
        }
    }
}

// Passes every draw on to its target canvas, except text, which it draws as the glyphs' outlines
// with the text's own paint, so a stroked paint strokes them. A glyph with no outline is passed on
// as text when keepColourGlyphs is set, and dropped otherwise.
class TextAsPathsCanvas final : public SkNWayCanvas {
public:
    TextAsPathsCanvas(SkCanvas* target, bool keepColourGlyphs)
            : SkNWayCanvas(kReach, kReach), fKeepColourGlyphs(keepColourGlyphs) {
        this->addCanvas(target);
    }

protected:
    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y, const SkPaint& paint) override {
        SkPathBuilder outlines;
        SkTextBlobBuilder colourGlyphs;
        addGlyphOutlines(blob, SkPoint::Make(x, y), &outlines,
                         fKeepColourGlyphs ? &colourGlyphs : nullptr);
        this->drawPath(outlines.detach(), paint);
        if (sk_sp<SkTextBlob> kept = colourGlyphs.make()) {
            this->SkNWayCanvas::onDrawTextBlob(kept.get(), 0, 0, paint);
        }
    }

private:
    const bool fKeepColourGlyphs;
};

void drawTextAsPaths(SkCanvas* target, sk_sp<SkPicture> picture, bool keepColourGlyphs) {
    if (!target || !picture) {
        return;
    }
    TextAsPathsCanvas canvas(target, keepColourGlyphs);
    picture->playback(&canvas);
}

// Draws nothing; keeps the outline of every glyph drawn on it, placed by the canvas's matrix, and
// plays the pictures and drawables drawn on it, so their glyphs are kept too.
class GlyphOutlinesCanvas final : public SkNoDrawCanvas {
public:
    GlyphOutlinesCanvas() : SkNoDrawCanvas(kReach, kReach) {}

    SkPath detach() { return fOutlines.detach(); }

protected:
    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y, const SkPaint&) override {
        SkPathBuilder glyphs;
        addGlyphOutlines(blob, SkPoint::Make(x, y), &glyphs, nullptr);
        fOutlines.addPath(glyphs.detach(), this->getTotalMatrix());
    }

    void onDrawPicture(const SkPicture* picture, const SkMatrix* matrix, const SkPaint*) override {
        SkAutoCanvasRestore restore(this, true);
        if (matrix) {
            this->concat(*matrix);
        }
        picture->playback(this);
    }

    void onDrawDrawable(SkDrawable* drawable, const SkMatrix* matrix) override {
        drawable->draw(this, matrix);
    }

private:
    SkPathBuilder fOutlines;
};

SkPath glyphOutlines(sk_sp<SkPicture> picture) {
    if (!picture) {
        return SkPath();
    }
    GlyphOutlinesCanvas canvas;
    picture->playback(&canvas);
    return canvas.detach();
}

}  // namespace

EMSCRIPTEN_BINDINGS(VectorDocuments) {
    value_object<PDFOptions>("PDFOptions")
            .field("title", &PDFOptions::title)
            .field("author", &PDFOptions::author)
            .field("creator", &PDFOptions::creator)
            .field("producer", &PDFOptions::producer)
            .field("lang", &PDFOptions::lang)
            .field("rasterDPI", &PDFOptions::rasterDPI)
            .field("encodingQuality", &PDFOptions::encodingQuality);

    class_<PDFDocument>("PDFDocument")
            .constructor<const PDFOptions&>()
            .function("beginPage", &PDFDocument::beginPage, allow_raw_pointers())
            .function("endPage", &PDFDocument::endPage)
            .function("close", &PDFDocument::close);

    class_<SVGDocument>("SVGDocument")
            .constructor<float, float, uint32_t>()
            .function("canvas", &SVGDocument::canvas, allow_raw_pointers())
            .function("close", &SVGDocument::close);

    function("DrawTextAsPaths", &drawTextAsPaths, allow_raw_pointers());
    function("GlyphOutlines", &glyphOutlines);

    constant("SVG_CONVERT_TEXT_TO_PATHS", static_cast<uint32_t>(SkSVGCanvas::kConvertTextToPaths_Flag));
    constant("SVG_NO_PRETTY_XML", static_cast<uint32_t>(SkSVGCanvas::kNoPrettyXML_Flag));
    constant("SVG_RELATIVE_PATH_ENCODING", static_cast<uint32_t>(SkSVGCanvas::kRelativePathEncoding_Flag));
}
