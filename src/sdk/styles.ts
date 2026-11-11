export const SDK_Z_INDEX = 2147483647;

export const PANEL_OPEN_CLASS_NAME = 'is-open';

export const HOST_ELEMENT_STYLE = 'all: initial;';

export const SDK_STYLES = `
:host {
  all: initial;
}

.launcher {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: ${SDK_Z_INDEX};
  height: 48px;
  padding: 0 20px;
  border: 0;
  border-radius: 24px;
  background: #111827;
  color: #ffffff;
  font: 600 14px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(17, 24, 39, 0.25);
}

.launcher:hover {
  background: #1f2937;
}

.launcher:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}

.panel {
  position: fixed;
  right: 20px;
  bottom: 80px;
  z-index: ${SDK_Z_INDEX};
  width: min(380px, calc(100vw - 40px));
  height: min(560px, calc(100vh - 100px));
  display: none;
  overflow: hidden;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 40px rgba(17, 24, 39, 0.3);
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
`;
