# Bolaget+

[![GitHub Release](https://img.shields.io/github/release/Johanneshn/bolaget-plus.svg?style=flat)](https://github.com/Johanneshn/bolaget-plus/releases) [![CI](https://github.com/Johanneshn/bolaget-plus/actions/workflows/ci.yaml/badge.svg?branch=main&event=push)](https://github.com/Johanneshn/bolaget-plus/actions/workflows/ci.yaml)

A browser extension that shows Vivino and Untappd ratings on
[Systembolaget.se](https://www.systembolaget.se), next to the product you are
already looking at.

![The Bolaget+ rating card on a Systembolaget wine page](docs/screenshots/header.png)

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-orange?logo=firefox)](https://addons.mozilla.org/firefox/addon/bolaget-plus) [![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue?logo=google-chrome)](https://chromewebstore.google.com/detail/bolaget-plus/bbjfkhmnofhindccdlfmhkibfafiogao)

## What it does

**On a product page** you get the rating, the number of votes and a link to
the wine on Vivino, or the beer or cider on Untappd. For wine it also shows the
rating of the vintage on the shelf when Vivino has one. Click the label
thumbnail to see it larger.

**In the product lists** each card gets a small rating badge. You can sort the
cards you have loaded by rating, or by *Prisvärt* — how much better a wine is
rated than is usual at its price.

**Tasted.** Mark a product as tasted and it is marked in the lists too, where
*Dölj provade* hides it. If you use Untappd Insider you can import your
check-in history, and beers you have already had are marked for you. The list
can be saved to a file and read into another browser.

**When the match is wrong.** Names on Systembolaget and on Vivino don't always
line up. When Bolaget+ isn't sure, it shows the closest candidates instead of
guessing, and *Fel träff?* lets you pick the right one; your choice is
remembered. Cards without a certain match link to a search on Vivino or
Untappd.

Wine ratings come from [Vivino](https://www.vivino.com/), beer and cider ratings
from [Untappd](https://untappd.com/). Each kind can be switched off in the
extension's popup.

| Product lists | A beer | The popup |
|---|---|---|
| ![Rating badges on a list of red wines, sorted by rating](docs/screenshots/list.png) | ![Untappd rating on a beer page](docs/screenshots/product-beer.png) | ![The popup with its switches](docs/screenshots/popup.png) |

## Privacy

Bolaget+ has no server and collects nothing. To find a rating it sends the
product's name to Vivino's or Untappd's own search, the same search their
websites use. Ratings, your tasted list and your corrections are stored in your
browser. Nothing is sent to Systembolaget beyond what your browser already
loads when you visit the site.

## Install

Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/bolaget-plus)
or the [Chrome Web Store](https://chromewebstore.google.com/detail/bolaget-plus/bbjfkhmnofhindccdlfmhkibfafiogao).
Builds for both are also attached to each
[GitHub release](https://github.com/Johanneshn/bolaget-plus/releases).

Found a wrong rating or a bug? [Open an issue](https://github.com/Johanneshn/bolaget-plus/issues).

## Development

Built with [WXT](https://wxt.dev) and TypeScript. Install the dependencies with
[pnpm](https://pnpm.io/) (this also installs the git hooks):

```sh
pnpm install
pnpm dev:chrome    # or dev:firefox
```

Checks that CI runs (fast, no network):

```sh
pnpm compile && pnpm lint && pnpm test:unit && pnpm test:matching
```

Smoke tests run the built extension against the live Systembolaget, Vivino
and Untappd sites. They depend on those sites' markup, so they run nightly
rather than on every push:

```sh
pnpm test:smoke            # Chromium
pnpm test:smoke:firefox    # Firefox; set FIREFOX_PATH
```

Build with `pnpm build:chrome` or `pnpm build:firefox`; the output is in
`.output/`. [CLAUDE.md](CLAUDE.md) describes how the code fits together.

## License

[MIT](LICENSE)
