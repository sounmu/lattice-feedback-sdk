export function createListenerSet() {
  const listeners = new Set<() => void>();
  return {
    add(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(): void {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.warn('[LatticeFeedback] A listener failed.', error);
        }
      }
    },
  };
}
