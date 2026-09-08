import type { JSX, SVGProps } from 'react'

export type IconName =
  | 'search'
  | 'plus'
  | 'close'
  | 'menu'
  | 'sun'
  | 'moon'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'board'
  | 'list'
  | 'chart'
  | 'paperclip'
  | 'check'
  | 'link'
  | 'upload'
  | 'logout'
  | 'sparkle'
  | 'command'
  | 'filter'
  | 'calendar'
  | 'flag'
  | 'users'

const PATHS: Record<IconName, JSX.Element> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  board: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
      <rect x="16" y="4" width="5" height="8" rx="1.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  chart: <path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-2M20 15V6" />,
  paperclip: (
    <path d="m21 11.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" />
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  upload: <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" />,
  command: (
    <path d="M9 9V6a3 3 0 1 0-3 3h3Zm0 0h6m-6 0v6m6-6V6a3 3 0 1 1 3 3h-3Zm0 0v6m0 0v3a3 3 0 1 0 3-3h-3Zm0 0H9m0 0v3a3 3 0 1 1-3-3h3Z" />
  ),
  filter: <path d="M4 5h16l-6.5 8v5l-3 2v-7L4 5Z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" />
    </>
  ),
}

/** Stroked line icons on a 24-unit grid. Colour comes from `currentColor`. */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}
