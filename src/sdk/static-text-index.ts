import {
  AutomaticMasker,
  extractScriptLiterals,
  normalizeStaticText,
  shouldIndexScriptLiteral,
  type AutomaticMaskingOptions,
} from '@/sdk/automatic-masking';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SCRIPTS = 32;
const MAX_LITERALS = 100_000;
const MAX_LITERAL_LENGTH = 4096;
const INDEX_TIMEOUT_MS = 4000;
const WARM_DELAY_MS = 200;
// Class names and inline styles are layout vocabulary, not text; masking them would break the replayed layout.
const UNINDEXED_ATTRIBUTES = new Set(['class', 'style']);
const known = new Set<string>();
let options: AutomaticMaskingOptions = {};
let preparation: Promise<void> | undefined;
let incomplete = true;
let ready = false;

export function configureAutomaticMasking(value: AutomaticMaskingOptions = {}): void {
  options = value;
}

export function createAutomaticMasker(): AutomaticMasker {
  return new AutomaticMasker(known, options);
}

export function isStaticIndexIncomplete(): boolean {
  return incomplete;
}

/** True when nothing is left to wait for: the index finished (even partly) or masking is off. */
export function isStaticIndexReady(): boolean {
  return ready || options.enabled === false;
}

/** Concurrent captures share the same bounded work. A run that read nothing is retried by the next action. */
export function prepareStaticTextIndex(): Promise<void> {
  if (options.enabled === false) return Promise.resolve();
  preparation ??= buildIndex();
  return preparation;
}

/** Starts the work when the reporter opens the widget, in idle time, so capture does not wait for it. */
export function warmStaticTextIndex(): void {
  if (options.enabled === false || preparation) return;
  const start = (): void => void prepareStaticTextIndex();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: WARM_DELAY_MS * 5 });
  } else {
    window.setTimeout(start, WARM_DELAY_MS);
  }
}

/** Same-origin script addresses the page already loaded, in document order, without reading any network body. */
function findScriptUrls(parsed: Document): { urls: string[]; crossOrigin: boolean } {
  const urls = new Set<string>();
  let crossOrigin = false;
  const sdkScripts = [...document.querySelectorAll<HTMLScriptElement>('script[data-project-key][src]')].map((script) => new URL(script.src));
  const add = (address: string): void => {
    let url: URL;
    try {
      url = new URL(address, window.location.href);
    } catch {
      return;
    }
    // The SDK's own script and files are neither the page's text nor an unreadable third party.
    if (sdkScripts.some((script) => script.href === url.href || (script.origin === url.origin && url.origin !== window.location.origin))) return;
    if (url.origin === window.location.origin) urls.add(url.href);
    else crossOrigin = true;
  };
  for (const script of parsed.scripts) {
    const path = script.getAttribute('src');
    if (path) add(path);
  }
  for (const script of document.scripts) {
    if (script.src) add(script.src);
  }
  for (const entry of performance.getEntriesByType('resource')) {
    if ((entry as PerformanceResourceTiming).initiatorType === 'script') add(entry.name);
  }
  return { urls: [...urls], crossOrigin };
}

async function buildIndex(): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS);
  let remaining = MAX_SOURCE_BYTES;
  let omitted = false;
  const add = (text: string): void => {
    const normalized = normalizeStaticText(text);
    if (normalized.length > MAX_LITERAL_LENGTH || known.size >= MAX_LITERALS) {
      omitted = true;
      return;
    }
    if (normalized) known.add(normalized);
  };
  const readSource = async (url: string): Promise<string> => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', redirect: 'error', signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Static source unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let source = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return source + decoder.decode();
        remaining -= chunk.value.byteLength;
        if (remaining < 0) throw new Error('Static source budget exceeded');
        source += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
  };
  const addScript = (source: string, decoder: HTMLTextAreaElement): void => {
    for (const literal of extractScriptLiterals(source)) {
      if (!shouldIndexScriptLiteral(literal)) continue;
      add(literal);
      // Strings rendered as HTML can spell entities rather than the displayed characters.
      decoder.innerHTML = literal;
      add(decoder.value);
    }
  };
  let documentRead = false;
  try {
    const html = await readSource(window.location.href);
    documentRead = true;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const walker = parsed.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent && !parent.closest('script, style, [data-lattice-mask], [data-lattice-block]')) {
        add(walker.currentNode.textContent ?? '');
      }
    }
    for (const element of parsed.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        if (!UNINDEXED_ATTRIBUTES.has(attribute.name)) add(attribute.value);
      }
    }
    const decoder = parsed.createElement('textarea');
    for (const script of parsed.scripts) {
      if (!script.getAttribute('src')) addScript(script.textContent ?? '', decoder);
    }
    const { urls, crossOrigin } = findScriptUrls(parsed);
    if (crossOrigin || urls.length > MAX_SCRIPTS) omitted = true;
    for (const url of urls.slice(0, MAX_SCRIPTS)) {
      try {
        addScript(await readSource(url), decoder);
      } catch {
        omitted = true;
      }
    }
    incomplete = omitted;
  } catch {
    // This boundary deliberately keeps only already-proven literals. No error includes source text.
    incomplete = true;
  } finally {
    window.clearTimeout(timer);
    ready = true;
    if (!documentRead) preparation = undefined;
  }
}
