// What `startEditor` is given and what it resolves to: the open editor, its options and the events
// it tells the page of; and what `startViewer` is given and resolves to: a version shown read-only.
import type { ReadVersion } from '@dazbee/doc'
import type { ExportedFile } from '@dazbee/export'
import type { Design, DesignAi, ExportRequestInput, Member, Point, Rect, SyncToken, Variables } from '@dazbee/schema'

import type {
  AiStart,
  BriefRequest,
  BriefStarted,
  EditorAi,
  MoreLikeRequest,
  RefineRequest,
  SizesRequest,
} from './ai/arrivals.ts'
import type { Spot } from './canvas/view.ts'
import type { CoreOptions, EditorBase } from './core-interface.ts'
import type { LayerAt } from './gestures/pointer.ts'
import type { SvgRead } from './place-svg.ts'
import type { PlacedAsset, PlaceImageOptions } from './tools.ts'

export type {
  CoreOptions,
  DrawInfo,
  FontCheck,
  Notice,
  NoticeDetail,
  NoticeDetails,
  Refusal,
} from './core-interface.ts'

export interface EditorOptions extends CoreOptions {
  canvas: HTMLCanvasElement
  /** Holds the selection outline and the caret, laid over the canvas at the same size. */
  overlay: HTMLElement
  /** The name of the stage field, which takes the system's text for the text being edited, in the page's words. */
  typingFieldLabel: string
  syncUrl: string
  /** The member the page opened the design as: the tab copies it takes up are theirs (D9, C44). */
  member: Member
  /**
   * A sync token for the design and when it expires, fetched again whenever the editor (re)connects
   * (#34) and whenever the sync server asks for a fresh one; null when the API says the member may
   * not have the design, after which the editor asks no more.
   */
  syncToken: () => Promise<SyncToken | null>
  /** The brand kit's values that bound properties take (#53), until `setVariables` changes them. */
  variables?: Variables
  /** Aborting it while the editor is still connecting stops it, freeing what it made. */
  signal?: AbortSignal
  /** The AI flow's routes: without them, no brief starts and no AI result arrives. */
  ai?: EditorAi
}

/**
 * The open editor that `startEditor` resolves to: everything it makes is freed by `destroy`.
 * Beside the base's members it has the ones that take or give a point, each in client coordinates,
 * and the page's own.
 */
export interface Editor extends EditorBase {
  /**
   * Picks what a right-click at `client` (client coordinates) acts on: the selection when the point
   * is on it, else the layer there, selected, locked or not. Returns the selected layers, none when
   * the point is on no layer.
   */
  selectAt(client: Point): string[]
  /**
   * Every layer that shows at `client` (client coordinates), front-most first, each before the
   * layers it holds there with how deep it is, locked ones too: what the right-click's Select layer
   * lists. None off every frame.
   */
  layersAt(client: Point): LayerAt[]
  /** The section whose outline line is at `client` (client coordinates), the newer where two are: what a right-click there acts on; null for none. */
  sectionAt(client: Point): string | null
  /** The connector drawn at `client` (client coordinates) off every frame, the last by order where several are: what a right-click there acts on; null for none. */
  connectorAt(client: Point): string | null
  /**
   * Places an image asset as a graphic filled with it (#52), in one undo step: centred on `where`,
   * a spot or a point in client coordinates, or else in the middle of the frame in the middle of
   * the view. The image's bytes load in the background. As the brand's logo (`logo`), it has the
   * role logo and its picture follows the brand's. Returns the new layer's id, or null when the
   * point is on no frame.
   */
  placeImage(asset: PlacedAsset, where?: Point | Spot, options?: PlaceImageOptions): string | null
  /**
   * Reads an SVG file to place with `placeSvg`, centred on `where`, a spot or a point in client
   * coordinates, or else in the middle of the frame in view: the spot first, so a pan while its
   * pictures upload doesn't move it, then the file and its pictures, uploaded with `uploadImage`.
   * Null when there is no frame, or the file can't be read, which is told.
   */
  readSvg(text: string, name: string, where?: Point | Spot): Promise<SvgRead | null>
  /** The spot under a point on screen, in client coordinates: the frame there and the point in it. Null off every frame. */
  spotAt(client: Point): Spot | null
  /**
   * Outlines the layer an image dragged over the stage at `client` (client coordinates) would go
   * into, or clears the outline with null. Returns that layer's id, or null where a drop makes a
   * new layer.
   */
  imageTarget(client: Point | null): string | null
  /**
   * Copies the selected layers as Mod+C does, from a menu: kept on this device for Paste, and
   * their names as plain text on the clipboard, which a Mod+V elsewhere matches to the kept copy.
   * False with nothing to copy.
   */
  copyLayers(): boolean
  /**
   * Copy as PNG, as Mod+Shift+C, a menu or Quick actions asks: the picked frame, or the selected
   * layers alone, drawn at 2x (1x when 2x is too big) by the PNG export, on the system clipboard as
   * an image. Call it from the key or the click itself, which lets the page write the clipboard. The
   * page hears `pngCopied`, or `pngNotCopied` with why. False with nothing to copy.
   */
  copyPng(): boolean
  /**
   * Where the selection is drawn on the stage, in pixels from the stage's top start corner: the
   * upright box round it, turned or not, and its size label under or over it. Null with nothing
   * selected.
   */
  selectionRect(): Rect | null
  /**
   * Where a frame's label is drawn on the stage, in pixels from the stage's top start corner; null
   * for a frame the shown page lacks, or one off the stage at its start.
   */
  labelRect(frameId: string): Rect | null
  /**
   * Pans, at the same zoom, so a frame of the shown page shows whole with its label clear of the
   * chrome, unless it does already. Given `panel`, a panel floating over the stage at its place on
   * the page, only a frame that lies under it moves, and out from under it.
   */
  showFrame(frameId: string, panel?: Rect): void
  /** Where a design pixel of a frame of the shown page is on screen now, in client coordinates; its first frame by default. */
  screenPoint(x: number, y: number, frameId?: string): Point
  /** Resolves once what the screen shows is up to date: after the pending redraw, if there is one. */
  drawn: () => Promise<void>
  /**
   * Exports the frames a request names, as this tab holds the design now, drawn in the export
   * worker so the stage stays responsive (#55). One file comes as itself, more as one zip.
   */
  exportFiles(request: ExportRequestInput, progress?: (done: number, total: number) => void): Promise<ExportedFile>
  /** Whether everything of this tab's is stored on the sync server (C34): nothing queued, owed or open. */
  synced: () => boolean
  /** Resolves once the tab copy holds what is due now: a check in the browser waits for it before a reload. */
  keptOnDevice: () => Promise<void>
  /**
   * Version `id` of the design, fetched from the sync server over the tab's connection and read by
   * `readVersion`: its design and the parts the read left out; null for no such version. Rejects
   * with `VersionUnanswered` while the tab is not connected, or when the connection ends first.
   */
  fetchVersion(id: string): Promise<ReadVersion | null>
  /**
   * Pauses the editor's keys and its copy, cut and paste, which it hears on the whole window, while a
   * version is viewed over it: each is left to the page and the browser. Typing ends and the keys held
   * are let go as it pauses. Gives what resumes them, once; the editor hears them again when every
   * pause is resumed.
   */
  pauseInput(): () => void
  /**
   * Starts a round from a brief on a page: the job first, with the ids the editor made, then, once it is saved, the
   * brief's section and four waiting frames below everything on the page, as an arrival no undo takes back; the
   * drafts' pictures arrive as they are made. A refused job places nothing and gives why; so does an editor
   * given no AI routes.
   */
  startBrief(request: BriefRequest): Promise<BriefStarted>
  /**
   * Starts more like an AI frame of a brief: the job first, then, once it is saved, a section of four waiting frames
   * right of the frame's section, joined to the frame by a connector, as an arrival no undo takes back. A frame of no
   * brief or showing no picture, a refused job, and an editor given no AI routes start nothing and give why.
   */
  moreLikeThis(request: MoreLikeRequest): Promise<BriefStarted>
  /**
   * Refines the picture a picture layer of an AI frame shows: its new version arrives in that layer, as an arrival no
   * undo takes back. A layer that shows no picture, a refusal, or an editor given no AI routes starts nothing and
   * gives why.
   */
  refine(request: RefineRequest): Promise<AiStart>
  /**
   * Redraws an AI frame's picture at each size given: the job first, then, once it is saved, a section of waiting
   * frames right of the frame's section, joined to it by a connector, as an arrival no undo takes back.
   */
  otherSizes(request: SizesRequest): Promise<BriefStarted>
  /** Makes AI frames editable together from one layer plan made from picture `planAssetId`, their layers linked. */
  makeAllEditable(frameIds: readonly string[], planAssetId: string): Promise<AiStart>
  /**
   * Makes an AI frame editable: starts a layering job for the picture it shows, whose layers arrive in the frame
   * once a tab finishes it, the picture kept hidden under them. A frame showing no picture, a refusal, or an editor
   * given no AI routes starts nothing and gives why.
   */
  makeEditable(frameId: string): Promise<AiStart>
  /** Tries a failed AI frame again into the same frame; a refusal, or an editor given no AI routes, gives why. */
  tryAgain(frameId: string): Promise<AiStart>
  /** The design's AI frames, jobs and briefs as last read from the API; null before the first read, or with no AI routes. */
  designAi(): DesignAi | null
  /** Calls back after each read of the design's AI frames, and as a frame's picture is marked written. */
  onDesignAi(listener: () => void): () => void
  destroy(): void
}

/** What `startViewer` is given: the version's design and where to show it, and the live editor's options. */
export interface ViewerOptions extends CoreOptions {
  /** A canvas and an overlay of the viewer's own, laid over the live editor's stage. */
  canvas: HTMLCanvasElement
  overlay: HTMLElement
  /** The name of the stage field, in the page's words. */
  typingFieldLabel: string
  /** The version's design, as `fetchVersion` read it. */
  design: Design
  /** The page it opens on, when the version has it; else its first. */
  page?: string
  /** The brand kit's values that bound properties take, as the live editor has them. */
  variables?: Variables
}

/**
 * A version shown read-only on a canvas of its own (`startViewer`): the members the canvas-facing
 * parts of the page read, every one of them a tab that may only view answers, with no link, no save
 * state and no exports. Copy as PNG copies nothing. `destroy` frees all it made.
 */
export type Viewer = EditorBase &
  Pick<
    Editor,
    | 'selectAt'
    | 'layersAt'
    | 'sectionAt'
    | 'spotAt'
    | 'copyLayers'
    | 'copyPng'
    | 'selectionRect'
    | 'labelRect'
    | 'showFrame'
    | 'screenPoint'
    | 'drawn'
    | 'destroy'
  >
