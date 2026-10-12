import {
  type ProductFacts,
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import { countryCodeFromName } from '@/components/countries'
import { buildSearchName, isBottlePackaging } from '@/components/productUtils'

// "Topp 10" ranks every product a result list holds, not only the 30 on the
// page in view. It does so by replaying a search the site itself ran against
// Systembolaget's product search API, one page at a time — the request already
// carries every filter the user has on, the store included, which the page URL
// alone does not (the store choice lives in the site's own state).

// Any API version: the site has moved from v1 to v2 before, and both answer
// with the same products and metadata.
const SEARCH_PATH = /^\/sb-api-ecommerce\/v\d+\/productsearch\/search$/
// The key Systembolaget's own frontend sends with every search. Resource
// timing records the URL of the site's request but not its headers, so the key
// cannot be read off that; it is read out of the site's script bundle instead
// (readSiteApiKey) when this one stops working.
const SITE_API_KEY = '8d39a7340ee7439f8b4c1e995c8f3e4a'
// How the bundle sets it: `NEXT_PUBLIC_API_KEY_APIM:"8d39…"` — Next.js inlines
// the value but keeps the name, in a chunk every page loads.
const SITE_API_KEY_PATTERN = /NEXT_PUBLIC_API_KEY_APIM:"([0-9a-f]{32})"/
// How long a list may be. Each product is a Vivino or Untappd query, sent one
// per 300 ms: past WARN_ABOVE_PRODUCTS (a minute and a half on a first run)
// the user is asked before the run goes on, and past MAX_PRODUCTS (five
// minutes) the list is turned away with a request to narrow it. Neither is a
// known limit of Vivino's — 90 queries in a row have gone through unthrottled,
// more has not been tried — and a throttled lookup only leaves its wine
// unrated until the next run.
export const WARN_ABOVE_PRODUCTS = 300
export const MAX_PRODUCTS = 1000
// The API serves 30 products a page whatever size is asked for.
const PAGE_SIZE = 30

export interface TopListEntry {
  product: TopListProduct
  rating: RatingResponse
  // Read when the list is shown, not when it is made: a wine marked on its
  // own page is tasted by the time the user comes back to the list.
  tasted?: boolean
}

// One product of the search, reduced to what a lookup and the result list
// need.
export interface TopListProduct {
  facts: ProductFacts
  isBottle: boolean
  name: string
  price: number
  productId: string
  title: string
  type: ProductType
  url: string
  volumeMl: number
}

interface SearchPage {
  metadata?: { docCount?: number; nextPage?: number }
  products?: unknown[]
}

// The searches the site ran lately, newest last. More than one is kept
// because a filter change sends two — the list's own, and the same search
// without the store, for the "N varor in the whole range" comparison — and
// they finish in either order.
const recentSearches: string[] = []
const RECENT_SEARCHES_KEPT = 8

// Every product the search finds, page by page, or — when the search finds
// more than MAX_PRODUCTS — just how many it found. The total is known from
// the first page, so a list too long to rank costs one request, and
// `confirmTotal` can stop a long one there (null). `onProgress` gets the
// number of search hits fetched so far and the total.
export async function fetchAllProducts(
  searchUrl: string,
  options: {
    confirmTotal?: (total: number) => Promise<boolean>
    onProgress: (loaded: number, total: number) => void
    signal?: AbortSignal
  }
): Promise<null | { products: TopListProduct[] } | { tooMany: number }> {
  const { confirmTotal, onProgress, signal } = options
  const products: TopListProduct[] = []
  let loaded = 0
  for (let page = 1; page <= Math.ceil(MAX_PRODUCTS / PAGE_SIZE); page++) {
    const json = await fetchSearchPage(searchUrl, page, signal)
    const hits = json.products ?? []
    loaded += hits.length
    const total = json.metadata?.docCount ?? loaded
    if (total > MAX_PRODUCTS) return { tooMany: total }
    if (page === 1 && confirmTotal && !(await confirmTotal(total))) return null
    for (const raw of hits) {
      const product = toTopListProduct(raw)
      if (product) products.push(product)
    }
    onProgress(loaded, total)
    // The API marks the last page with nextPage -1.
    const next = json.metadata?.nextPage ?? -1
    if (next <= page) break
  }
  return { products }
}

// The search behind the list on screen: the most recent one whose total is
// the "N varor" the page shows. Each candidate costs one request, newest
// first, so the right one is usually the first or second asked. Without a
// count to go by, the newest search it is.
export async function findListSearch(
  count: null | number,
  signal?: AbortSignal
): Promise<null | string> {
  const candidates = [...recentSearches].reverse()
  if (count === null) return candidates[0] ?? null
  for (const url of candidates) {
    const page = await fetchSearchPage(url, 1, signal)
    if (page.metadata?.docCount === count) return url
  }
  return null
}

// Whether a lookup came back with a score to rank on: a confirmed match with
// enough votes for Vivino or Untappd to publish an average.
export function isRated(rating: RatingResponse): boolean {
  return rating.status === RatingResultStatus.Found && rating.rating > 0
}

// The rated products, best first. A rating with few votes says little, so a
// tie — or near enough to round to one — goes to the wine more people rated.
// Vivino rates a wine, not a bottle size, so the 375 ml and 750 ml of one wine
// would take two places with the same rating; each wine is listed once, in the
// size closest to a standard bottle. With "Dölj provade" on, tasted ones make
// room for the next best.
export function rankTopList(
  entries: TopListEntry[],
  { hideTasted = false, limit = 10 } = {}
): TopListEntry[] {
  // Tasted is marked per product, but listed per wine: having had the 750 ml
  // counts for the 375 ml too, or hiding one bottle would promote the other.
  const wineOf = (entry: TopListEntry) =>
    entry.rating.link ?? entry.product.productId
  const tastedWines = new Set(
    entries.filter((entry) => entry.tasted).map(wineOf)
  )
  const byWine = new Map<string, TopListEntry>()
  for (const entry of entries) {
    const key = wineOf(entry)
    const tasted = tastedWines.has(key)
    if (!isRated(entry.rating) || (hideTasted && tasted)) continue
    const kept = byWine.get(key)
    if (!kept || distanceFromBottle(entry) < distanceFromBottle(kept)) {
      byWine.set(key, { ...entry, tasted })
    }
  }
  return [...byWine.values()]
    .sort(
      (a, b) =>
        Math.round(b.rating.rating * 10) - Math.round(a.rating.rating * 10) ||
        b.rating.votes - a.rating.votes
    )
    .slice(0, limit)
}

// A search result as a TopListProduct; null for anything without a name or of
// a kind we have no ratings for (spirits, alcohol-free, gift items).
export function toTopListProduct(raw: unknown): null | TopListProduct {
  if (typeof raw !== 'object' || raw === null) return null
  const product = raw as Record<string, unknown>
  const productId = readString(product.productNumber)
  const bold = readString(product.productNameBold)
  const type = productTypeOf(readString(product.categoryLevel1))
  if (!productId || !bold || type === ProductType.Uncertain) return null

  const thin = readString(product.productNameThin)
  const vintage = readString(product.vintage)
  // The card's subtitle is "{thin}, {vintage}", and the query is built from it
  // the same way, so a product looked up here and the same product's card
  // share one cache entry.
  const subtitle = [thin, vintage].filter(Boolean).join(', ')
  const packaging = readString(product.packagingLevel1)
  const country = readString(product.country)
  const producer = readString(product.producerName)

  return {
    facts: {
      country: countryCodeFromName(country),
      producer
    },
    isBottle: packaging ? isBottlePackaging(packaging) : true,
    name: buildSearchName(bold, subtitle),
    price: typeof product.price === 'number' ? product.price : 0,
    productId,
    title: [bold, subtitle].filter(Boolean).join(' · '),
    type,
    url: productUrl(type, bold, productId),
    volumeMl: typeof product.volume === 'number' ? product.volume : 0
  }
}

// Records the product searches the site runs. A PerformanceObserver rather
// than a read of the resource-timing buffer: the buffer holds 250 entries and
// stops recording once full, which an SPA session with product images reaches
// quickly; an observer is told about every entry regardless.
export function watchSiteSearches(): void {
  try {
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (!isListSearch(entry.name)) continue
        // Scrolling to the next page repeats a search with another page
        // number; the search is the same one.
        const url = withoutPage(entry.name)
        const known = recentSearches.indexOf(url)
        if (known !== -1) recentSearches.splice(known, 1)
        recentSearches.push(url)
        if (recentSearches.length > RECENT_SEARCHES_KEPT) recentSearches.shift()
      }
    }).observe({ buffered: true, type: 'resource' })
  } catch {
    // No resource timing: the button reports that it has nothing to rank.
  }
}

function distanceFromBottle({ product }: TopListEntry): number {
  return Math.abs(product.volumeMl - 750)
}

// The key in use: the shipped one until the API turns it away, then whatever
// the site's bundle holds — read once per page load, as a key that fails
// again is not one a second read would fix.
let siteApiKey = SITE_API_KEY
let siteApiKeyRead = false

// What Firefox adds to a content script's globals.
interface FirefoxContentScope {
  cloneInto?: <T>(value: T, target: object) => T
  content?: { fetch?: typeof fetch }
}

async function fetchSearchPage(
  searchUrl: string,
  page: number,
  signal?: AbortSignal
): Promise<SearchPage> {
  signal?.throwIfAborted()
  const url = new URL(searchUrl)
  url.searchParams.set('page', String(page))
  let response = await siteFetch(url.toString(), siteApiKey, signal)
  // APIM answers a rotated key with 401.
  if (response.status === 401 && !siteApiKeyRead) {
    siteApiKeyRead = true
    const key = await readSiteApiKey()
    if (key && key !== siteApiKey) {
      siteApiKey = key
      response = await siteFetch(url.toString(), siteApiKey, signal)
    }
  }
  if (!response.ok) {
    throw new Error(`Search failed: ${String(response.status)}`)
  }
  // Parsed here rather than with response.json(): on Firefox the response
  // belongs to the page, and so would the objects json() made.
  return JSON.parse(await response.text()) as SearchPage
}

function isListSearch(url: string): boolean {
  try {
    const parsed = new URL(url)
    // A free-text search from the header is a search too, but not the list
    // being looked at.
    return (
      SEARCH_PATH.test(parsed.pathname) && !parsed.searchParams.has('textQuery')
    )
  } catch {
    return false
  }
}

function productTypeOf(category: string | undefined): ProductType {
  switch (category) {
    case 'Cider & blanddrycker':
      return ProductType.Cider
    case 'Öl':
      return ProductType.Beer
    case 'Vin':
      return ProductType.Wine
    default:
      return ProductType.Uncertain
  }
}

// The product page's address. The site resolves a product by the number
// closing the path; the name before it is only for show.
function productUrl(type: ProductType, name: string, id: string): string {
  const section =
    type === ProductType.Wine
      ? 'vin'
      : type === ProductType.Beer
        ? 'ol'
        : 'cider-blanddrycker'
  const slug =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'produkt'
  return `https://www.systembolaget.se/produkt/${section}/${slug}-${id}/`
}

// The key the site's own frontend uses, out of the scripts the page loaded
// (the browser has them cached). Null when no script holds one.
async function readSiteApiKey(): Promise<null | string> {
  const sources = [
    ...document.querySelectorAll<HTMLScriptElement>(
      'script[src*="/_next/static/"]'
    )
  ].map((script) => script.src)
  const keys = await Promise.all(
    sources.map(async (source) => {
      try {
        const response = await fetch(source)
        if (!response.ok) return null
        return SITE_API_KEY_PATTERN.exec(await response.text())?.[1] ?? null
      } catch {
        return null
      }
    })
  )
  return keys.find((key) => key !== null) ?? null
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

// A request to the search API, sent as the page would send it. Chrome does
// that for a content script's own fetch, and the API's CORS lets the site's
// origin in. Firefox instead sends it as the extension, which reaches only
// the hosts in host_permissions — and adding the API's host there would ask
// every existing user for a new permission. Its content scripts get the
// page's own fetch as content.fetch for exactly this. The signal stays out of
// that call (an AbortSignal from the content script is not one to the page);
// fetchSearchPage checks it before every request instead.
function siteFetch(
  url: string,
  key: string,
  signal?: AbortSignal
): Promise<Response> {
  const headers = { 'Ocp-Apim-Subscription-Key': key }
  const { cloneInto, content } = globalThis as FirefoxContentScope
  if (content?.fetch && cloneInto) {
    return content.fetch(url, cloneInto({ headers }, content))
  }
  return fetch(url, { headers, signal })
}

function withoutPage(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('page')
  return parsed.toString()
}
