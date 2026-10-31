# Performance notes

| Scenario | Before | After | Technique |
|---|---|---|---|
| CNKI search | 64.2s | 3.5s | don't wait for `load`; wait for table stability |
| SPIS search | 61.7s | 11.8s | same + batched detail registration/verification |
| OPAC (library) | 6.3s | 2.3s | wait only for `location.origin` |
| 20 SPIS detail pages | 71.4s | 6.8s | one eval with `Promise.all` |
| Default 9 channels | — | ~9s | HTTP channels in parallel, browser channels reuse one page |

## Four rules

1. **Never wait for `load`** (discovery systems may take 60s) — wait for URL + container
   stability instead.
2. **Batch API calls**: one eval instead of per-item calls — orders of magnitude faster.
3. **Replace fixed sleeps with condition waits** (with timeouts): first-row change,
   stable card count, etc.
4. **Fetch everything in one pass**: `--json` to disk (SPIS returns detail links by default); never re-run a
   search just to resolve links.

## Incremental paging (2026-10-29)

| Scenario | Before | After |
|---|---|---|
| Requesting 10/20/30 records in sequence (SPIS) | re-fetched from page 1 every time (1+2+3 = 6 pages) | only missing pages are fetched (3 pages total) |
| Re-requesting already-fetched pages | new browser + full re-fetch | full cache hit **0.05–0.08s** (no Chrome start) |

Page-level cache (30 min TTL) + `--offset` window; missing pages are fetched in contiguous
blocks; only fixed-page-size channels benefit (CNKI 20/page, SPIS 10/page); HTTP channels
map `--offset` directly onto their pagination parameters.

## Rate limits and stability

- Throttle aggressive sites (e.g. CXStar: bursts trigger 429 with `retry-after`; wait
  ≥2.5s and stop on 429 instead of retrying).
- Network errors (ETIMEDOUT / fetch failed) are marked as *skipped*, not channel failures.
