# Usage guide for AI agents / new users

> Shortest path and hard rules, so an agent can use the tool without guessing.
> Deeper pitfalls: `docs/troubleshooting.en.md`; method: `docs/adding-channels.en.md`,
> `docs/search-discipline.en.md`.

## 1. Quick start

```bash
cd <tool-dir>
node find.js --check                                   # environment check (auth/network/browser)
node find.js "keywords" --rows=5                       # default: papers + code
node find.js "keywords" --src=spis --rows=5            # specific channel (SPIS returns detail links)
node find.js "keywords" --src=public --rows=5          # public APIs (no auth)
node find.js "keywords" --src=papers --rows=5 --json > out.json   # machine-readable
```

## 2. Defaults

| Item | Default | Note |
|---|---|---|
| Channels | `papers` + `code` | no public APIs, no books |
| SPIS links | **detail page** (`--link=detail`) | add `--link=article` for publisher links |
| Output | terminal text | with `--json`, stdout is JSON only; logs go to stderr |
| Browser | headless | `--show-chrome` to watch; `--headless` to force |
| Unconfigured channels | skipped (⚪) | not a failure |

## 3. `--json` structure

```json
{ "meta": { "time": "...", "onCampus": true, "institution": "..." },
  "results": [
    { "source": "spis", "label": "SPIS", "numFound": 4750,
      "items": [
        { "title": "...", "author": "...", "source": "...", "date": "...",
          "url": "...", "articleUrl": "...", "detailUrl": "...",
          "detailVerified": true, "pdfUrl": "..." }
      ] } ] }
```

- Copy links **verbatim** from this run's JSON; never retype or abbreviate;
- `detailVerified: true` means the SPIS detail page passed API verification;
- `pdfUrl` only means "an OA link exists" (403/429 possible; see troubleshooting).

## 4. Hard rules

1. Run only the channels the user asked for (`--src=` exactly);
2. Records only — never open full text or download PDFs unless explicitly asked;
3. Links must be complete and verified; 403/429 ≠ 404;
4. SPIS returns detail pages by default; if a detail page fails verification, keep the
   record with publisher fallback and mark ⚠️;
5. Never fabricate links; never call "not found" "does not exist";
6. On errors, triage first: auth / anti-bot / no results / real bug.

## 5. Failure report template

```
channel: spis
result: 4750 hits, 5 returned
verification: 5/5 detail pages verified (API check)
failures: none
(if any: item 3 detail registration failed -> publisher fallback with ⚠️; cause: record not registered)
```

## 6. When the user asks for detail pages

Just run the default command (SPIS returns detail pages by default). Do **not** substitute
publisher links — on a campus network those are usually not downloadable; the detail page
is the usable entry point.

## 7. If `--check` fails

`node find.js --check` reports egress IP, channel auth and hit counts.
- not on campus → connect campus Wi-Fi / VPN;
- no browser found → install Chrome/Edge/Chromium/Brave or set `LITSEARCH_CHROME`.
