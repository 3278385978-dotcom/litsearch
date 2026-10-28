# Architecture

## Goal

One command for multi-source search (papers / code / books): zero third-party
dependencies, portable, failure-isolated.

## Layers

```
find.js          entry: parse flags → select channels by group → run → render (text/md/json)
config.js        config loader: env > config.local.js > config.example.js
sources/*.js     one adapter per channel: locate → extract → resolve links
chrome.js        managed Chrome lifecycle (isolated profile; headless or visible)
cdp.js           zero-dependency CDP client (Node native WebSocket)
```

## Why a hand-written CDP client

Many academic sites require a real page context (same-origin requests, cookies,
anti-bot JS), so plain HTTP calls fail. Installing playwright/puppeteer is not always
possible (offline npm registry), while Node's native WebSocket is enough:
`Runtime.evaluate` for extraction, `Page.navigate` for navigation, and polling waits.

## Key trade-offs

1. **Channel groups**: `papers` / `public` / `code` / `books`; the default runs only
   `papers + code`, so public APIs and book channels are opt-in (less noise, fewer tokens).
2. **Config/code separation**: institution-specific values live in `config.local.js`;
   code and public docs stay institution-free.
3. **Failure isolation**: a failing channel never breaks the rest; unconfigured
   channels are skipped with a notice.
4. **stdout contract**: with `--json`, stdout carries JSON only; all logs go to stderr.
