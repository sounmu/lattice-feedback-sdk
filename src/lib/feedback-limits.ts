// Dependency-free: shared by the SDK bundle and the server schema.
export const MAX_PAGE_TITLE_LENGTH = 200;
export const MAX_USER_AGENT_LENGTH = 512;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_COMMENTS = 20;
export const MAX_EDITS = 10;
export const MAX_FLOW_EVENTS = 200;
export const MAX_FEEDBACK_BYTES = 65536;

// Saved screens carry the page's DOM, CSS, and same-origin fonts/images, so they have their own budgets.
export const MAX_SCREEN_SNAPSHOT_BYTES = 12 * 1024 * 1024;
export const MAX_SNAPSHOT_ASSET_BYTES = 3 * 1024 * 1024;
export const MAX_SNAPSHOT_ASSETS_TOTAL_BYTES = 6 * 1024 * 1024;
export const MAX_MISSING_SNAPSHOT_ASSETS = 50;
export const MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK = 5;

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  // Iterate by code point so a surrogate pair (e.g. emoji) is never split in half.
  let result = '';
  for (const character of value) {
    if (result.length + character.length > maxLength) {
      break;
    }
    result += character;
  }
  return result;
}
