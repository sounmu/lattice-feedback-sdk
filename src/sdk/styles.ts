import {
  getStateLayer, SDK_FOCUS_OUTLINE, SDK_FONT, SDK_HOVER_MEDIA, SDK_PRESSED_SCALE, SDK_RADIUS, SDK_SHADOW, SDK_THEME,
  SDK_TRANSITION,
} from '@/sdk/theme-tokens';

export const SDK_Z_INDEX = 2147483647;

export const PANEL_OPEN_CLASS_NAME = 'is-open';

export const HOST_ELEMENT_STYLE = 'all: initial;';

/** Screens narrow enough that the open panel takes the whole screen above the launcher. */
export const PHONE_MEDIA_QUERY = '(max-width: 480px)';

export const LAUNCHER_ICON_CLASS_NAME = 'launcher-icon';
export const LAUNCHER_CLOSE_ICON_CLASS_NAME = 'launcher-icon-close';
export const LAUNCHER_LABEL_CLASS_NAME = 'launcher-label';

// The launcher is a rounded square in the brand primary states, a chat glyph while the panel is closed
// and a chevron while it is open. Its name stays in the button as text no one sees. Its focus ring keeps
// a light halo inside the blue outline, so it shows on light and dark customer pages alike.
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: ${SDK_RADIUS.launcher};
  background-color: ${SDK_THEME.accent};
  color: ${SDK_THEME.onAccent};
  font: ${SDK_FONT.label};
  cursor: pointer;
  box-shadow: ${SDK_SHADOW.high};
  transition: transform ${SDK_TRANSITION};
}

.${LAUNCHER_ICON_CLASS_NAME} {
  width: 28px;
  height: 28px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.${LAUNCHER_CLOSE_ICON_CLASS_NAME},
.launcher[aria-expanded="true"] .${LAUNCHER_ICON_CLASS_NAME}:not(.${LAUNCHER_CLOSE_ICON_CLASS_NAME}) {
  display: none;
}

.launcher[aria-expanded="true"] .${LAUNCHER_CLOSE_ICON_CLASS_NAME} {
  display: block;
}

.${LAUNCHER_LABEL_CLASS_NAME} {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

${SDK_HOVER_MEDIA} {
  .launcher:hover {
    background-image: ${getStateLayer(SDK_THEME.accentHover)};
  }
}

.launcher:active {
  background-image: ${getStateLayer(SDK_THEME.overlayPressed)};
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
  bottom: 88px;
  z-index: ${SDK_Z_INDEX};
  width: min(380px, calc(100vw - 40px));
  height: min(640px, calc(100vh - 108px));
  display: none;
  overflow: hidden;
  border-radius: ${SDK_RADIUS.page};
  background: ${SDK_THEME.surface};
  box-shadow: 0 0 0 1px ${SDK_THEME.border}, ${SDK_SHADOW.panel};
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

/* On a phone the panel takes the screen above the launcher, which is smaller there and stays reachable
   to close it. */
@media ${PHONE_MEDIA_QUERY} {
  .launcher {
    width: 48px;
    height: 48px;
    border-radius: ${SDK_RADIUS.container};
  }

  .panel {
    top: 8px;
    right: 8px;
    bottom: 80px;
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
