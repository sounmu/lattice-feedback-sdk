# Conversation sessions

Apply `supabase/migrations/20261115000000-conversation-sessions.sql` before deploying.
Memory storage supports the same behavior but disappears when the server restarts.

## Customer identity

The current project registry contains only `demo`. Configure a separate, random
`FEEDBACK_IDENTITY_SECRET` for that project on the SDK app and the customer's
backend. It is independent of `FEEDBACK_ADMIN_TOKEN`; never put either secret in
browser code. Future projects must each have their own identity secret in the
project registry.

After authenticating the customer in your backend, sign the authenticated user id:

```ts
import { createHmac } from 'node:crypto';

const projectKey = 'demo';
const id = authenticatedUser.id; // From your server session, not a request parameter.
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const signature = createHmac('sha256', process.env.FEEDBACK_IDENTITY_SECRET!)
  .update(JSON.stringify(['lattice-identity-v1', projectKey, id, expiresAt]))
  .digest('hex');

// Return this object only to this authenticated customer's browser.
const user = {
  id,
  name: authenticatedUser.name,
  identity: { expiresAt, signature },
};
```

In that browser call `window.LatticeFeedback.setUser(user)`. The name is display
metadata; the signature binds the version, project, id and expiry. Proofs expire
within 24 hours (one hour recommended); refresh them through the customer backend.
They are bearer credentials, so use HTTPS. The app compares signatures in constant
time and strips the proof before storing or returning feedback.

Only threads created with a verified identity are associated with that account.
A new browser with the same valid proof can see and continue those threads.
We deliberately do not associate old or unverified threads by their claimed id:
an attacker could previously have submitted using someone else's id.

## Requiring verified identity

Set `FEEDBACK_REQUIRE_VERIFIED_IDENTITY=true` (the `demo` project's setting, default off)
for closed deployments where only the customer's signed-in users may talk to you,
like a messenger's member hash. It needs `FEEDBACK_IDENTITY_SECRET`; values `true` or
`1` turn it on. When on:

- Listing conversations and sending follow-ups need a valid signed identity. Browser
  capabilities are ignored, and a request without a valid signature gets `401`
  `verification_required`. Threads match by verified reporter id only, so threads
  created earlier with only a browser capability are not reachable by reporters.
- New feedback without a valid signature is refused with the same `401`. We refuse
  instead of accepting a thread nobody could read back: the reporter would wait for
  an answer they can never see, and unsigned submissions are exactly the spoofing
  surface this option closes. Text-only feedback keeps working when the option is off.
- No browser capability is issued, so the response has no `conversationSecret` and
  the widget stores nothing. The widget shows "로그인한 사용자만 대화를 볼 수
  있어요" in 내 대화 and a Korean error when sending is refused.
- If the option is on but `FEEDBACK_IDENTITY_SECRET` is missing, no signature can
  verify, so every feedback and conversation request fails closed with `401`, and a
  configuration warning is logged once per server process.

Admin APIs and replies are unaffected. No database migration is needed.

## Unverified browsers

Creation always issues an independent 32-byte random conversation capability.
Only its SHA-256 hash is stored. The widget keeps the capability in localStorage
scoped by project, host origin and the reporter id that submitted; API requests
send it in the body, never a URL. Knowing an id, name, allowed host origin, or
feedback UUID grants no access. The capability authorizes reading and continuing
that conversation regardless of the current display name. This makes the unsigned
demo work without claiming the browser is an authenticated account.

When the host page calls `setUser` with another user, or clears the user, the
widget looks up capabilities only under the new reporter id and sends none of the
previous user's. A page with no user has its own bucket, separate from every id,
so a conversation started while signed out is not shown after signing in, and
switching back to the earlier user shows that user's conversations again. A new
capability is stored under the reporter who submitted, even if the user changed
while the request was in flight. Loaded conversations are shown only to the
reporter they were loaded for. Capabilities saved by earlier versions under a
project and origin key are not read.

The server also refuses a capability presented with a reporter id other than the
one the feedback was created with (a missing user counts as `anonymous`), which
blocks an ordinary user switch even if a client still sends old secrets. The
reporter id of an unsigned browser is only a claim, so this is defence in depth,
not authentication: use verified identities where accounts must be separated.

Clearing browser storage loses unverified access. Shared browser profiles share
these capabilities among anyone who claims the same reporter id. If persistent
storage is blocked, capabilities last only for the mounted widget session. Cross-site storage partitioning can restrict access
to the same top-level customer site. There is no account recovery or retroactive
identity linking in this change.

Reporter responses contain message text, role, timestamps and status only;
saved screens and original page metadata remain behind admin authorization.
Reporter APIs cannot choose a role. Administrator messages require the project's
admin token. SDK facts and future AI messages have separate reserved roles.

## Persistence and limits

The original `message` remains the first reporter message. The migration copies
every nonempty legacy `admin_reply` into the first admin message, preserving its
last known timestamp. Historical overwritten reply versions cannot be recovered.
New replies append; the compatibility `adminReply` field holds the latest reply.
Clearing that field never deletes the thread. Legacy records without trusted
identity or a browser capability remain accessible to administrators only.

Each thread permits 100 messages including the initial message, at most 5,000
characters each. Row locks and a trigger enforce atomic appends and limits in
Postgres; the memory store performs check and append without yielding.
Reporter requests are capped at 32 KiB, 20 writes and 120 reads per minute per
trusted client address; admin updates allow 30 per minute per project/address.
These reuse the existing process-local rate limiter and trusted proxy setting.
Distributed deployments still need a shared gateway limiter.

History shows up to 100 conversations; the browser keeps the latest 100
capabilities. The widget polls every ten seconds while open, aborts its read and
clears the timer when closed or capturing, and reloads immediately on reopening.
No realtime service is required.

## UI integration

Layout: the widget retains its existing header/body/footer and adds a small
navigation entry to a conversation list and detail. The body owns scrolling;
the followup composer remains in the footer. The admin thread sits in the
existing action card above status and reply controls.

Primary action: send a followup (widget), save a new reply/status (admin).
Priority: original report, chronological messages with author labels, composer.
Per-feedback drafts and shortcuts 1/2/3 use the existing helpers with an empty
composer baseline, so the prior sent reply is never resubmitted as a draft.
