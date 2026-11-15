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
