/** Stroke icons on a 24-unit grid, sized by the `size` prop. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const CursorIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 3l6.4 16.2 2.2-6.6 6.6-2.2z" />
  </Svg>
)

export const SignatureIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 17c2.6 0 3-8.5 5-8.5s1.4 8.5 3.4 8.5S14 6 16 6s1 11 5 11" />
    <path d="M3 21h18" />
  </Svg>
)

export const TextIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 6V4h14v2" />
    <path d="M12 4v16" />
    <path d="M9 20h6" />
  </Svg>
)

export const DateIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 15h3" />
  </Svg>
)

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5L19.5 6.5" />
  </Svg>
)

export const CrossIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M21 16l-5-5-6.5 9" />
  </Svg>
)

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const MinusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
)

export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h8" />
  </Svg>
)

export const UndoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9h11a5 5 0 010 10h-6" />
    <path d="M8 5L4 9l4 4" />
  </Svg>
)

export const RedoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 9H9a5 5 0 000 10h6" />
    <path d="M16 5l4 4-4 4" />
  </Svg>
)

export const SidebarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9.5 4v16" />
  </Svg>
)

export const FolderIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 7.5A2 2 0 015 5.5h4l2 2.5h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </Svg>
)

export const DocIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h8l4.5 4.5V21H6z" />
    <path d="M14 3v5h4.5" />
  </Svg>
)

export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z" />
  </Svg>
)

export const PenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20l4-1 9.5-9.5a2.1 2.1 0 10-3-3L5 16z" />
    <path d="M14 6.5l3 3" />
  </Svg>
)

export const KeyboardIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
  </Svg>
)

export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="M8 8l4-4 4 4" />
    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </Svg>
)

export const SaveIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M8 3v6h7V3" />
    <path d="M8 13h8v8H8z" />
  </Svg>
)

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
)

export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
)

export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
)

export const CheckCircleIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.6 2.6L16 9.5" />
  </Svg>
)

export const EraserIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 20H20" />
    <path d="M15.5 4.5l4 4a1.6 1.6 0 010 2.3l-8 8H7l-2.5-2.5a1.6 1.6 0 010-2.3l8.7-9.5a1.6 1.6 0 012.3 0z" />
  </Svg>
)

export const FieldsIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="6" rx="1.6" />
    <rect x="3" y="14" width="11" height="5" rx="1.6" />
    <path d="M6 8h5" />
  </Svg>
)

export const ChevronLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </Svg>
)

export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </Svg>
)
