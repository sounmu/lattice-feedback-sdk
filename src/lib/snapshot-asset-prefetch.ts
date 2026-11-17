import type { AdminRequestInput } from '@/lib/admin-api';
import type { ReplayTiming } from '@/lib/replay-timing';

export interface SnapshotAssetScope extends Readonly<Pick<AdminRequestInput, 'projectKey' | 'token'>> {
  readonly signal: AbortSignal;
}

export interface SnapshotAssetPrefetch {
  prefetch(hashes: readonly string[]): void;
  /** A blob: URL for each hash in order, null for a file that could not be loaded. The caller revokes them. */
  loadUrls(hashes: readonly string[]): Promise<(string | null)[]>;
}

const rememberedAssetHashes = new Map<string, readonly string[]>();

function getRememberedKey(projectKey: string, snapshotId: string): string {
  return `${projectKey}:${snapshotId}`;
}

export function rememberSnapshotAssetHashes(projectKey: string, snapshotId: string, hashes: readonly string[]): void {
  rememberedAssetHashes.set(getRememberedKey(projectKey, snapshotId), hashes);
}

export function findRememberedAssetHashes(projectKey: string, snapshotId: string): readonly string[] {
  return rememberedAssetHashes.get(getRememberedKey(projectKey, snapshotId)) ?? [];
}

async function fetchAssetBlob(hash: string, { projectKey, token, signal }: SnapshotAssetScope): Promise<Blob | null> {
  try {
    const response = await fetch(`/api/snapshots/assets/${hash}?projectKey=${encodeURIComponent(projectKey)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    return response.ok ? await response.blob() : null;
  } catch {
    // An unreachable or cancelled file is reported as not loaded; the replay shows how many are missing.
    return null;
  }
}

export function createSnapshotAssetPrefetch(scope: SnapshotAssetScope, timing?: ReplayTiming): SnapshotAssetPrefetch {
  const blobs = new Map<string, Promise<Blob | null>>();

  function requestBlob(hash: string): Promise<Blob | null> {
    const existing = blobs.get(hash);
    if (existing) {
      return existing;
    }
    if (blobs.size === 0) {
      timing?.mark('assets-start');
    }
    const requested = fetchAssetBlob(hash, scope);
    blobs.set(hash, requested);
    return requested;
  }

  return {
    prefetch(hashes) {
      for (const hash of hashes) {
        void requestBlob(hash);
      }
    },
    async loadUrls(hashes) {
      const urls = new Map(
        await Promise.all(
          [...new Set(hashes)].map(async (hash): Promise<[string, string | null]> => {
            const blob = await requestBlob(hash);
            return [hash, blob && URL.createObjectURL(blob)];
          }),
        ),
      );
      return hashes.map((hash) => urls.get(hash) ?? null);
    },
  };
}
