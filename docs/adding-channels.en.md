# Adding a new channel

## Recon (read-only first)

1. Perform one manual search in a browser.
2. DevTools → Network: find where the data comes from (**JSON API preferred**;
   otherwise record the result container selector).
3. Check authentication: clear cookies and retry — still works means IP-based auth.
4. Note pagination style and page size.

## Channel types

| Type | Signal | Implementation |
|---|---|---|
| HTTP/JSON | JSON responses, no browser needed | `fetch` + parse (see `sources/openalex.js`) |
| Rendered DOM | results in HTML | managed Chrome + injected extraction script |
| Interactive | pagination / type switch / click-to-resolve | CDP clicks + condition waits |

## Ready-made skeletons

Two templates are included — copy and rename:

- `sources/_template-http.js` — JSON/HTTP channel (~60 lines)
- `sources/_template-browser.js` — browser channel (~100 lines)

## Three steps per adapter

1. **Locate**: `Page.navigate`, wait for URL change, `waitFor(result container)`, then
   wait until the element count is stable. **Never wait for the `load` event** (some
   sites take ~60s).
2. **Extract**: inject JS returning `JSON.stringify({items, ...})` with normalized fields.
3. **Resolve links**: take them from the DOM, or batch click/register operations
   (`Promise.all`) instead of per-item sleeps.

## Acceptance checklist

- [ ] `node --check sources/xxx.js`
- [ ] `--rows=3` returns items; `--json` contains complete link fields
- [ ] Links return 200/30x (or the site's API criterion passes)
- [ ] Test one Chinese and one English keyword
- [ ] Failures surface a clear error (never silently return zero)
- [ ] Chrome is stopped afterwards; no resident processes
- [ ] Document new pitfalls
