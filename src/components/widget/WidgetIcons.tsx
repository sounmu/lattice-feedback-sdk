import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

// The widget's own glyphs, drawn like the Lucide set the Astryx theme uses for close, back and check.
// Each is a plain SVG component, so Astryx's Icon sizes and colours it like its own icons.
function Glyph({ children, ...svgProps }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
    >
      {children}
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 21s-6-5.4-6-11a6 6 0 1 1 12 0c0 5.6-6 11-6 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Glyph>
  );
}

export function MoveIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </Glyph>
  );
}

export function FlowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 5l8 14 8-14" />
    </Glyph>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </Glyph>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z" />
    </Glyph>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M7 4.5v15l12-7.5Z" />
    </Glyph>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
    </Glyph>
  );
}

// Lucide's panel-left/right open and close glyphs: the pane edge, and an arrow the way the pane will move.
const PANE_PATHS = {
  left: { edge: 'M9 3v18', arrowLeft: 'M16 15l-3-3 3-3', arrowRight: 'M14 9l3 3-3 3' },
  right: { edge: 'M15 3v18', arrowLeft: 'M10 15l-3-3 3-3', arrowRight: 'M8 9l3 3-3 3' },
} as const;

export function PaneIcon({ side, pointsLeft, ...props }: IconProps & { side: 'left' | 'right'; pointsLeft: boolean }) {
  const paths = PANE_PATHS[side];
  return (
    <Glyph {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={paths.edge} />
      <path d={pointsLeft ? paths.arrowLeft : paths.arrowRight} />
    </Glyph>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 5v14M16 5v14" />
    </Glyph>
  );
}

export function RestartIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M19 5v14L9 12ZM5 5v14" />
    </Glyph>
  );
}
