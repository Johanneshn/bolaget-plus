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
// How long one search request may take.
const SEARCH_TIMEOUT_MS = 15_000
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
  // The site's own thumbnail of the bottle, the one its cards show.
  imageUrl?: string
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
  const products = new Map<string, TopListProduct>()
  let loaded = 0
  // Fixed at the first page: a product added to the range mid-run must not
  // turn a run under way into one "too long to rank".
  let total = 0
  // Pages are asked for until the total is reached, not by the API's nextPage,
  // which a run must not depend on to see the whole list; the bound stops a
  // total that is never reached (products leaving the range mid-run).
  for (let page = 1; page <= Math.ceil(MAX_PRODUCTS / PAGE_SIZE) + 1; page++) {
    const json = await fetchSearchPage(searchUrl, page, signal)
    const hits = json.products ?? []
    if (page === 1) {
      total = json.metadata?.docCount ?? hits.length
      if (total > MAX_PRODUCTS) return { tooMany: total }
      if (confirmTotal && !(await confirmTotal(total))) return null
    }
    loaded += hits.length
    for (const raw of hits) {
      // A product the range shifted onto the next page too is looked up once.
      const product = toTopListProduct(raw)
      if (product) products.set(product.productId, product)
    }
    onProgress(Math.min(loaded, total), total)
    if (hits.length === 0 || loaded >= total) break
  }
  return { products: [...products.values()] }
}

// The search behind the list on screen: the most recent one whose total is
// the "N varor" the page shows. Each candidate costs one request, newest
// first, so the right one is usually the first or second asked.
export async function findListSearch(
  count: null | number,
  signal?: AbortSignal
): Promise<null | string> {
  // Without a count to tell the list's search from the others, there is no
  // telling which one it is: better no list than another list's.
  if (count === null) return null
  const candidates = [...recentSearches].reverse()
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

// Whether the site recorded this search since the page was loaded — that is,
// whether a saved list was made from the list on screen. The search carries
// the store, which the page URL does not.
export function isRecentSearch(url: string): boolean {
  return recentSearches.includes(url)
}

// The rated products, best first. A rating with few votes says little, so a
// tie — the same score as printed, one decimal for Vivino and two for
// Untappd — goes to the wine more people rated. Ties are judged at the printed
// precision, not coarser: a list showing 3,46 above 3,5 reads as a bug.
// Vivino rates a wine, not a bottle size, so the 375 ml and 750 ml of one wine
// would take two places with the same rating; each wine is listed once, in the
// size closest to a standard bottle. With "Dölj provade" on, tasted ones make
// room for the next best.
export function rankTopList(
  entries: TopListEntry[],
  { hideTasted = false, limit = 10 } = {}
): TopListEntry[] {
  const tastedWines = tastedWinesOf(entries)
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
        Math.round(b.rating.rating * 100) - Math.round(a.rating.rating * 100) ||
        b.rating.votes - a.rating.votes
    )
    .slice(0, limit)
}

// The rated wines the user has tasted, in any size: how many "Dölj provade"
// takes out of the ranking.
export function tastedWinesOf(entries: TopListEntry[]): Set<string> {
  return new Set(
    entries.filter((entry) => entry.tasted && isRated(entry.rating)).map(wineOf)
  )
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
  const image = Array.isArray(product.images)
    ? readString(
        (product.images[0] as Record<string, unknown> | undefined)?.imageUrl
      )
    : undefined

  return {
    facts: {
      country: countryCodeFromName(country),
      producer
    },
    imageUrl: image ? thumbnailUrl(image) : undefined,
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
    // No resource timing: a run reports that it could not read the list.
  }
}

function distanceFromBottle({ product }: TopListEntry): number {
  return Math.abs(product.volumeMl - 750)
}

// Tasted is marked per product, but listed per wine: having had the 750 ml
// counts for the 375 ml too, or hiding one bottle would promote the other.
function wineOf(entry: TopListEntry): string {
  return entry.rating.link ?? entry.product.productId
}

// The key in use: the shipped one until the API turns it away, then whatever
// the site's bundle holds — read once per page load, as a key that fails
// again is not one a second read would fix.
let siteApiKey = SITE_API_KEY
let siteApiKeyRead = false

// What Firefox adds to a content script's globals.
interface FirefoxContentScope {
  cloneInto?: <T>(value: T, target: object) => T
}

// The page's own window, which Firefox hands a content script on request.
interface FirefoxWindow extends Window {
  wrappedJSObject?: { fetch?: typeof fetch }
}

async function fetchSearchPage(
  searchUrl: string,
  page: number,
  signal?: AbortSignal
): Promise<SearchPage> {
  signal?.throwIfAborted()
  const url = new URL(searchUrl)
  url.searchParams.set('page', String(page))
  let response = await searchOnce(url.toString(), siteApiKey, signal)
  // APIM answers a rotated key with 401.
  if (response.status === 401 && !siteApiKeyRead) {
    siteApiKeyRead = true
    const key = await readSiteApiKey()
    if (key && key !== siteApiKey) {
      siteApiKey = key
      response = await searchOnce(url.toString(), siteApiKey, signal)
    }
  }
  if (response.status < 200 || response.status > 299) {
    throw new Error(`Search failed: ${String(response.status)}`)
  }
  return JSON.parse(response.body) as SearchPage
}

function isListSearch(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!SEARCH_PATH.test(parsed.pathname)) return false
    // The header's search box searches as the user types; those are not the
    // list being looked at — unless the list is the results of that very
    // search ("/sortiment/?q=primitivo").
    const text = parsed.searchParams.get('textQuery')
    if (text === null) return true
    const page = new URLSearchParams(location.search)
    return (page.get('q') ?? page.get('textQuery')) === text
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
        const text = await withDeadline(
          (async () => {
            const response = await fetch(source)
            return response.ok ? await response.text() : ''
          })()
        )
        return SITE_API_KEY_PATTERN.exec(text)?.[1] ?? null
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

// One search request, its body read in full: a body that stalls is as stuck
// as a request that does. Read here rather than with response.json(): on
// Firefox the response belongs to the page, and so would json()'s objects.
function searchOnce(
  url: string,
  key: string,
  signal?: AbortSignal
): Promise<{ body: string; status: number }> {
  return withDeadline(
    (async () => {
      const response = await siteFetch(url, key, signal)
      return { body: await response.text(), status: response.status }
    })(),
    signal
  )
}

// A request to the search API, sent as the page would send it. Chrome does
// that for a content script's own fetch, and the API's CORS lets the site's
// origin in. Firefox instead sends it as the extension, which reaches only
// the hosts in host_permissions — and adding the API's host there would ask
// every existing user for a new permission. So on Firefox the request goes
// through the page's own fetch (window.wrappedJSObject; the content.fetch MDN
// describes is not there in current releases), with its options cloned into
// the page. The signal stays out of that call (an AbortSignal from the
// content script is not one to the page); fetchSearchPage checks it before
// and after every request instead.
function siteFetch(
  url: string,
  key: string,
  signal?: AbortSignal
): Promise<Response> {
  const headers = { 'Ocp-Apim-Subscription-Key': key }
  const { cloneInto } = globalThis as FirefoxContentScope
  const page =
    typeof window === 'undefined'
      ? undefined
      : (window as FirefoxWindow).wrappedJSObject
  if (page?.fetch && cloneInto) {
    return page.fetch(url, cloneInto({ headers }, window))
  }
  return fetch(url, { headers, signal })
}

// The thumbnail as the site's cards load it — through its own image resizer,
// at the size a card shows — so it is the one the browser already has.
function thumbnailUrl(image: string): string {
  const source = encodeURIComponent(`${image}_100.webp`)
  return `https://www.systembolaget.se/_next/image/?url=${source}&w=64&q=75`
}

// A search request that gives up after SEARCH_TIMEOUT_MS, or as soon as the
// run is cancelled. On Firefox the page's fetch is not given the run's signal
// (see siteFetch), so a hung request would otherwise hold the run open.
function withDeadline<T>(
  request: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (reason: string) => () => {
      settle()
      reject(new Error(reason))
    }
    const onAbort = stop('Search cancelled')
    const timer = setTimeout(stop('Search timed out'), SEARCH_TIMEOUT_MS)
    const settle = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // Awaited into a promise of our own first: on Firefox the request is the
    // page's promise, and the page cannot call the content script's functions
    // handed to its then() — they would never run. await is not affected.
    const own = (async () => await request)()
    own.then(
      (value) => {
        settle()
        resolve(value)
      },
      (error: unknown) => {
        settle()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

// The search without what only orders or pages it: scrolling to page 2 or
// re-sorting the list repeats the same search, which a run ranks the same.
function withoutPage(url: string): string {
  const parsed = new URL(url)
  for (const param of ['page', 'size', 'sortBy', 'sortDirection']) {
    parsed.searchParams.delete(param)
  }
  return parsed.toString()
}
