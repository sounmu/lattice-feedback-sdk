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

export type MissingSnapshotAssetReason = 'fetch_failed' | 'too_large' | 'budget_exceeded';

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
  projectKey: string;
  /** Set once the reporter submits the feedback this screen was saved for. */
  feedbackId: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export type ScreenSnapshotSummary = Omit<ScreenSnapshot, 'events'>;

export type CreateScreenSnapshotInput = CapturedScreen & Pick<ScreenSnapshot, 'projectKey'> & { hostOrigin: string };

export interface CreateScreenSnapshotResponse {
  snapshot: ScreenSnapshotSummary;
}

export interface ScreenSnapshotDetailResponse {
  snapshot: ScreenSnapshot;
}
