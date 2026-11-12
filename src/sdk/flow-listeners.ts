import type { FlowNavigationType } from '@/sdk/flow-session';

export function getDocumentNavigationType(): FlowNavigationType {
  const [entry] = performance.getEntriesByType('navigation');
  return entry && 'type' in entry && entry.type === 'reload' ? 'reload' : 'document';
}

export function createFlowListeners(callbacks: {
  onTarget: (type: 'click' | 'input', target: EventTarget | null) => void;
  onRestore: () => void;
}) {
  let active = false;
  const options: AddEventListenerOptions = { capture: true, passive: true };
  const onClick = (event: Event) => callbacks.onTarget('click', event.target);
  const onInput = (event: Event) => callbacks.onTarget('input', event.target);
  const onPageShow = (event: Event) => {
    if ('persisted' in event && event.persisted === true) callbacks.onRestore();
  };
  function setActive(next: boolean) {
    if (active === next) return;
    active = next;
    const method = next ? window.addEventListener : window.removeEventListener;
    method.call(window, 'click', onClick, options);
    method.call(window, 'input', onInput, options);
  }
  window.addEventListener('pageshow', onPageShow, options);
  return {
    setActive,
    dispose() {
      setActive(false);
      window.removeEventListener('pageshow', onPageShow, options);
    },
  };
}
