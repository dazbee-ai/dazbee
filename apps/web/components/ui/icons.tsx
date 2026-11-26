'use client'

// The app's icons, drawn from Iconoir. Each is named for what it shows and takes a size, a weight and
// mirrored: a weight picks the stroke, bold draws thicker, and fill draws Iconoir's solid icon where it
// has one.
import {
  AlignBottomBox,
  AlignBottomBoxSolid,
  AlignCenter,
  AlignHorizontalCenters,
  AlignHorizontalCentersSolid,
  AlignJustify,
  AlignLeft,
  AlignLeftBox,
  AlignLeftBoxSolid,
  AlignRight,
  AlignRightBox,
  AlignRightBoxSolid,
  AlignTopBox,
  AlignTopBoxSolid,
  AlignVerticalCenters,
  AlignVerticalCentersSolid,
  ArrowDown,
  ArrowDownTag,
  ArrowLeft,
  ArrowLeftTag,
  ArrowLeftTagSolid,
  ArrowRight,
  ArrowRightTag,
  ArrowRightTagSolid,
  ArrowSeparate,
  ArrowSeparateVertical,
  ArrowUp,
  ArrowUpRight,
  ArrowUpTag,
  Bold,
  Bookmark,
  BookmarkSolid,
  Check,
  Circle,
  Clock,
  ClockSolid,
  CloudCheck,
  CloudUpload,
  CloudXmark,
  ColorPicker,
  Copy,
  Crop,
  CursorPointer,
  DesignNib,
  DesignNibSolid,
  Download,
  Drag,
  DragHandGesture,
  DragSolid,
  EditPencil,
  Exclude,
  Eye,
  EyeClosed,
  EyeSolid,
  FillColor,
  FillColorSolid,
  Flash,
  Flip,
  FlipReverse,
  Frame,
  FrameTool,
  FrameToolSolid,
  Globe,
  Group,
  Home,
  InfoCircle,
  InfoCircleSolid,
  Intersect,
  Italic,
  KeyCommand,
  List,
  Lock,
  LockSlash,
  LogOut,
  MediaImage,
  MediaImageList,
  Menu,
  Minus,
  MoreHoriz,
  MultiplePages,
  MultiplePagesEmpty,
  NavArrowDown,
  NavArrowDownSolid,
  NavArrowLeft,
  NavArrowLeftSolid,
  NavArrowRight,
  NavArrowRightSolid,
  NavArrowUp,
  NavArrowUpSolid,
  NumberedListLeft,
  Palette,
  Pentagon,
  Plus,
  Redo,
  RefreshCircle,
  RefreshCircleSolid,
  RefreshDouble,
  ScaleFrameEnlarge,
  Search,
  SelectWindow,
  Settings,
  ShareIos,
  Shuffle,
  Spark,
  Sparks,
  SparksSolid,
  Square,
  Star,
  StarSolid,
  Strikethrough,
  TableRows,
  Text,
  Trash,
  TrashSolid,
  Underline,
  Undo,
  UndoCircle,
  UndoCircleSolid,
  Union,
  UnionHorizAlt,
  Upload,
  ViewGrid,
  ViewStructureUp,
  WarningCircle,
  WarningCircleSolid,
  Xmark,
} from 'iconoir-react'
import { type ComponentType, forwardRef, type SVGProps } from 'react'

export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string
  weight?: IconWeight
  mirrored?: boolean
}
export type Icon = ComponentType<IconProps>

type IconoirIcon = typeof Home

const STROKE: Record<IconWeight, number> = { thin: 1.1, light: 1.3, regular: 1.6, bold: 2.2, fill: 2, duotone: 1.6 }

function make(regular: IconoirIcon, solid?: IconoirIcon): Icon {
  const Made = forwardRef<SVGSVGElement, IconProps>(function Made(
    { size = '1em', weight = 'regular', mirrored, style, ...rest },
    ref,
  ) {
    const Drawn = weight === 'fill' && solid ? solid : regular
    return (
      <Drawn
        ref={ref}
        width={size}
        height={size}
        strokeWidth={STROKE[weight]}
        style={mirrored ? { ...style, transform: 'scaleX(-1)' } : style}
        {...rest}
      />
    )
  })
  return Made as Icon
}

export const AlignBottomIcon = make(AlignBottomBox, AlignBottomBoxSolid)
export const AlignCenterHorizontalIcon = make(AlignHorizontalCenters, AlignHorizontalCentersSolid)
export const AlignCenterVerticalIcon = make(AlignVerticalCenters, AlignVerticalCentersSolid)
export const AlignLeftIcon = make(AlignLeftBox, AlignLeftBoxSolid)
export const AlignRightIcon = make(AlignRightBox, AlignRightBoxSolid)
export const AlignTopIcon = make(AlignTopBox, AlignTopBoxSolid)
export const ArrowArcLeftIcon = make(Undo)
export const ArrowArcRightIcon = make(Redo)
export const ArrowCounterClockwiseIcon = make(UndoCircle, UndoCircleSolid)
export const ArrowDownIcon = make(ArrowDown)
export const ArrowLeftIcon = make(ArrowLeft)
export const ArrowLineDownIcon = make(ArrowDownTag)
export const ArrowLineLeftIcon = make(ArrowLeftTag, ArrowLeftTagSolid)
export const ArrowLineRightIcon = make(ArrowRightTag, ArrowRightTagSolid)
export const ArrowLineUpIcon = make(ArrowUpTag)
export const ArrowRightIcon = make(ArrowRight)
export const ArrowUpIcon = make(ArrowUp)
export const ArrowUpRightIcon = make(ArrowUpRight)
export const ArrowsClockwiseIcon = make(RefreshDouble)
export const ArrowsHorizontalIcon = make(ArrowSeparate)
export const ArrowsOutCardinalIcon = make(Drag, DragSolid)
export const ArrowsVerticalIcon = make(ArrowSeparateVertical)
export const BookmarkSimpleIcon = make(Bookmark, BookmarkSolid)
export const BoundingBoxIcon = make(SelectWindow)
export const CaretDownIcon = make(NavArrowDown, NavArrowDownSolid)
export const CaretLeftIcon = make(NavArrowLeft, NavArrowLeftSolid)
export const CaretRightIcon = make(NavArrowRight, NavArrowRightSolid)
export const CaretUpIcon = make(NavArrowUp, NavArrowUpSolid)
export const CheckIcon = make(Check)
export const CircleIcon = make(Circle)
export const CircleNotchIcon = make(RefreshCircle, RefreshCircleSolid)
export const ClockIcon = make(Clock, ClockSolid)
export const CloudArrowUpIcon = make(CloudUpload)
export const CloudCheckIcon = make(CloudCheck)
export const CloudSlashIcon = make(CloudXmark)
export const CloudWarningIcon = make(CloudXmark)
export const ColumnsIcon = make(TableRows)
export const CopyIcon = make(Copy)
export const CornersOutIcon = make(ScaleFrameEnlarge)
export const CropIcon = make(Crop)
export const CursorIcon = make(CursorPointer)
export const DotsSixVerticalIcon = make(Menu)
export const DotsThreeIcon = make(MoreHoriz)
export const DownloadSimpleIcon = make(Download)
export const ExcludeSquareIcon = make(Exclude)
export const EyeIcon = make(Eye, EyeSolid)
export const EyeSlashIcon = make(EyeClosed)
export const EyedropperIcon = make(ColorPicker)
export const FilesIcon = make(MultiplePages)
export const FlashIcon = make(Flash)
export const FlipHorizontalIcon = make(FlipReverse)
export const FlipVerticalIcon = make(Flip)
export const FrameCornersIcon = make(FrameTool, FrameToolSolid)
export const GearSixIcon = make(Settings)
export const GlobeIcon = make(Globe)
export const HandIcon = make(DragHandGesture)
export const HouseIcon = make(Home)
export const ImageIcon = make(MediaImage)
export const ImageSquareIcon = make(MediaImage)
export const ImagesIcon = make(MediaImageList)
export const InfoIcon = make(InfoCircle, InfoCircleSolid)
export const IntersectSquareIcon = make(Intersect)
export const KeyboardIcon = make(KeyCommand)
export const LayoutIcon = make(ViewStructureUp)
export const LineSegmentIcon = make(Minus)
export const ListBulletsIcon = make(List)
export const ListNumbersIcon = make(NumberedListLeft)
export const LockSimpleIcon = make(Lock)
export const LockSimpleOpenIcon = make(LockSlash)
export const MagnifyingGlassIcon = make(Search)
export const MinusIcon = make(Minus)
export const PaintBucketIcon = make(FillColor, FillColorSolid)
export const PaletteIcon = make(Palette)
export const PenNibIcon = make(DesignNib, DesignNibSolid)
export const PencilSimpleIcon = make(EditPencil)
export const PentagonIcon = make(Pentagon)
export const PlusIcon = make(Plus)
export const RectangleIcon = make(Square)
export const RowsIcon = make(TableRows)
export const SelectionAllIcon = make(SelectWindow)
export const SelectionIcon = make(Frame)
export const ShapesIcon = make(Square)
export const ShareFatIcon = make(ShareIos)
export const ShuffleIcon = make(Shuffle)
export const SignOutIcon = make(LogOut)
export const SparkIcon = make(Spark)
export const SparkleIcon = make(Sparks, SparksSolid)
export const SquareIcon = make(Square)
export const SquaresFourIcon = make(ViewGrid)
export const StackIcon = make(MultiplePagesEmpty)
export const StarIcon = make(Star, StarSolid)
export const SubtractSquareIcon = make(UnionHorizAlt)
export const TextAaIcon = make(Text)
export const TextAlignCenterIcon = make(AlignCenter)
export const TextAlignJustifyIcon = make(AlignJustify)
export const TextAlignLeftIcon = make(AlignLeft)
export const TextAlignRightIcon = make(AlignRight)
export const TextBIcon = make(Bold)
export const TextItalicIcon = make(Italic)
export const TextLinesIcon = make(Menu)
export const TextStrikethroughIcon = make(Strikethrough)
export const TextTIcon = make(Text)
export const TextUnderlineIcon = make(Underline)
export const TrashIcon = make(Trash, TrashSolid)
export const UniteIcon = make(Union)
export const UniteSquareIcon = make(Union)
export const UploadSimpleIcon = make(Upload)
export const UsersIcon = make(Group)
export const WarningCircleIcon = make(WarningCircle, WarningCircleSolid)
export const XIcon = make(Xmark)
