# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Bolaget+ is a cross-browser (Chrome + Firefox) WebExtension that injects Vivino
(wine) and Untappd (beer/cider) ratings directly onto product pages and
list-page cards of Systembolaget.se, Sweden's alcohol retailer. Built with the
[WXT](https://wxt.dev) framework; TypeScript throughout.

## Commands

Uses **pnpm** (v10). WXT auto-imports its APIs — `defineContentScript`,
`defineBackground`, `defineConfig`, `i18n`, and the storage items exported from
`settings.ts` are available without imports in entrypoint files.

```sh
pnpm dev:chrome        # run in Chrome with HMR (dev server on :3000)
pnpm dev:firefox       # run in Firefox

pnpm compile           # tsc --noEmit — type check
pnpm lint              # eslint . (strictTypeChecked + stylistic + perfectionist)
pnpm lint:fix
pnpm ft                # prettier --write on src, e2e, and root *.config.ts
pnpm ft:check          # prettier --check (CI uses this)

pnpm build:chrome      # build to .output/ (build:firefox for MV2/Firefox)
pnpm zip:chrome        # package for store submission

pnpm test:unit         # vitest unit tests (src/**/*.test.ts) — fast, no network
pnpm test:matching     # mocked-fetch matching regressions — fast, no network
pnpm test:smoke        # build:chrome then the live-site + live-API projects
pnpm test:live         # only the live Vivino/Untappd API spec
pnpm test              # build:chrome then run every Playwright project
pnpm test:interactive  # playwright --ui
```

Run a single Playwright test: `pnpm build:chrome && playwright test -g "beer page"`
(the build step is required — Playwright loads the built extension from
`.output/`).

CI (`.github/workflows/ci.yaml`) runs `compile`, `ft:check`, `lint`,
`test:unit`, `test:matching`, and `build:chrome` on every PR and on push to
`main`; it is the workflow the README badge reports, and everything in it is
deterministic. The live-site tests run separately in
`.github/workflows/playwright.yml` on a nightly cron — keep them out of CI, and
keep them off the badge, so third-party markup changes don't read as a broken
build. (That workflow's `schedule:` trigger also means GitHub disables it after
60 days of repository inactivity; it then has to be re-enabled by hand in the
Actions tab.) The `pre-push` git hook (simple-git-hooks) runs `ft` + `lint` —
installed automatically on `pnpm install`.

## Architecture

The extension is split across three WXT entrypoints in `src/entrypoints/` that
communicate by message-passing. The split exists to work around cross-origin
restrictions: the content script runs in the page's origin
(systembolaget.se) and cannot fetch from vivino.com/untappd.com, so all
external fetches are delegated to the background script.

**Rating flow (the core path):**

1. `content.ts` runs on `*.systembolaget.se/*`. It uses
   [sentinel-js](https://github.com/geoxor/sentinel-js) to watch for the `h1`
   element (Systembolaget is an SPA, so pages swap without full reloads) and
   triggers `tryInsertOnProductPage` on each new product title. It also
   watches list-page product cards (`a[id^="tile:"]`) and, once a card
   scrolls into view, injects a compact rating badge via a throttled fetch
   queue (`enqueueListFetch`, one request per 300 ms — cached ratings skip
   the queue and render immediately).
2. `productUtils.ts` derives `ProductType` from the URL path (`/produkt/vin/`,
   `/produkt/ol/`, `/produkt/cider-blanddrycker/`), extracts the product name
   from the `<h1>` (or from a card's text lines), and gates wine on
   `isBottle()` (Vivino only rates bottles, not box/bag-in-box/etc. — see the
   exclusion-list note in that file). `isCardBottle()` applies the same gate to
   list cards, reading the packaging from the `__NEXT_DATA__` payload when the
   card's product is in it and falling back to the card's own detail lines.
3. `ratingService.fetchRating` checks the local cache first
   (`ratingsCache.ts`), otherwise sends a `RatingRequest` message to the
   background script and caches responses that are neither `NotFound` nor
   `transient` (transient = rate limit / network failure; retried next visit).
4. `background.ts` receives the message and calls `api.ts`. Both lookups use
   the sites' public Algolia search indexes (search-only credentials shipped
   to anonymous visitors): `fetchRatingFromVivino` queries the `WINES_prod`
   index, `fetchRatingFromUntappd` the `beer` index. Wine label thumbnails
   are downloaded by the background script and inlined as `data:` URLs
   because the page CSP blocks hotlinking Vivino's image hosts.
5. `api.ts` scores candidates with `string-similarity`. A Vivino match must
   additionally be confirmed by the producer (`queryContainsWinery`) or be an
   exact name hit on a distinctive title — see the comments in that file for
   the regressions each rule guards. When Systembolaget's own page data names
   the producer, `productUtils.getProducer` passes it along and a hit whose
   winery *that* confirms wins outright (`bestFromProducer`): a title which is
   nothing but a brand ("Mucho Mas") cannot otherwise be told apart from an
   unrelated winery of the same name. Unconfirmed candidates return
   `RatingResultStatus.Uncertain` with up to 3 ranked alternatives and a
   search link rather than a wrong rating; an empty Untappd result returns
   `NotFound`.
6. Back in `content.ts`, `handleRating` dispatches on `RatingResultStatus` and
   `domUtils.ts` renders the rating card (`#rating-container`) into the page.

**Popup** (`entrypoints/popup/`) is a plain HTML/TS toggle UI backed by the
four `sync:`-scoped storage items in `settings.ts` (`featuresEnabled`,
`wineFeatureEnabled`, `beerFeatureEnabled`, `ciderFeatureEnabled`, all default
`true`). The content script reads these before doing any work.

**Shared types** live in `src/@types/types.ts` — `ProductType` and
`RatingResultStatus` enums plus the `RatingRequest`/`RatingResponse` message
contract used across the process boundary.

**Caching** (`ratingsCache.ts`) uses `@wxt-dev/storage` with `local:` keys and
per-item metadata timestamps; entries expire after 1 day. A product's list
card and its product page share one entry (the key is the product number, not
the query), which is what keeps the two views on the same wine — the metadata
also records the producer the match was made with, so a page that knows the
producer refetches over an entry a card wrote without one, never the reverse. Reads evict their
own expired entry; `removeExpiredRatings` (run on background startup, throttled
to once an hour because it reads every cached value) sweeps the rest — expired
entries, and either half of a torn write — so cached label images can't
accumulate toward the storage quota.

**i18n**: user-facing strings come from `src/locales/{sv,en}.yml` via
`@wxt-dev/i18n`; default locale is Swedish (`sv`). Use `i18n.t('key')`, not
hardcoded strings.

## Conventions

- Path alias `@/` maps to `src/` (WXT default).
- Object keys, imports, and union members are alpha-sorted — enforced by
  `eslint-plugin-perfectionist`; run `lint:fix` if you add members out of order.
- `no-console` is an error. eslint runs with `strictTypeChecked`, so `any`,
  floating promises, and unsafe access will fail the build.
- Manifest permissions and CSP are defined in `wxt.config.ts` (not a static
  manifest.json); localhost/WebSocket permissions are added only in dev builds.

## Testing notes

Unit tests (`src/**/*.test.ts`, vitest with WXT's `WxtVitest` plugin) cover
the matching logic in `api.ts` against fixture Algolia responses, the cache
against `fakeBrowser` storage, and the list-card parsing in `productUtils.ts`
against synthetic card markup — run them with `pnpm test:unit`; they need no
network and are the first thing to extend when touching matching rules. Tests
that need a DOM opt in per file with a `// @vitest-environment happy-dom`
docblock; the default environment stays `node`.

The Playwright tests in `e2e/` are split into three projects
(`playwright.config.ts`), divided by whether they touch the network:

- `matching` (`api-matching.spec.ts`) — mocked-`fetch` regression tests for the
  matching rules. No network, no browser, ~2 s. Runs in CI.
- `smoke` (`end-to-end.spec.ts`) — loads the built extension into a headed
  Chromium and drives the **live** Systembolaget site, so it depends on that
  page's current markup and can be flaky (retries twice and runs serially on
  CI). `fixtures.ts` provides the `extensionId` fixture; `systembolaget.ts`
  provides `openPage`, which dismisses the age gate ("Jag har fyllt 20 år") and
  cookie banner ("Acceptera alla kakor") tolerantly — a gate that never appears
  is not an error, so a banner change fails no test on its own.
- `live-api` (`api-live.spec.ts`) — real queries against Vivino and Untappd,
  including reading Untappd's search credentials out of its live markup.

Only `matching` belongs in CI. When adding a Playwright test, decide which
project it lands in first: if it needs a third party to be up, it is a smoke
test.
