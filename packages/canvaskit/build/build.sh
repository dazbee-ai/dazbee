#!/usr/bin/env bash
# Builds CanvasKit from the pinned Skia commit (the one npm's canvaskit-wasm 0.42.0 came from), as npm's
# full build plus Skia's PDF and SVG backends and our bindings for them. Writes canvaskit.js and
# canvaskit.wasm into the directory given. Runs on Linux; Skia's checkout lives in SKIA_DIR.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "${1:?usage: build.sh <output directory>}")
skia=${SKIA_DIR:-$here/../.skia}
commit=$(cat "$here/skia-commit")

if [ ! -d "$skia/.git" ]; then
  git init -q "$skia"
  git -C "$skia" remote add origin https://github.com/google/skia.git
fi
git -C "$skia" fetch -q --depth 1 origin "$commit"
git -C "$skia" checkout -q --force FETCH_HEAD
git -C "$skia" clean -q -fdx -e out -e third_party/externals -e bin/gn -e third_party/ninja
cd "$skia"
python3 tools/git-sync-deps

cp "$here/vector_bindings.cpp" modules/canvaskit/
sed -i 's|^    "canvaskit_bindings.cpp",$|    "canvaskit_bindings.cpp",\n    "vector_bindings.cpp",|' modules/canvaskit/BUILD.gn
grep -q '"vector_bindings.cpp"' modules/canvaskit/BUILD.gn
# The text style's baseline shift (SkParagraph's TextStyle::setBaselineShift, in pixels, down is
# positive), which npm's bindings leave out: a field of the style, 0 when not given.
sed -i -e 's|^    SkScalar wordSpacing;$|&\n    SkScalar baselineShift;|' \
  -e 's|^    ts.setHalfLeading(s.halfLeading);$|&\n    ts.setBaselineShift(s.baselineShift);|' \
  -e 's|^        .field("wordSpacing",           &SimpleTextStyle::wordSpacing)$|&\n        .field("baselineShift",         \&SimpleTextStyle::baselineShift)|' \
  modules/canvaskit/paragraph_bindings.cpp
sed -i -e "s#^      s\['wordSpacing'\] = s\['wordSpacing'\] || 0;\$#&\n      s['baselineShift'] = s['baselineShift'] || 0;#" \
  modules/canvaskit/paragraph.js
test "$(grep -c 'baselineShift' modules/canvaskit/paragraph_bindings.cpp)" -eq 3
grep -q "^      s\['baselineShift'\] = s\['baselineShift'\] || 0;\$" modules/canvaskit/paragraph.js
# The shift moves a run's glyphs, underline and strikethrough, never its line's height: SkParagraph
# adds it to the run's ascent and descent twice (calculateMetrics and the accessors), which would
# make a line with a raised or lowered run taller.
sed -i -e '/^    \/\/ If we shift the baseline we need to make sure the shifted text fits the line$/d' \
  -e '/^    fCorrectAscent += fBaselineShift;$/d' -e '/^    fCorrectDescent += fBaselineShift;$/d' \
  modules/skparagraph/src/Run.cpp
sed -i -e 's#^\(    SkScalar \(correctAscent\|correctDescent\|ascent\|descent\)() const { return f[A-Za-z.]*\) + fBaselineShift; }$#\1; }#' \
  modules/skparagraph/src/Run.h
test "$(grep -c 'fBaselineShift;$' modules/skparagraph/src/Run.cpp)" -eq 0
test "$(grep -c 'scent() const { return .* + fBaselineShift; }' modules/skparagraph/src/Run.h)" -eq 0
# PDF on, and expat (built from source, like the other libraries) for Skia's SVG writer; the Android
# font manager expat would also switch on stays off.
sed -i -e 's|skia_enable_pdf=false|skia_enable_pdf=true skia_enable_fontmgr_android=false skia_use_system_expat=false|' \
  -e 's|^USE_EXPAT="false"$|USE_EXPAT="true"|' modules/canvaskit/compile.sh
grep -q 'skia_enable_pdf=true' modules/canvaskit/compile.sh
grep -q '^USE_EXPAT="true"$' modules/canvaskit/compile.sh

# shellcheck disable=SC1091
source third_party/externals/emsdk/emsdk_env.sh
# npm's full build is compile.sh with no options (see modules/canvaskit/Makefile, target npm).
./modules/canvaskit/compile.sh release

mkdir -p "$out"
cp out/canvaskit_wasm/canvaskit.js out/canvaskit_wasm/canvaskit.wasm "$out"
