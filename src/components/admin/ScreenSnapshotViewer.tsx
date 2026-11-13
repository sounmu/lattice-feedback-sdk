'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';

import {
  CommentPinList,
  CommentPinOverlay,
  EditMoveList,
  EditMoveOverlay,
  type MoveBox,
  type PinBox,
} from '@/components/admin/ScreenMarkOverlay';
import { findCommentPins, findEditMoves } from '@/lib/screen-snapshot';
import { resolveAssetReferences } from '@/lib/snapshot-asset-references';
import type {
  MissingSnapshotAssetReason,
  ScreenCommentPin,
  ScreenEditMove,
  ScreenSnapshot,
  ScreenSnapshotDetailResponse,
} from '@/types/screen-snapshot';

type ReplayerEvents = ConstructorParameters<typeof Replayer>[0];
type ZoomMode = 'fit' | 'actual';
type LoadResult = { key: string; snapshot: ScreenSnapshot } | { key: string; status: number };

const DEFAULT_PROJECT_KEY = 'demo';
const UNAUTHORIZED_STATUS = 401;
const ADMIN_TOKEN_STORAGE_KEY = 'lattice-feedback:admin-token';
const ADMIN_TOKEN_EVENT = 'lattice-feedback:admin-token-change';
const BUTTON_CLASS = 'min-h-11 rounded border bg-white px-3 py-2 text-sm aria-pressed:bg-gray-900 aria-pressed:text-white';

const MISSING_ASSET_REASON_LABELS: Record<MissingSnapshotAssetReason, string> = {
  fetch_failed: '가져오지 못함',
  too_large: '파일이 너무 큼',
  budget_exceeded: '전체 용량 한도 초과',
  timed_out: '저장 시간 초과',
};

function subscribeToAdminToken(listener: () => void): () => void {
  window.addEventListener(ADMIN_TOKEN_EVENT, listener);
  return () => window.removeEventListener(ADMIN_TOKEN_EVENT, listener);
}

function getAdminToken(): string {
  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
}

function getServerAdminToken(): string {
  return '';
}

function saveAdminToken(token: string): void {
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  window.dispatchEvent(new Event(ADMIN_TOKEN_EVENT));
}

function getLoadErrorMessage(status: number): string {
  switch (status) {
    case UNAUTHORIZED_STATUS:
      return '관리자 토큰이 올바르지 않습니다.';
    case 404:
      return '저장된 화면을 찾을 수 없습니다.';
    case 503:
      return '화면 저장소를 사용할 수 없습니다.';
    default:
      return '저장된 화면을 불러오지 못했습니다.';
  }
}

function canScroll(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const { overflowX, overflowY } = view.getComputedStyle(element);
  const isScrollable = (overflow: string) => overflow === 'auto' || overflow === 'scroll';
  return (
    (isScrollable(overflowY) && element.scrollHeight > element.clientHeight) ||
    (isScrollable(overflowX) && element.scrollWidth > element.clientWidth)
  );
}

// The rebuilt page stays non-interactive. Only wheel scrolling is forwarded, to the scroll
// container under the pointer, so a long page or an inner list can still be read.
function scrollSavedScreen(frame: HTMLIFrameElement, event: WheelEvent): void {
  const frameDocument = frame.contentDocument;
  if (!frameDocument) {
    return;
  }
  const bounds = frame.getBoundingClientRect();
  const scale = bounds.width / frame.clientWidth;
  let target = frameDocument.elementFromPoint((event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale);
  while (target && !canScroll(target)) {
    target = target.parentElement;
  }
  (target ?? frameDocument.scrollingElement)?.scrollBy(event.deltaX, event.deltaY);
}

// Finds the pinned element in the rebuilt page. When it was not serialized, the saved document
// coordinates are shifted by the rebuilt page's scroll instead.
// A point outside any ancestor that clips its content (a scrolled list, for example) is not visible,
// even when it is still inside the page's viewport.
function isPointClipped(element: Element, x: number, y: number): boolean {
  const view = element.ownerDocument.defaultView;
  for (let ancestor = element.parentElement; ancestor && view; ancestor = ancestor.parentElement) {
    const { overflowX, overflowY } = view.getComputedStyle(ancestor);
    if (overflowX === 'visible' && overflowY === 'visible') {
      continue;
    }
    const clip = ancestor.getBoundingClientRect();
    if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) {
      return true;
    }
  }
  return false;
}

function measurePin(replayer: Replayer, pin: ScreenCommentPin): PinBox {
  const node = pin.nodeId === null ? null : replayer.getMirror().getNode(pin.nodeId);
  if (node && 'getBoundingClientRect' in node) {
    const bounds = (node as Element).getBoundingClientRect();
    if (bounds.width > 0 || bounds.height > 0) {
      const isClipped = isPointClipped(
        node as Element,
        bounds.left + pin.offset.x * bounds.width,
        bounds.top + pin.offset.y * bounds.height,
      );
      return { pin, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, isClipped };
    }
  }
  const view = replayer.iframe.contentWindow;
  return {
    pin,
    x: pin.rect.x - (view?.scrollX ?? 0),
    y: pin.rect.y - (view?.scrollY ?? 0),
    width: pin.rect.width,
    height: pin.rect.height,
    isClipped: false,
  };
}

function findMarkedElement(replayer: Replayer, nodeId: number | null): HTMLElement | null {
  const node = nodeId === null ? null : replayer.getMirror().getNode(nodeId);
  // The node lives in the replay iframe's realm, so instanceof HTMLElement would be false.
  return node && 'style' in node && 'getBoundingClientRect' in node ? (node as HTMLElement) : null;
}

function getMoveDelta(move: ScreenEditMove): { x: number; y: number } {
  return { x: move.proposedRect.x - move.originalRect.x, y: move.proposedRect.y - move.originalRect.y };
}

const MOVE_CLONE_ATTRIBUTE = 'data-lattice-move-clone';
// Inherited text styles are copied because the clone leaves the element's ancestors.
const INHERITED_STYLE_PROPERTIES = ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'];

// The original element keeps its layout box (it is only hidden while the proposal is shown), so its
// bounds are the original position either way.
function measureMove(replayer: Replayer, move: ScreenEditMove): MoveBox {
  const delta = getMoveDelta(move);
  const element = findMarkedElement(replayer, move.nodeId);
  const bounds = element?.getBoundingClientRect();
  let original = { ...move.originalRect };
  if (bounds && (bounds.width > 0 || bounds.height > 0)) {
    original = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
  } else {
    const view = replayer.iframe.contentWindow;
    original = { ...original, x: original.x - (view?.scrollX ?? 0), y: original.y - (view?.scrollY ?? 0) };
  }
  return { move, original, proposed: { ...original, x: original.x + delta.x, y: original.y + delta.y } };
}

// Only the rebuilt page in the sandboxed iframe changes; the host page is never touched. The proposal
// is drawn as a copy placed in document coordinates, so an ancestor's overflow cannot clip it.
function showProposedPositions(replayer: Replayer, moves: ScreenEditMove[], isShown: boolean): void {
  const frameDocument = replayer.iframe.contentDocument;
  const view = replayer.iframe.contentWindow;
  frameDocument?.querySelectorAll(`[${MOVE_CLONE_ATTRIBUTE}]`).forEach((clone) => clone.remove());
  for (const move of moves) {
    const element = findMarkedElement(replayer, move.nodeId);
    if (!element || !frameDocument || !view) {
      continue;
    }
    element.style.removeProperty('visibility');
    if (!isShown) {
      continue;
    }
    const bounds = element.getBoundingClientRect();
    const computed = view.getComputedStyle(element);
    const delta = getMoveDelta(move);
    const clone = element.cloneNode(true) as HTMLElement;
    clone.setAttribute(MOVE_CLONE_ATTRIBUTE, '');
    for (const property of INHERITED_STYLE_PROPERTIES) {
      clone.style.setProperty(property, computed.getPropertyValue(property));
    }
    Object.assign(clone.style, {
      position: 'absolute',
      left: `${bounds.left + view.scrollX + delta.x}px`,
      top: `${bounds.top + view.scrollY + delta.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      margin: '0',
      boxSizing: 'border-box',
      zIndex: '2147483647',
    });
    frameDocument.documentElement.appendChild(clone);
    element.style.setProperty('visibility', 'hidden');
  }
}

function AdminTokenForm() {
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim()) {
      saveAdminToken(value.trim());
    }
  }

  return (
    <form className="flex max-w-md flex-col gap-2" onSubmit={handleSubmit}>
      <label className="text-sm" htmlFor="admin-token">
        관리자 토큰
      </label>
      <input
        id="admin-token"
        type="password"
        autoComplete="off"
        className="min-h-11 rounded border bg-white p-2 text-sm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className={BUTTON_CLASS}>
        화면 열기
      </button>
    </form>
  );
}

interface ScreenReplayProps {
  snapshot: ScreenSnapshot;
  projectKey: string;
  token: string;
}

// Asset files need the admin token, so they are fetched here and handed to the replay as blob: URLs.
async function fetchAssetUrl(hash: string, projectKey: string, token: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/snapshots/assets/${hash}?projectKey=${encodeURIComponent(projectKey)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return null;
    }
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

function ScreenReplay({ snapshot, projectKey, token }: ScreenReplayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [unloadedAssetCount, setUnloadedAssetCount] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const { viewportWidth, viewportHeight } = snapshot.page;
  const pins = useMemo(() => findCommentPins(snapshot.events), [snapshot]);
  const moves = useMemo(() => findEditMoves(snapshot.events), [snapshot]);
  const [pinBoxes, setPinBoxes] = useState<PinBox[]>([]);
  const [moveBoxes, setMoveBoxes] = useState<MoveBox[]>([]);
  const [selectedPin, setSelectedPin] = useState<number | null>(null);
  const [showsProposed, setShowsProposed] = useState(false);
  const replayerRef = useRef<Replayer | null>(null);
  const showsProposedRef = useRef(false);

  const measureMarks = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) {
      return;
    }
    setPinBoxes(pins.map((pin) => measurePin(replayer, pin)));
    setMoveBoxes(moves.map((move) => measureMove(replayer, move)));
  }, [pins, moves]);

  function toggleProposed() {
    const next = !showsProposedRef.current;
    showsProposedRef.current = next;
    if (replayerRef.current) {
      showProposedPositions(replayerRef.current, moves, next);
    }
    setShowsProposed(next);
    measureMarks();
  }

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver((entries) => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    let replayer: Replayer | null = null;
    let isCancelled = false;
    let assetUrls: (string | null)[] = [];
    let frameDocument: Document | null = null;

    function measurePins() {
      if (!isCancelled) {
        measureMarks();
      }
    }

    // Marks follow the rebuilt page as it (or a scroll container inside it) is scrolled and once its
    // fonts have changed the layout.
    // A rebuild reopens the same document object, which drops its listeners, so they are added again.
    function followMarks() {
      frameDocument?.removeEventListener('scroll', measurePins, { capture: true });
      frameDocument = replayer?.iframe.contentDocument ?? null;
      frameDocument?.addEventListener('scroll', measurePins, { capture: true, passive: true });
      void frameDocument?.fonts.ready.then(measurePins);
      measurePins();
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      if (replayer) {
        scrollSavedScreen(replayer.iframe, event);
      }
    }

    async function mount(root: HTMLDivElement) {
      // Loaded in the browser only: rrweb expects a DOM when its module is evaluated.
      const [{ Replayer: ReplayerClass }, urls] = await Promise.all([
        import('@rrweb/replay'),
        Promise.all(snapshot.assetHashes.map((hash) => fetchAssetUrl(hash, projectKey, token))),
      ]);
      assetUrls = urls;
      if (isCancelled) {
        urls.forEach((url) => url && URL.revokeObjectURL(url));
        return;
      }
      setUnloadedAssetCount(urls.filter((url) => url === null).length);
      const events = JSON.parse(
        resolveAssetReferences(JSON.stringify(snapshot.events), (index) => urls[index] ?? null),
      ) as ReplayerEvents;
      // rrweb strips scripts and rebuilds into an iframe sandboxed without allow-scripts.
      replayer = new ReplayerClass(events, {
        root,
        mouseTail: false,
        showWarning: false,
        triggerFocus: false,
      });
      const hasMarks = pins.length > 0 || moves.length > 0;
      if (hasMarks) {
        // Rebuilding the page replaces its document, so the scroll watch is attached after each rebuild.
        replayer.on('fullsnapshot-rebuilded', followMarks);
      }
      replayer.pause(0);
      replayerRef.current = replayer;
      showsProposedRef.current = false;
      if (hasMarks) {
        followMarks();
      }
    }

    void mount(stage);
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      isCancelled = true;
      stage.removeEventListener('wheel', handleWheel);
      frameDocument?.removeEventListener('scroll', measurePins, { capture: true });
      replayer?.destroy();
      replayerRef.current = null;
      stage.replaceChildren();
      assetUrls.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, [snapshot, projectKey, token, pins, moves, measureMarks]);

  // Rendered at the captured viewport size and scaled as a whole, so the page never reflows.
  let scale = 1;
  if (zoomMode === 'fit' && availableWidth !== null) {
    scale = Math.min(1, availableWidth / viewportWidth);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON_CLASS} aria-pressed={zoomMode === 'fit'} onClick={() => setZoomMode('fit')}>
          화면에 맞춤
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-pressed={zoomMode === 'actual'}
          onClick={() => setZoomMode('actual')}
        >
          실제 크기
        </button>
        <span className="text-xs text-gray-600">{Math.round(scale * 100)}% · 마우스 휠로 저장된 화면을 스크롤할 수 있습니다.</span>
        {unloadedAssetCount > 0 && (
          <span role="alert" className="text-xs text-amber-700">
            저장된 글꼴·이미지 {unloadedAssetCount}개를 불러오지 못했습니다.
          </span>
        )}
      </div>
      <div ref={frameRef} className="w-full overflow-auto rounded border bg-white">
        <div className="overflow-hidden" style={{ width: viewportWidth * scale, height: viewportHeight * scale }}>
          <div
            className="relative"
            style={{ width: viewportWidth, height: viewportHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <div
              ref={stageRef}
              role="img"
              aria-label="저장된 화면"
              className="[&_.replayer-mouse]:hidden [&_.replayer-mouse-tail]:hidden"
              style={{ width: viewportWidth, height: viewportHeight }}
            />
            <EditMoveOverlay boxes={moveBoxes} scale={scale} showsProposed={showsProposed} />
            <CommentPinOverlay
              boxes={pinBoxes}
              width={viewportWidth}
              height={viewportHeight}
              scale={scale} selectedNumber={selectedPin} onSelect={setSelectedPin} />
          </div>
        </div>
      </div>
      {moves.length > 0 && <EditMoveList moves={moves} showsProposed={showsProposed} onToggle={toggleProposed} />}
      {pins.length > 0 && <CommentPinList pins={pins} selectedNumber={selectedPin} onSelect={setSelectedPin} />}
    </div>
  );
}

function ScreenSnapshotDetails({ snapshot }: { snapshot: ScreenSnapshot }) {
  const { page, missingAssets } = snapshot;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="break-all font-medium">{page.url}</p>
      <p className="text-xs text-gray-600">
        {page.title} · {page.viewportWidth}×{page.viewportHeight} · 스크롤 ({Math.round(page.scrollX)}, {Math.round(page.scrollY)}) ·{' '}
        {new Date(snapshot.capturedAt).toLocaleString('ko-KR')} 저장
      </p>
      {missingAssets.length > 0 && (
        <details className="text-xs text-amber-700">
          <summary>저장하지 못한 글꼴·이미지 {missingAssets.length}개</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {missingAssets.map((asset) => (
              <li key={asset.url} className="break-all">
                {asset.url} ({MISSING_ASSET_REASON_LABELS[asset.reason]})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ScreenSnapshotViewer() {
  const { id } = useParams<{ id: string }>();
  const projectKey = useSearchParams().get('projectKey') ?? DEFAULT_PROJECT_KEY;
  const token = useSyncExternalStore(subscribeToAdminToken, getAdminToken, getServerAdminToken);
  const [result, setResult] = useState<LoadResult | null>(null);
  const requestKey = `${projectKey}:${id}:${token}`;

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/snapshots/${encodeURIComponent(id)}?projectKey=${encodeURIComponent(projectKey)}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          setResult({ key: requestKey, status: response.status });
          return;
        }
        const body = (await response.json()) as ScreenSnapshotDetailResponse;
        setResult({ key: requestKey, snapshot: body.snapshot });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, status: 0 });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [id, projectKey, token, requestKey]);

  function renderBody() {
    if (!token) {
      return <AdminTokenForm />;
    }
    if (!result || result.key !== requestKey) {
      return <p className="text-sm text-gray-600">저장된 화면을 불러오는 중입니다…</p>;
    }
    if ('status' in result) {
      return (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-red-600">
            {getLoadErrorMessage(result.status)}
          </p>
          {result.status === UNAUTHORIZED_STATUS && <AdminTokenForm />}
        </div>
      );
    }
    return (
      <>
        <ScreenSnapshotDetails snapshot={result.snapshot} />
        <ScreenReplay snapshot={result.snapshot} projectKey={projectKey} token={token} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-gray-100 p-4 text-gray-900">
      <h1 className="text-base font-semibold">저장된 화면</h1>
      {renderBody()}
    </main>
  );
}
