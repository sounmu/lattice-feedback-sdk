// A saved screen: what the reporter was looking at, stored as rrweb events so the admin
// viewer can rebuild it without reaching the host service. Types only.

export type ScreenSnapshotFormat = 'rrweb-2';

export interface ScreenSnapshotPage {
  /** origin + pathname only, never query or hash. */
  url: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
}

export type MissingSnapshotAssetReason = 'fetch_failed' | 'too_large' | 'budget_exceeded' | 'timed_out';

/** A font or image the SDK could not embed. The viewer lists these instead of hiding the gap. */
export interface MissingSnapshotAsset {
  /** origin + pathname only. */
  url: string;
  reason: MissingSnapshotAssetReason;
}

/** An rrweb event. Only the replayer reads `data`. */
export interface ScreenSnapshotEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

/**
 * A comment the reporter attached to an element on this screen. Stored as an rrweb custom event
 * after the full snapshot, so the admin viewer can pin it to the same rebuilt element.
 */
export interface ScreenCommentPin {
  /** 1-based position of the comment in the feedback. */
  number: number;
  /** Stays the same for a comment even when earlier comments are removed and numbers shift. */
  key: string;
  /** rrweb node id of the element, or null when it was not serialized. */
  nodeId: number | null;
  /** Document coordinates at capture time, used when the node cannot be found. */
  rect: { x: number; y: number; width: number; height: number };
  /** Where the reporter clicked inside the element, as fractions of its width and height. */
  offset: { x: number; y: number };
  /** data-feedback-id or tag name of the element. */
  label: string;
  comment: string;
}

/**
 * A position change the reporter proposed by dragging an element. Stored as an rrweb custom event
 * so the admin viewer can move the same rebuilt element and compare both positions.
 */
export interface ScreenEditMove {
  /** 1-based position of the edit in the feedback. */
  number: number;
  /** Stays the same for an edit even when earlier edits are removed and numbers shift. */
  key: string;
  nodeId: number | null;
  /** Document coordinates before and after the drag. */
  originalRect: ScreenCommentPin['rect'];
  proposedRect: ScreenCommentPin['rect'];
  label: string;
}

export interface CapturedScreen {
  format: ScreenSnapshotFormat;
  /** ISO timestamp. */
  capturedAt: string;
  page: ScreenSnapshotPage;
  events: ScreenSnapshotEvent[];
  missingAssets: MissingSnapshotAsset[];
}

export type ScreenCaptureFailureReason = 'page_not_allowed' | 'capture_failed';

export interface ScreenSnapshot extends CapturedScreen {
  id: string;
  /** SHA-256 of each embedded font or image; the events refer to them by position. */
  assetHashes: string[];
  projectKey: string;
  /** Set once the reporter submits the feedback this screen was saved for. */
  feedbackId: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export type ScreenSnapshotSummary = Omit<ScreenSnapshot, 'events'>;

export type CreateScreenSnapshotInput = CapturedScreen & Pick<ScreenSnapshot, 'projectKey' | 'assetHashes'> & { hostOrigin: string };

/** What the SDK hands to the widget: the screen plus the files its asset references point to, in order. */
export interface ScreenCapture {
  screen: CapturedScreen;
  assetFiles: Blob[];
}

export interface ScreenSnapshotAssetFile {
  contentType: string;
  data: Uint8Array;
}

export interface FindMissingScreenSnapshotAssetsInput extends Pick<CreateScreenSnapshotInput, 'projectKey' | 'hostOrigin'> {
  /** The captured page, so the server applies its path policy before accepting any file. */
  pageUrl: string;
  hashes: string[];
}

export interface FindMissingScreenSnapshotAssetsResponse {
  missingHashes: string[];
}

export interface CreateScreenSnapshotResponse {
  snapshot: ScreenSnapshotSummary;
}

export interface ScreenSnapshotDetailResponse {
  snapshot: ScreenSnapshot;
}
