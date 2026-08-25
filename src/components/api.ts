import stringSimilarity from 'string-similarity'

import {
  BeerResponse,
  ProductFacts,
  RatingAlternative,
  RatingResponse,
  RatingResultStatus,
  UntappdHit,
  UntappdSearchConfig,
  UntappdSearchJSON,
  VivinoCountry,
  VivinoHit,
  VivinoSearchJSON
} from '@/@types/types'
import { countryCode } from '@/components/countries'

// Untappd's search page renders results client-side via Algolia, so the HTML
// carries no beers — but it does carry the search-only credentials its own JS
// uses, in a `window.UNTAPPD_SEARCH_CONFIG` blob. We read them from there at
// runtime rather than pinning them, so a rotated key heals itself.
const UNTAPPD_SEARCH_CONFIG_MARKER = 'window.UNTAPPD_SEARCH_CONFIG'

// Used only when that read fails (offline, markup change). Values as shipped
// by untappd.com; stale ones surface as an Uncertain card, never a wrong one.
const UNTAPPD_FALLBACK_CONFIG: UntappdSearchConfig = {
  appId: '9WBO4RQ3HO',
  searchKey: '1d347324d67ec472bb7132c66aead485'
}

// Vivino's search box is also Algolia-backed with public search-only
// credentials shipped to anonymous visitors. The WINES_prod index has far
// better text relevance than the /api/explore/explore endpoint (a marketplace
// browser that misses even top-selling wines and non-marketplace producers),
// and each hit carries the winery as a separate field, so the producer check
// no longer has to guess which query token is the brand.
const VIVINO_ALGOLIA_APP_ID = '9TAKGWJUXL'
const VIVINO_ALGOLIA_SEARCH_KEY = '60c11b2f1068885161d95ca068d3a6ae'

// How many ranked candidates to surface as "did you mean" alternatives when
// no match is confident enough to auto-select.
const MAX_ALTERNATIVES = 3

// A hung image download must not hold up the rating itself.
const IMAGE_FETCH_TIMEOUT_MS = 4000

// Style/format words that are shared across thousands of unrelated wines. On
// their own they must never be enough to accept a match: "Blanc de Noirs Brut"
// or "Prosecco Extra Dry" can push the name-similarity over the accept
// threshold even when the producer is completely different. The distinguishing
// signal is the producer — enforced by the winery check below.
const GENERIC_WINE_WORDS = new Set([
  'bianco',
  'blanc',
  'blanco',
  'blancs',
  'branco',
  'brut',
  'cava',
  'champagne',
  'classico',
  'cremant',
  'crémant',
  'demi',
  'doc',
  'docg',
  'doux',
  'dry',
  'extra',
  'gran',
  'grande',
  'noir',
  'noirs',
  'nv',
  'organic',
  'prosecco',
  'reserva',
  'reserve',
  'riserva',
  'rosado',
  'rosato',
  'rose',
  'rosé',
  'rosso',
  'rouge',
  'sec',
  'sparkling',
  'spumante',
  'superiore',
  'tinto',
  'vintage',
  'wine'
])

// How close two brand-like tokens must be to count as the same producer;
// tolerates minor spelling/plural differences without matching unrelated words.
const BRAND_TOKEN_MATCH_THRESHOLD = 0.8

// How well a candidate's name has to match the Systembolaget title before any
// producer evidence is even considered.
const MIN_NAME_SIMILARITY = 0.5

// An exact name only identifies a wine when that name is rare in the index.
// Distinctive titles ("Contacto Loureiro", "Barbera d'Alba Busije") match a
// handful of wines; appellation-and-grape titles ("Piemonte Barbera") match
// hundreds under many producers, so an exact hit proves nothing there.
// Audited values: correct exact matches sat at 1–12 total hits, wrong ones at
// 49 and 1714.
const MAX_HITS_FOR_EXACT_NAME_MATCH = 20

// Corporate-form words in winery names ("Weingut X", "Bodegas Y", "X Family
// Estate") that Systembolaget titles routinely drop. They are excluded from
// the winery check so "Saint Clair Family Estate" is confirmed by a title
// that only says "Saint Clair" — but every remaining winery token must appear
// in the query: any-token overlap would let "Knight Black Horse" pass for
// "Black Knight".
const WINERY_COMPANY_WORDS = new Set([
  'agricola',
  'azienda',
  'bodega',
  'bodegas',
  'cantina',
  'cantine',
  'casa',
  'cave',
  'caves',
  'cellars',
  'chateau',
  'château',
  'domaine',
  'domaines',
  'estate',
  'estates',
  'famiglia',
  'familia',
  'familie',
  'famille',
  'family',
  'fratelli',
  'freres',
  'frères',
  'hermanos',
  'maison',
  'tenuta',
  'tenute',
  'vigne',
  'vigneron',
  'vignerons',
  'vignobles',
  'vina',
  'viña',
  'vineyard',
  'vineyards',
  'vinos',
  'vinya',
  'weingut',
  'winery',
  'winzer'
])

// A Vivino hit with everything the matching rules weigh: how close its name is
// to the Systembolaget title (with the producer prefixed, and without), which
// of its own words the title never mentions, and the producer Vivino files it
// under.
type ScoredWine = RatingResponse & {
  country?: string
  exactNameMatch: boolean
  imageUrl?: string
  similarityRate: number
  unmatchedWords: number
  wineNameRate: number
  winery?: string
}

// Fetched by the background script because the systembolaget.se page CSP
// (img-src) blocks hotlinking Vivino's image hosts; a data: URL is allowed.
export async function fetchImageAsDataUrl(
  url: string | undefined
): Promise<string | undefined> {
  if (!url) {
    return undefined
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      return undefined
    }
    const contentType = response.headers.get('content-type') ?? 'image/png'
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return `data:${contentType};base64,${btoa(binary)}`
  } catch {
    return undefined
  }
}

// Runs in the *content script* on Chrome, not the background. Algolia serves
// any origin (it is a browser-side search product), so this is an ordinary
// CORS request needing no host permission — which is why algolia.net is absent
// from the Chrome manifest and users are never asked to approve it.
export async function fetchRatingFromUntappd(
  productName: string,
  config: UntappdSearchConfig
): Promise<RatingResponse> {
  // Credentials go in the query string with a text/plain body to keep the
  // request CORS-"simple": no preflight, so a lookup costs one round trip.
  const credentials = new URLSearchParams({
    'x-algolia-api-key': config.searchKey,
    'x-algolia-application-id': config.appId
  })
  const url = `https://${config.appId.toLowerCase()}-dsn.algolia.net/1/indexes/beer/query?${credentials.toString()}`
  const searchFallbackUrl = `https://untappd.com/search?q=${encodeURIComponent(
    productName
  )}&type=beer&sort=all`
  // A rejected key or a network blip is not a definitive miss: hand over a
  // working Untappd search link and mark it transient so it never gets cached.
  const uncertainFallback = {
    link: searchFallbackUrl,
    status: RatingResultStatus.Uncertain,
    transient: true
  } as RatingResponse

  try {
    const response = await fetch(url, {
      body: JSON.stringify({
        params: new URLSearchParams({
          hitsPerPage: '5',
          query: productName
        }).toString()
      }),
      headers: {
        'Content-Type': 'text/plain'
      },
      method: 'POST'
    })

    if (!response.ok) {
      return uncertainFallback
    }

    const data = (await response.json()) as UntappdSearchJSON
    const hits = data.hits ?? []

    if (hits.length === 0) {
      return { status: RatingResultStatus.NotFound } as RatingResponse
    }

    type ScoredBeer = BeerResponse & { similarityRate: number }

    const scored = hits
      .map((hit: UntappdHit): ScoredBeer => {
        const similarityRate = Math.max(
          stringSimilarity.compareTwoStrings(productName, hit.beer_name),
          stringSimilarity.compareTwoStrings(productName, hit.brewery_beer_name)
        )

        return {
          brewery: hit.brewery_name,
          link: `https://untappd.com/b/${hit.beer_slug}/${hit.bid.toString()}`,
          name: hit.beer_name,
          // Untappd reports no score (null or 0) for beers with too few
          // check-ins; normalize to 0 so the UI can render it as "N/A".
          rating: hit.rating_score ?? 0,
          similarityRate,
          status: RatingResultStatus.Found,
          votes: hit.rating_count ?? 0
        }
      })
      .sort((a, b) => b.similarityRate - a.similarityRate)

    const bestMatch = scored[0]

    if (bestMatch.similarityRate < 0.2) {
      return {
        alternatives: toAlternatives(scored),
        link: searchFallbackUrl,
        status: RatingResultStatus.Uncertain
      } as RatingResponse
    }

    // Return only the response contract — similarityRate is internal.
    return {
      brewery: bestMatch.brewery,
      link: bestMatch.link,
      name: bestMatch.name,
      rating: bestMatch.rating,
      status: bestMatch.status,
      votes: bestMatch.votes
    } as BeerResponse
  } catch {
    return uncertainFallback
  }
}

// Like the Untappd lookup, this runs in the content script on Chrome so that
// Vivino's Algolia host needs no permission. Label images are the exception:
// images.vivino.com sends no CORS headers and the systembolaget.se page CSP
// blocks hotlinking them, so downloading one stays a background job and is
// injected here as `fetchImage`.
export async function fetchRatingFromVivino(
  query: string,
  includeImage = true,
  facts: ProductFacts = {},
  fetchImage: (
    url: string | undefined
  ) => Promise<string | undefined> = fetchImageAsDataUrl
): Promise<RatingResponse> {
  const url = `https://${VIVINO_ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/WINES_prod/query`
  // Even Algolia misses some wines (obscure producers, new releases). Instead
  // of a dead-end "no rating" message, always hand the user a working Vivino
  // search link.
  const uncertainFallback = {
    link: `https://www.vivino.com/search/wines?q=${encodeURIComponent(query)}`,
    status: RatingResultStatus.Uncertain
  } as RatingResponse

  try {
    const response = await fetch(url, {
      body: JSON.stringify({
        params: new URLSearchParams({
          hitsPerPage: '10',
          query
        }).toString()
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-API-Key': VIVINO_ALGOLIA_SEARCH_KEY,
        'X-Algolia-Application-Id': VIVINO_ALGOLIA_APP_ID
      },
      method: 'POST'
    })

    // HTTP errors (429 rate limit, 5xx) are transient — show the search-link
    // fallback but don't let it get cached as a definitive miss.
    if (!response.ok) {
      return { ...uncertainFallback, transient: true }
    }

    const data = (await response.json()) as VivinoSearchJSON
    const hits = (data.hits ?? []).filter((hit) => !hit.hidden)

    if (hits.length === 0) {
      return uncertainFallback
    }

    const scored = hits
      .map((hit: VivinoHit): ScoredWine => {
        const winery = hit.winery?.name ?? undefined
        // Hits name the wine without the producer ("Crianza" under winery
        // "El Coto"), so score against the combined name — unless the wine
        // name already repeats the winery.
        const fullName =
          winery && !normalize(hit.name).startsWith(normalize(winery))
            ? `${winery} ${hit.name}`
            : hit.name
        const rating = hit.statistics?.ratings_average ?? 0
        const votes = hit.statistics?.ratings_count ?? 0
        const imageUrl = normalizeImageUrl(
          hit.image?.variations?.label_medium ?? hit.image?.location
        )

        return {
          country: hitCountry(hit),
          exactNameMatch:
            normalize(hit.name) === normalize(query) ||
            normalize(fullName) === normalize(query),
          imageUrl,
          link: wineLink(hit),
          name: fullName,
          rating,
          similarityRate: similarity(query, fullName),
          status: RatingResultStatus.Found,
          unmatchedWords: countUnmatchedWords(query, hit.name),
          votes,
          wineNameRate: similarity(query, hit.name),
          winery
        }
      })
      .sort((a, b) => b.similarityRate - a.similarityRate)

    // Whoever Systembolaget names as the producer gets the first word (see
    // bestFromProducer); the rules below are what is left when the page data
    // carries no producer, as it does not after an SPA navigation.
    //
    // A name-similarity built on shared style words ("Prosecco Extra Dry") is
    // not a real match unless the producer also lines up: the winery must be
    // confirmed by the query. Checked down the ranking, not only on the top
    // candidate — a confirmed producer at rank 3 beats an unconfirmable
    // near-namesake at rank 1. The one exception is an exact-name hit on a
    // distinctive title (few wines in the whole index share the name), which
    // covers products whose Systembolaget title omits the producer. Exact
    // means exact: a similarity threshold cannot replace it, because
    // compareTwoStrings ignores whitespace and scores "Riesling Organic" 0.97
    // against "R Riesling Organic", a different producer's wine.
    const nameIsDistinctive =
      (data.nbHits ?? Infinity) <= MAX_HITS_FOR_EXACT_NAME_MATCH
    // A wine made in another country is not this product, whatever its name
    // says: an unrelated Chilean winery called "Mucho Mas" matches the title
    // of a Spanish "Mucho Mas" perfectly. Both catalogues print the country,
    // and a list card prints it even where nothing else about the product is
    // readable. Hits whose country Vivino leaves out stay in — an unknown
    // country is not a mismatch.
    const candidates = facts.country
      ? scored.filter(
          (wine) => wine.country === undefined || wine.country === facts.country
        )
      : scored
    const bestMatch =
      bestFromProducer(candidates, facts.producer) ??
      candidates.find(
        (wine) =>
          wine.similarityRate >= MIN_NAME_SIMILARITY &&
          (queryContainsWinery(query, wine.winery) ||
            (wine.exactNameMatch && nameIsDistinctive))
      )

    if (!bestMatch) {
      // Suggest from the same country when there is anything there, but never
      // show an empty card just because the country filter emptied the list.
      const top = (candidates.length > 0 ? candidates : scored).slice(
        0,
        MAX_ALTERNATIVES
      )
      if (includeImage) {
        await Promise.all(
          top.map(async (wine) => {
            wine.imageDataUrl = await fetchImage(wine.imageUrl)
          })
        )
      }
      return { ...uncertainFallback, alternatives: toAlternatives(top) }
    }

    // Return only the response contract — similarityRate/imageUrl are internal.
    return {
      imageDataUrl: includeImage
        ? await fetchImage(bestMatch.imageUrl)
        : undefined,
      link: bestMatch.link,
      name: bestMatch.name,
      rating: bestMatch.rating,
      status: bestMatch.status,
      votes: bestMatch.votes
    }
  } catch {
    return { ...uncertainFallback, transient: true }
  }
}

// Reads the Algolia credentials out of Untappd's search page. Runs in the
// background script: untappd.com sends no CORS headers, so only the extension
// (which declares untappd.com) can fetch it.
export async function fetchUntappdSearchConfig(): Promise<UntappdSearchConfig> {
  try {
    const response = await fetch('https://untappd.com/search?type=beer')
    if (!response.ok) {
      return UNTAPPD_FALLBACK_CONFIG
    }
    return parseSearchConfig(await response.text()) ?? UNTAPPD_FALLBACK_CONFIG
  } catch {
    return UNTAPPD_FALLBACK_CONFIG
  }
}

// The best candidate Systembolaget's own producer vouches for, if any.
// Consulted before the title-based rules: naming the producer is harder
// evidence than anything the title carries, so it both finds the wine whose
// title alone can never confirm it ("Mucho Mas" under winery "Félix Solís")
// and outranks a same-named wine from an unrelated producer (a Chilean winery
// literally called "Mucho Mas", which that title trivially "confirms").
function bestFromProducer(
  candidates: ScoredWine[],
  producer: string | undefined
): ScoredWine | undefined {
  if (!producer) {
    return undefined
  }
  return (
    candidates
      // The bare wine name counts too: a title that omits the producer scores
      // poorly against a name we prefixed the producer onto.
      .filter(
        (wine) =>
          Math.max(wine.similarityRate, wine.wineNameRate) >=
            MIN_NAME_SIMILARITY && queryContainsWinery(producer, wine.winery)
      )
      // Within one producer's range the title is all that separates the wines,
      // so a name spending a word the title never mentions ("Mucho Mas Gold")
      // loses to one that spends none. Colours don't count — they are style
      // words a Systembolaget title is free to leave out.
      .sort(
        (a, b) =>
          a.unmatchedWords - b.unmatchedWords || b.wineNameRate - a.wineNameRate
      )[0]
  )
}

// True when `token` appears in `tokens`, allowing the spelling drift between
// the two catalogues ("Solis"/"Solís", singular/plural).
function containsToken(tokens: string[], token: string): boolean {
  return tokens.some(
    (candidate) =>
      candidate === token ||
      stringSimilarity.compareTwoStrings(candidate, token) >=
        BRAND_TOKEN_MATCH_THRESHOLD
  )
}

// How many distinctive words of a wine's name the Systembolaget title never
// accounts for — the signal that separates a producer's line extension from
// the wine actually being looked at.
function countUnmatchedWords(query: string, name: string): number {
  const queryTokens = distinctiveTokens(query)
  return distinctiveTokens(name).filter(
    (token) => !containsToken(queryTokens, token)
  ).length
}

// Splits text into distinctive tokens: drops short filler ("de", "di", "el"),
// bare vintage years, and the generic style words above, leaving the
// brand/producer words that actually identify a wine. Built on the same
// diacritic folding as the name comparison, because the two catalogues
// disagree about accents — Systembolaget writes "Felix Solis" where Vivino
// writes "Félix Solís", and "mas"/"más" share no bigram at all.
function distinctiveTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter(
      (token) =>
        token.length > 2 &&
        !/^\d+$/.test(token) &&
        !GENERIC_WINE_WORDS.has(token)
    )
}

// Vivino files a wine's country under whichever of these the index build
// happens to carry; the first one that resolves to a known country wins, and
// nothing resolving means the hit simply has no country to check.
function hitCountry(hit: VivinoHit): string | undefined {
  return (
    countryCode(readCountryValue(hit.region?.country)) ??
    countryCode(hit.region?.country_code) ??
    countryCode(readCountryValue(hit.country))
  )
}

// Lowercases and folds diacritics and punctuation so cosmetic spelling
// differences between the two catalogues don't break comparisons: Vivino
// writes "Barbera d’Alba" and "Bobal - Syrah" where Systembolaget writes
// "Barbera d'Alba" and "Bobal Syrah", and accents drift both ways
// ("Aszù"/"Aszú").
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function normalizeImageUrl(url: null | string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  return url.startsWith('//') ? `https:${url}` : url
}

// Extracts the JSON object assigned to `window.UNTAPPD_SEARCH_CONFIG`. Brace
// matching rather than a regex: the blob holds nested objects, and a lazy
// `\{.*?\}` would stop at the first inner brace.
function parseSearchConfig(html: string): null | UntappdSearchConfig {
  const marker = html.indexOf(UNTAPPD_SEARCH_CONFIG_MARKER)
  if (marker === -1) {
    return null
  }
  const start = html.indexOf('{', marker)
  if (start === -1) {
    return null
  }

  let depth = 0
  let escaped = false
  let inString = false
  for (let i = start; i < html.length; i++) {
    const char = html.charAt(i)
    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '"') {
      inString = !inString
    } else if (inString) {
      continue
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return toSearchConfig(html.slice(start, i + 1))
      }
    }
  }
  return null
}

// True when every distinctive token of the winery name appears in the query
// (fuzzily, to tolerate spelling drift). Corporate-form words are skipped —
// Systembolaget writes "Saint Clair", Vivino "Saint Clair Family Estate" —
// but the remaining tokens must ALL be present: any-token overlap would let
// "Knight Black Horse" pass for "Black Knight". An unknown winery cannot be
// confirmed and never passes.
function queryContainsWinery(
  query: string,
  winery: string | undefined
): boolean {
  if (!winery) {
    return false
  }
  const wineryTokens = distinctiveTokens(winery).filter(
    (token) => !WINERY_COMPANY_WORDS.has(token)
  )
  if (wineryTokens.length === 0) {
    return false
  }
  const queryTokens = distinctiveTokens(query)
  return wineryTokens.every((wineryToken) =>
    containsToken(queryTokens, wineryToken)
  )
}

function readCountryValue(
  value: undefined | VivinoCountry
): string | undefined {
  if (!value) {
    return undefined
  }
  return typeof value === 'string'
    ? value
    : (value.name ?? value.code ?? undefined)
}

function similarity(a: string, b: string): number {
  return stringSimilarity.compareTwoStrings(normalize(a), normalize(b))
}

function toAlternatives(
  scored: {
    imageDataUrl?: string
    link: null | string
    name: null | string
    rating: number
    votes: number
  }[]
): RatingAlternative[] {
  return scored
    .slice(0, MAX_ALTERNATIVES)
    .flatMap(({ imageDataUrl, link, name, rating, votes }) =>
      link !== null && name !== null
        ? [{ imageDataUrl, link, name, rating, votes }]
        : []
    )
}

function toSearchConfig(json: string): null | UntappdSearchConfig {
  try {
    const parsed = JSON.parse(json) as Partial<UntappdSearchConfig>
    // `autocompleteSearchKey` sits in the same blob but drives the search
    // box's suggestions — the beer index wants `searchKey`.
    if (!parsed.appId || !parsed.searchKey) {
      return null
    }
    return { appId: parsed.appId, searchKey: parsed.searchKey }
  } catch {
    return null
  }
}

// vivino.com/wines/{id} resolves by vintage id, not wine id (see the
// regression note in the tests). The displayed rating is the wine-level
// pooled one, so link the most-rated vintage — the "all vintages" entry when
// Vivino has one. Wines without vintage data fall back to the /w/{wine id}
// page.
function wineLink(hit: VivinoHit): string {
  const bestVintage = (hit.vintages ?? []).reduce<
    NonNullable<VivinoHit['vintages']>[number] | null
  >(
    (best, vintage) =>
      (vintage.statistics?.ratings_count ?? 0) >
      (best?.statistics?.ratings_count ?? -1)
        ? vintage
        : best,
    null
  )
  return bestVintage
    ? `https://www.vivino.com/wines/${bestVintage.id.toString()}`
    : `https://www.vivino.com/w/${hit.id.toString()}`
}
