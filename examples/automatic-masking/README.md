# Automatic masking fixture

Run the app on 3141 and serve this directory on 4141. Open
`http://localhost:4141/`. `data.json` and `mutation.json` contain fictional
business values; neither is used to build the static text index. The Refresh
order button fetches the second document after Flow starts.

Use `?commented=on` to enable the exact Comment target exemption, or
`?masking=off` to disable automatic masking. Password and explicit mask/block
rules still apply. `data-lattice-keep` is the customer-controlled subtree
override; it never overrides password, mask, or block exclusions.

## Classification

Automatic masking is enabled by default. Capture policy accepts:

```json
{
  "allowedPaths": ["/"],
  "targets": [],
  "automaticMasking": {
    "enabled": true,
    "keepCommentedText": false
  }
}
```

When the reporter opens the widget (in idle time) or starts a capture, the SDK
fetches the current document and up to 32 same-origin scripts the page already
loaded, listed from the DOM and resource timing, never from network bodies.
The SDK's own script is skipped. The aggregate download budget is 4 MiB and the
deadline is 4 seconds. Requests are streamed, bounded,
same-origin, cached, and do not follow redirects. Concurrent captures share
one promise per document. Source is parsed in the browser and discarded;
only extracted literals remain in memory. There is no fetch/XHR patch and no
inspection of the host application's API responses or browser storage.

The index holds at most 100,000 normalized strings of at most 4,096 characters.
A script literal with digits and no letter ("12,000") never proves text static;
markup text keeps its numbers.
HTML entities, whitespace normalization, escaped JS characters, i18n object
values, and adjacent literal concatenation are supported. Expressions,
variable concatenation, template interpolation, runtime translation downloads,
cross-origin scripts, and sources over budget do not prove a static match.
Those values are masked. A failed source does not discard literals already
proven by other sources. The missing/omitted report records incomplete indexing.

All non-whitespace UTF-16 code units become filled circles. Digits and
punctuation are hidden because their pattern can disclose values; whitespace
is preserved because it determines line breaks and word spacing. This keeps
JavaScript string length (an astral character becomes two circles), not
grapheme count. Character count is not a promise of identical glyph widths
with proportional fonts. This fixture uses fixed-width text to compare layout.

The commented-element option keeps only direct text-node children of the
exact element with a submitted Comment pin. It does not reveal descendant
text, attributes, form values, ancestors, or every element selected in the UI.
Earlier saved snapshots and Flow recordings are never retrospectively unmasked.

## Text paths

| Path | Handling |
| --- | --- |
| Full snapshot text and contenteditable | Classified in the serialized copy before postMessage/upload |
| Flow added nodes and changed text | Classified before the recorder appends its event to browser storage |
| input, textarea, select values | Classified by the rrweb input hook and serialized-event sanitizer; passwords stay forced |
| Password/hidden inputs and token meta | Existing removal plus forced password masking wins over exemptions |
| value, placeholder, title, alt, aria-label, aria-description, label, content, data-* | Classified; viewport meta content remains structural |
| id, name | Classified against source attributes/literals |
| class, style | Not classified: layout vocabulary, not text; use `data-lattice-block` if a class encodes data |
| Comment/Edit pin labels | Existing configured identifiers or tag names, never element text |
| Flow target labels | Existing configured identifiers or tag names, never element text |
| Page title | Classified before metadata transmission and storage |
| Page URLs / event paths | Existing origin/path contract retained; query and fragment omitted from page metadata |
| DOM/CSS resource URLs | Existing section 5 contract retained, including query strings; use `data-lattice-block` for sensitive URLs |
| CSS | Retained as layout instructions; automatic classification does not parse CSS-generated business text |
| Widget preview / admin replay | Render the same already-masked payload; no original text is sent for later UI masking |
| Omissions | Counts only, plus incomplete-index status; no original text in diagnostics |

The explicit reporter identity and the reporter's own feedback/comment prose
remain intentional input, separate from automatically captured page text.

## Limits

This is an estimate of source provenance, not a general PII detector. Data
embedded in delivered HTML, a bundle, an i18n table, or a mock-data demo counts
as static. A fetched value identical to a known literal also counts as static.
Server-rendered personalized HTML has the same limitation. Cross-origin and
lazy scripts may cause over-masking. A resumed Flow waits for the index before
its first snapshot. Text that mixes a static phrase with a value in one text node
("Showing 14 of 14 orders") is masked whole. Turning automatic masking off keeps
the earlier behavior: Flow inputs stay masked as `*`.

Business values encoded into URL paths, resource URLs, CSS, pixels, or unsupported
rendering surfaces are outside text classification. Exclude those regions with
`data-lattice-block`. Safe subtree markers are assertions by the customer, not
automatic detection. Circles preserve character count but cannot guarantee
unchanged line wrapping under every font.

No migration is needed: omission reasons use the existing JSON array column.
