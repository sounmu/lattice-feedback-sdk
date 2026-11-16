// Dependency-free: the SDK writes these references into a saved screen and the admin viewer
// resolves them. A reference names an asset by its position in the screen's asset list.
export const SNAPSHOT_ASSET_HASH_PATTERN = /^[0-9a-f]{64}$/;

const ASSET_REFERENCE_PREFIX = 'lattice-asset:';
const ASSET_REFERENCE_PATTERN = /lattice-asset:(\d+)/g;

export function createAssetReference(index: number): string {
  return `${ASSET_REFERENCE_PREFIX}${index}`;
}

export function resolveAssetReferences(text: string, resolve: (index: number) => string | null): string {
  return text.replace(ASSET_REFERENCE_PATTERN, (reference, index: string) => resolve(Number(index)) ?? reference);
}

// A new tree: the replayer may change what it is given, and the saved events must stay as they were read.
export function copyWithResolvedAssetReferences(value: unknown, resolve: (index: number) => string | null): unknown {
  if (typeof value === 'string') {
    return value.includes(ASSET_REFERENCE_PREFIX) ? resolveAssetReferences(value, resolve) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => copyWithResolvedAssetReferences(item, resolve));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyWithResolvedAssetReferences(entry, resolve)]),
    );
  }
  return value;
}
