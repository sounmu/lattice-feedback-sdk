// Astryx neutral theme values with our brand accent for the SDK UI: the launcher and panel
// frame, the mode bar, the comment pins and editor, and the selection and edit overlays. That UI lives
// in a closed shadow root or in inline-styled overlays, where the widget's stylesheet and its CSS
// variables are not loaded, so the values are copied here as plain values. light-dark(), oklch() and
// color-mix() are avoided because the customer's browser may be older than the widget needs.
//
// Sources: @astryxdesign/theme-neutral/dist/theme.css (the light and dark value of each token) and
// @astryxdesign/core/dist/astryx.css (focus outline, control box, motion). Brand and shape overrides
// match src/app/widget/widget.css; Astryx uses a scoped hover overlay rather than an accent-hover token.

/** The stack the widget sets on --font-family-body (src/app/widget/widget.css). No web font is loaded. */
export const SDK_FONT_FAMILY = [
  '"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', '"Apple SD Gothic Neo"',
  '"Segoe UI"', '"Malgun Gothic"', 'Roboto', '"Noto Sans KR"', 'Helvetica', 'Arial', 'sans-serif',
].join(', ');

/** Astryx text styles as font shorthands: body, field label and button, heading level 4, supporting text. */
export const SDK_FONT = {
  body: `400 14px/20px ${SDK_FONT_FAMILY}`,
  label: `500 14px/20px ${SDK_FONT_FAMILY}`,
  heading: `700 14px/20px ${SDK_FONT_FAMILY}`,
  supporting: `400 12px/20px ${SDK_FONT_FAMILY}`,
} as const;

/** Light values: the panel frame, the comment editor, and the marks drawn straight on the page. */
export const SDK_THEME = {
  /** --color-accent */
  accent: '#3b5bfd',
  /** Primary action's --color-overlay-hover override */
  accentHover: '#2f4ae0',
  /** --color-on-accent */
  onAccent: '#ffffff',
  /** --color-background-popover */
  surface: '#ffffff',
  /** --color-text-primary */
  textPrimary: '#000000',
  /** --color-text-secondary */
  textSecondary: '#474747',
  /** --color-border (#00000014) */
  border: 'rgba(0, 0, 0, 0.08)',
  /** --color-border-emphasized */
  borderEmphasized: '#d4d4d4',
  /** --color-neutral (#0000000f) */
  neutral: 'rgba(0, 0, 0, 0.06)',
  /** --color-overlay-hover (#0000000d) */
  overlayHover: 'rgba(0, 0, 0, 0.05)',
  /** --color-overlay-pressed (#0000001a) */
  overlayPressed: 'rgba(0, 0, 0, 0.1)',
  /** --color-info */
  info: '#0074e2',
  /** --color-on-info */
  onInfo: '#ffffff',
  /** --color-on-info-muted */
  onInfoMuted: '#003978',
  /** --color-error */
  error: '#c9303a',
  /** --color-error-muted */
  errorMuted: '#ffc4be',
  /** --color-on-error-muted */
  onErrorMuted: '#76000c',
} as const;

/** Dark values of the same tokens, for the SDK's dark bars: the mode bar and the edit toolbar. */
export const SDK_THEME_DARK = {
  /** --color-background-card */
  surface: '#1b1b1b',
  /** --color-accent */
  accent: '#3b5bfd',
  /** Primary action's --color-overlay-hover override */
  accentHover: '#2f4ae0',
  /** --color-on-accent */
  onAccent: '#ffffff',
  /** --color-text-primary */
  textPrimary: '#ffffff',
  /** --color-text-secondary */
  textSecondary: '#9e9e9e',
  /** --color-neutral (#ffffff1a) */
  neutral: 'rgba(255, 255, 255, 0.1)',
  /** --color-overlay-hover (#ffffff0d) */
  overlayHover: 'rgba(255, 255, 255, 0.05)',
  /** --color-overlay-pressed (#ffffff1a) */
  overlayPressed: 'rgba(255, 255, 255, 0.1)',
  /** --color-info */
  info: '#6d9cfe',
  /** --color-error */
  error: '#ff705d',
  /** --color-text-error */
  textError: '#ffaea7',
} as const;

/**
 * --radius-inner, --radius-element, --radius-container, --radius-page and --radius-full, with the widget's
 * rounder inner, element and container values. The launcher's corner sits between container and page.
 */
export const SDK_RADIUS = {
  inner: '8px', element: '12px', container: '16px', launcher: '20px', page: '28px', full: '9999px',
} as const;

/** --shadow-med and --shadow-high, light values, and the wider, softer shadow under the panel. */
export const SDK_SHADOW = {
  medium: '0 2px 4px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.1)',
  high: '0 4px 6px rgba(0, 0, 0, 0.1), 0 12px 24px rgba(0, 0, 0, 0.15)',
  panel: '0 8px 16px rgba(0, 0, 0, 0.08), 0 20px 48px rgba(0, 0, 0, 0.16)',
} as const;

/** --focus-outline-width, --focus-outline-style and --focus-outline-offset. The colour is the accent of the surface. */
export const SDK_FOCUS_OUTLINE = { line: '2px solid', offset: '3px' } as const;

/** --duration-fast with --ease-standard. */
export const SDK_TRANSITION = '125ms cubic-bezier(0.24, 1, 0.4, 1)';

export const SDK_PRESSED_SCALE = 'scale(0.98)';

/**
 * The box and label every SDK button shares: Astryx's large button, 44px so it is a touch target.
 * The colours are added where the button is used, because they depend on the surface under it.
 */
export const SDK_BUTTON_BASE = [
  'box-sizing: border-box',
  'min-width: 44px',
  'min-height: 44px',
  'padding: 8px 12px',
  'border: 0',
  `border-radius: ${SDK_RADIUS.element}`,
  `font: ${SDK_FONT.label}`,
  'white-space: nowrap',
  'cursor: pointer',
  `transition: background-color ${SDK_TRANSITION}, transform ${SDK_TRANSITION}`,
].join('; ');

export function getStateLayer(overlayColor: string): string {
  return `linear-gradient(${overlayColor}, ${overlayColor})`;
}

/** A token colour at the given opacity. Takes the #rrggbb form the tokens above use. */
export function getTranslucentColor(hexColor: string, opacity: number): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}
