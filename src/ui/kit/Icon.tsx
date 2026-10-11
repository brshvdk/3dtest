/**
 * Набор иконок (inline SVG, 24×24, stroke = currentColor). Без внешних
 * зависимостей — бандл остаётся маленьким.
 */
import type { CSSProperties } from "react";

export type IconName =
  | "undo"
  | "redo"
  | "share"
  | "print"
  | "plus"
  | "minus"
  | "trash"
  | "copy"
  | "door"
  | "window"
  | "passage"
  | "balcony"
  | "furniture"
  | "room"
  | "ruler"
  | "cube"
  | "plan"
  | "split"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "check"
  | "warning"
  | "info"
  | "settings"
  | "close"
  | "flip"
  | "swap"
  | "fit"
  | "zoom-in"
  | "zoom-out"
  | "link"
  | "sun"
  | "moon"
  | "file-new"
  | "cart"
  | "skirting"
  | "scissors"
  | "eye"
  | "eye-off"
  | "edit"
  | "center"
  | "magnet"
  | "camera"
  | "list"
  | "home"
  | "drag";

const PATHS: Record<IconName, JSX.Element> = {
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  door: (
    <>
      <path d="M4 21h16M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
    </>
  ),
  window: (
    <>
      <rect x="4" y="3" width="16" height="16" rx="1" />
      <path d="M12 3v16M4 11h16M2.5 21h19" />
    </>
  ),
  passage: <path d="M3 21h4V8a5 5 0 0 1 10 0v13h4" />,
  balcony: (
    <>
      <path d="M3 21h18M4 21V4h7v17M11 4h9v12h-9" />
      <path d="M15.5 4v12M8.5 12.5v1" />
    </>
  ),
  furniture: (
    <>
      <rect x="3" y="7" width="18" height="11" rx="1" />
      <path d="M12 7v11M3 12h18M5 18v2M19 18v2" />
    </>
  ),
  room: <path d="M3 3h18v18H3zM3 3l0 0M14 21v-6h7" />,
  ruler: (
    <>
      <path d="M3 17 17 3l4 4L7 21z" />
      <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
    </>
  ),
  cube: (
    <>
      <path d="m12 2 9 5v10l-9 5-9-5V7z" />
      <path d="m3 7 9 5 9-5M12 12v10" />
    </>
  ),
  plan: (
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M3 10h7V3M14 21v-7h7" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  warning: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  flip: <path d="M12 3v18M16 7l4 5-4 5M8 7l-4 5 4 5" />,
  swap: <path d="M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4" />,
  fit: <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />,
  "zoom-in": (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6" />
    </>
  ),
  link: (
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  "file-new": (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M12 18v-6M9 15h6" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6" />
    </>
  ),
  skirting: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 21v-7h2.5l1.5 1.5V21" />
      <path d="M3 14h4" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20" />
  ),
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  center: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  magnet: (
    <path d="M6 15V7a6 6 0 0 1 12 0v8M6 15a6 6 0 0 0 12 0M6 11h4M14 11h4" />
  ),
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  home: <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" />,
  drag: (
    <>
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
  style,
  title,
}: IconProps) {
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
      className={className}
      style={{ flex: "none", ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
