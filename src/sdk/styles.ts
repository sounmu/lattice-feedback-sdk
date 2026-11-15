import {
  getStateLayer, SDK_FOCUS_OUTLINE, SDK_FONT, SDK_PRESSED_SCALE, SDK_RADIUS, SDK_SHADOW, SDK_THEME, SDK_THEME_DARK,
  SDK_TRANSITION,
} from '@/sdk/theme-tokens';

export const SDK_Z_INDEX = 2147483647;

export const PANEL_OPEN_CLASS_NAME = 'is-open';

export const HOST_ELEMENT_STYLE = 'all: initial;';

/** Screens narrow enough that the open panel takes the whole screen above the launcher. */
export const PHONE_MEDIA_QUERY = '(max-width: 480px)';

// The launcher is a dark pill, so its hover and pressed layers are the dark-surface ones. Its focus ring
// keeps a light halo inside the dark outline, so it shows on light and dark customer pages alike.
export const SDK_STYLES = `
:host {
  all: initial;
}

.launcher {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: ${SDK_Z_INDEX};
  box-sizing: border-box;
  height: 48px;
  padding: 0 20px;
  border: 0;
  border-radius: ${SDK_RADIUS.full};
  background-color: ${SDK_THEME.accent};
  color: ${SDK_THEME.onAccent};
  font: ${SDK_FONT.label};
  cursor: pointer;
  box-shadow: ${SDK_SHADOW.high};
  transition: transform ${SDK_TRANSITION};
}

.launcher:hover {
  background-image: ${getStateLayer(SDK_THEME_DARK.overlayHover)};
}

.launcher:active {
  background-image: ${getStateLayer(SDK_THEME_DARK.overlayPressed)};
  transform: ${SDK_PRESSED_SCALE};
}

.launcher:focus-visible {
  outline: ${SDK_FOCUS_OUTLINE.line} ${SDK_THEME.accent};
  outline-offset: ${SDK_FOCUS_OUTLINE.offset};
  box-shadow: 0 0 0 ${SDK_FOCUS_OUTLINE.offset} ${SDK_THEME.surface}, ${SDK_SHADOW.high};
}

.panel {
  position: fixed;
  right: 20px;
  bottom: 80px;
  z-index: ${SDK_Z_INDEX};
  width: min(380px, calc(100vw - 40px));
  height: min(620px, calc(100vh - 100px));
  display: none;
  overflow: hidden;
  border-radius: ${SDK_RADIUS.container};
  background: ${SDK_THEME.surface};
  box-shadow: 0 0 0 1px ${SDK_THEME.border}, ${SDK_SHADOW.high};
}

.panel.${PANEL_OPEN_CLASS_NAME} {
  display: block;
}

.panel iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

/* On a phone the panel takes the screen above the launcher, which stays reachable to close it. */
@media ${PHONE_MEDIA_QUERY} {
  .panel {
    top: 8px;
    right: 8px;
    left: 8px;
    width: auto;
    height: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .launcher {
    transition: none;
  }

  .launcher:active {
    transform: none;
  }
}
`;
