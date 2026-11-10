import type { SVGProps } from 'react'
import {
  AlertTriangle, ArrowLeft, Bot, Box, Camera, Check, CheckSquare, ChevronRight, Clipboard,
  Copy, Download, ExternalLink, File, Folder, Info, KeyRound, Maximize2, Menu,
  MessageSquare, Mic, Milestone, Minimize2, Paperclip, Pause, Pencil,
  Pin, PinOff, Play, Plus, RefreshCw, Search, Send, Settings, Smartphone,
  Sparkles, Square, Star, Trash2, Upload, Wrench, X, ZoomIn, CalendarClock, Workflow, History,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NexyIconName =
  | 'add' | 'agent' | 'artifact' | 'attach' | 'busy' | 'camera' | 'chat' | 'check' | 'checked-box'
  | 'back' | 'chevron-right' | 'clipboard' | 'close' | 'delete' | 'download' | 'duplicate' | 'edit' | 'error' | 'expand' | 'external'
  | 'folder' | 'history'
  | 'info' | 'inspect' | 'key' | 'maximize' | 'menu' | 'microphone'
  | 'milestone' | 'minimize' | 'mobile' | 'project' | 'prompt' | 'rating' | 'restore'
  | 'pause' | 'pin' | 'unpin' | 'play' | 'refresh' | 'scheduled' | 'search' | 'send' | 'settings' | 'skill' | 'spark' | 'stop'
  | 'tool' | 'upload' | 'warning' | 'workflow'

const paths: Record<NexyIconName, string> = {
  back: 'M2 7h3V5h2V3h3v2H8v2h6v2H8v2h2v2H7v-2H5V9H2z',
  add: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
  agent: 'M5 1h6v2h2v9h-2v2H5v-2H3V3h2zm0 4v5h6V5H5zm1 1h2v2H6zm3 0h2v2H9z',
  artifact: 'M3 1h8l2 2v12H3zm2 2v10h6V5H9V3zm1 4h4v2H6zm0 3h4v2H6z',
  attach: 'M6 2h6v9H5V5h2v4h3V4H8V2H4v11h10V2h-2v11H2V2z',
  busy: 'M2 2h5v2H4v3H2zm7 0h5v5h-2V4H9zm3 7h2v5H9v-2h3zM2 9h2v3h3v2H2z',
  camera: 'M5 2h6l1 2h3v10H1V4h3zm-2 4v6h10V6h-2l-1-2H6L5 6zm3 1h4v4H6z',
  chat: 'M2 2h12v9H8l-3 3v-3H2zm2 2v5h2v2l2-2h4V4z',
  check: 'M1 8h3l2 2 6-7 3 2-9 10z',
  'checked-box': 'M1 1h14v2H1zM1 13h14v2H1zM1 3h2v10H1zM13 3h2v10h-2zM4 8h2l2 2 4-5 2 2-6 7z',
  'chevron-right': 'M5 2h3v2h2v2h2v4h-2v2H8v2H5v-2h2v-2h2V6H7V4H5z',
  clipboard: 'M5 1h6v2h3v12H2V3h3zm2 2v1h2V3zM4 5v8h8V5h-1v1H5V5z',
  close: 'M2 2h3v2h2v2h2V4h2V2h3v3h-2v2h-2v2h2v2h2v3h-3v-2H9v-2H7v2H5v2H2v-3h2V9h2V7H4V5H2z',
  delete: 'M5 1h6v2h4v2h-2v10H3V5H1V3h4zm0 4v8h6V5zm1 2h2v4H6zm3 0h2v4H9z',
  download: 'M7 1h2v7h3v2h-2v2H6v-2H4V8h3zM2 12h2v1h8v-1h2v3H2z',
  duplicate: 'M5 1h10v10h-3v4H1V5h4zm2 2v6h6V3zM3 7v6h7v-2H5V7z',
  edit: 'M10 2h2l2 2v2l-8 8H2v-4zm1 2-7 7v1h1l7-7z',
  error: 'M5 1h6v2h2v2h2v6h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2zm2 3v5h2V4zm0 7v2h2v-2z',
  expand: 'M2 2h5v2H4v3H2zm7 0h5v5h-2V4H9zM2 9h2v3h3v2H2zm10 0h2v5H9v-2h3z',
  external: 'M8 2h6v6h-2V5l-5 5-1-1 5-5H8zM2 4h5v2H4v6h6V9h2v5H2z',
  folder: 'M2 3h5l2 2h5v9H2zm2 4v5h8V7z',
  info: 'M6 1h4v3H6zm-2 5h6v6h2v2H4v-2h2V8H4z',
  inspect: 'M1 7h2V5h2V3h6v2h2v2h2v2h-2v2h-2v2H5v-2H3V9H1zm4 0v2h2v2h2V9h2V7H9V5H7v2z',
  key: 'M2 7h2V5h5v2h5v3h-2V9h-2v2H8V9H4v2H2zm2 0v2h3V7z',
  maximize: 'M2 2h12v12H2zm2 2v8h8V4z',
  menu: 'M2 3h12v2H2zm0 4h12v2H2zm0 4h12v2H2z',
  microphone: 'M5 1h6v8H9v2h3v2H9v2H7v-2H4v-2h3V9H5zm2 2v6h2V3zM2 5h2v4h2v2H4V9H2zm10 0h2v4h-2z',
  milestone: 'M2 2h12v2H4v8h8V7h2v7H2zm4 3h6v2H8v2h4v2H6z',
  minimize: 'M3 11h10v2H3z',
  mobile: 'M4 1h8v14H4zm2 2v9h4V3zm1 10h2v1H7z',
  pause: 'M3 2h4v12H3zm6 0h4v12H9z',
  play: 'M3 1l11 7-11 7zm2 4v6l5-3z',
  project: 'M2 3h5l2 2h5v9H2zm2 4v5h8V7z',
  prompt: 'M2 2h12v12H2zm2 2v8h8V4zm1 2h2v2H5zm3 0h3v2H8zm-3 4h6v1H5z',
  // Clock ring with a counter-clockwise arrow head at the upper left.
  history: 'M5 1h6v2H5z M11 3h2v2h-2z M13 5h2v6h-2z M11 11h2v2h-2z M5 13h6v2H5z M3 11h2v2H3z M1 9h2v2H1z M1 2h2v3h3v2H1z M7 4h2v5h3v2H7z',
  rating: 'M7 1h2v4h4v2h2v2h-3v2h-2v3H6v-3H4V9H1V7h2V5h4z',
  refresh: 'M4 2h7V0l4 4-4 4V6H5v2H2V5h2zm8 6h2v3h-2v3H5v2l-4-4 4-4v2h6V8z',
  restore: 'M4 1h10v10h-2V3H6v2H4zM2 5h10v10H2zm2 2v6h6V7z',
  scheduled: 'M3 1h2v2h6V1h2v2h2v12H1V3h2zm0 6v6h10V7zm4 1h2v3h3v1H7z',
  search: 'M2 2h8v2h2v6h-2v2H4v-2H2zm2 2v6h6V4zm7 7h2v2h2v2h-3v-2h-1z',
  send: 'M1 2l14 6-14 6V9l8-1-8-1zm2 3v1l6 1v2l-6 1v1l9-3z',
  settings: 'M6 1h4l1 3 3 1v4l-3 1-1 4H6l-1-4-3-1V5l3-1zm2 4L6 6v2l2 2 2-2V6z',
  skill: 'M2 2h5v2h2V2h5v4h-2v2h2v6H9v-2H7v2H2V8h2V6H2zm4 3v6h4V5z',
  spark: 'M7 1h2v4h2v2h4v2h-4v2H9v4H7v-4H5V9H1V7h4V5h2z',
  stop: 'M3 3h10v10H3z',
  tool: 'M2 1h3v4l2 2 2-2V1h3v5l-3 3v6H5V9L2 6z',
  upload: 'M7 15h2V8h3V6h-2V4H6v2H4v2h3zM2 1h12v3h-2V3H4v1H2z',
  warning: 'M7 1h2l7 14H0zm0 5v4h2V6zm0 6v2h2v-2z',
  pin: 'M5 1h6v2h2v2h-2v4H9v6H7V9H5V5H3V3h2z',
  unpin: 'M2 1h2v2h1V1h6v2h2v2h-2v2l4 4v3h-2v-2h-2v-2H9v5H7V9H6L4 7H3V5H2V3H1V1zm4 3v1h2v2h2V5h1V4z',
  workflow: 'M1 2h5v5H1zm2 2v1h1V4zm7-2h5v5h-5zm2 2v1h1V4zM6 4h4v2H6zM7 6h2v4H7zm-6 4h5v5H1zm2 2v1h1v-1zm7-2h5v5h-5zm2 2v1h1v-1zM6 11h4v2H6z',
}

const classicIcons: Record<NexyIconName, LucideIcon> = {
  add: Plus, agent: Bot, artifact: Box, attach: Paperclip, back: ArrowLeft,
  busy: RefreshCw, camera: Camera, chat: MessageSquare, check: Check, 'checked-box': CheckSquare,
  'chevron-right': ChevronRight, clipboard: Clipboard, close: X, delete: Trash2,
  download: Download, duplicate: Copy, edit: Pencil, error: AlertTriangle,
  expand: ZoomIn, external: ExternalLink, folder: Folder, history: History, info: Info,
  inspect: Search, key: KeyRound, maximize: Maximize2, menu: Menu,
  microphone: Mic, milestone: Milestone, minimize: Minimize2, mobile: Smartphone,
  pause: Pause, pin: Pin, unpin: PinOff, play: Play, project: Folder, prompt: File,
  rating: Star, refresh: RefreshCw, restore: Maximize2, scheduled: CalendarClock,
  search: Search, send: Send, settings: Settings, skill: Wrench, spark: Sparkles,
  stop: Square, tool: Wrench, upload: Upload, warning: AlertTriangle,
  workflow: Workflow,
}

export type NexyIconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: NexyIconName
  size?: number | string
  title?: string
  motion?: 'spin' | 'pulse' | 'none'
}

export function NexyIcon({ name, size = 16, title, motion, className, ...props }: NexyIconProps) {
  if (document.documentElement.dataset.uiStyle !== '8bit') {
    const ClassicIcon = classicIcons[name]
    const classicMotion = motion ?? (name === 'busy' ? 'spin' : 'none')
    return (
      <ClassicIcon
        width={size}
        height={size}
        className={`shrink-0 ${classicMotion === 'spin' ? 'animate-spin' : ''} ${classicMotion === 'pulse' ? 'animate-pulse' : ''} ${className ?? ''}`}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        role={title ? 'img' : undefined}
        {...props}
      />
    )
  }
  const retroLoadingMotion = name === 'busy' && motion !== 'none'
  const retroLoadingSpin = retroLoadingMotion && motion === 'spin'
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={`nexy-pixel-art shrink-0 ${retroLoadingSpin ? 'nexy-retro-loading-spin' : retroLoadingMotion ? 'nexy-retro-loading-pulse' : ''} ${className ?? ''}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...props}
    >
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  )
}
