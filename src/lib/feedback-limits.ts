// Dependency-free: shared by the SDK bundle and the server schema.
export const MAX_PAGE_TITLE_LENGTH = 200;
export const MAX_USER_AGENT_LENGTH = 512;

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
