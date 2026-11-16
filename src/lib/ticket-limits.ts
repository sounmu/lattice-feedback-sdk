// Dependency-free: shared by the admin screen and the server schema.
export const MAX_TICKET_TITLE_LENGTH = 300;
// The largest draft the stored-feedback limits allow is about 171,000 characters (the test in
// ticket-draft.test.ts builds it). The limit leaves room above that, so an untouched draft always posts.
export const MAX_TICKET_BODY_LENGTH = 200000;
// Korean text takes up to three bytes a character; the request holds the title too, and JSON escapes add more.
export const MAX_TICKET_REQUEST_BYTES = 1024 * 1024;
/** How long a started ticket blocks another attempt. It is longer than the Notion request timeout. */
export const TICKET_CLAIM_TTL_MS = 60_000;
