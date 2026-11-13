export function trackHistory(onChange: () => void): () => void {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  const wrappedPushState: History['pushState'] = (...parameters) => {
    originalPushState.apply(window.history, parameters);
    onChange();
  };
  const wrappedReplaceState: History['replaceState'] = (...parameters) => {
    originalReplaceState.apply(window.history, parameters);
    onChange();
  };
  let active = true;
  window.history.pushState = wrappedPushState;
  window.history.replaceState = wrappedReplaceState;
  window.addEventListener('popstate', onChange);
  return () => {
    if (!active) return;
    active = false;
    window.removeEventListener('popstate', onChange);
    if (window.history.pushState === wrappedPushState) window.history.pushState = originalPushState;
    if (window.history.replaceState === wrappedReplaceState) window.history.replaceState = originalReplaceState;
  };
}
