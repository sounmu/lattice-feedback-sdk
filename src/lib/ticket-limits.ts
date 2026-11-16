// Dependency-free: shared by the admin screen and the server schema.
export const MAX_TICKET_TITLE_LENGTH = 300;
// The largest draft the stored-feedback limits allow is about 273,000 characters (the test in
// ticket-draft.test.ts builds it). Most of that is page addresses: they are stored percent-encoded, so a Korean
// one grows nine times. The limit leaves room above that, so an untouched draft always posts.
export const MAX_TICKET_BODY_LENGTH = 300000;
// Korean text takes up to three bytes a character; the request holds the title too, and JSON escapes add more.
export const MAX_TICKET_REQUEST_BYTES = 1024 * 1024;
/** How long a started ticket blocks another attempt. It is longer than the Notion request timeout. */
export const TICKET_CLAIM_TTL_MS = 60_000;
