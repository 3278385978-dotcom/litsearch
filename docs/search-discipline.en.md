# Search discipline

## Only do what was asked

- "Find papers" → paper channels only; "find code" → GitHub only; "find books" → book
  channels only.
- If the type is unspecified, run papers and *mention* that a book search is available —
  do not query book channels proactively (low information density, token-hungry).
- Do not run channels outside the requested scope; public APIs are off by default and
  require `--src=public`.

## Bibliographic records only

- Never open full text, download PDFs or scrape body content; "find" means
  title / authors / venue / year / citations / link.
- Only read or download when explicitly asked.

## Links must be verified

- Copy links **verbatim** from the `--json` output (no retyping, ellipses or placeholders).
- External links: `curl` 200/30x counts as OK; **SPA detail pages are valid only when the
  backend API returns a body object** (HTTP 200 alone proves nothing).
- Sample-verify per domain; do not open a browser per link. 403/429 means anti-bot or
  rate limiting — report it honestly, never as 404.
- If verification fails, keep the record and fall back to the publisher URL with a ⚠️;
  never ship a fake link.

## Compliance

- Subscription resources: search only, single-item reading; no bulk scraping, no
  mirroring/redistribution.
- Document delivery / interlibrary requests must be submitted by the user personally.
- Never read or expose credentials.
