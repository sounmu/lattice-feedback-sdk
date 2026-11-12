// Dependency-free: shared by the SDK bundle and the server schema.
export const MAX_PAGE_TITLE_LENGTH = 200;
export const MAX_USER_AGENT_LENGTH = 512;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_COMMENTS = 20;
export const MAX_EDITS = 10;
export const MAX_FLOW_EVENTS = 200;
export const MAX_FEEDBACK_BYTES = 65536;

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
