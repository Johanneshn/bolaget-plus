import browser from 'webextension-polyfill'

import {
  ImageRequest,
  ProductFacts,
  ProductType,
  RatingRequest,
  RatingResponse,
  RatingResultStatus,
  SearchConfigRequest,
  SpiritAccessRequest,
  UntappdSearchConfig
} from '@/@types/types'

import { fetchRatingFromUntappd, fetchRatingFromVivino } from './api'
import { getPinnedRating } from './pinnedMatches'
import { saveRating as cacheRating, tryGetRating } from './ratingsCache'
import { type RatingSource, sourceFor } from './sources'

export async function fetchRating(
  productId: string,
  productName: string,
  type: ProductType,
  includeImage = false,
  facts: ProductFacts = {}
): Promise<RatingResponse> {
  try {
    // A match the user picked by hand overrides any lookup.
    const pinned = await getPinnedRating(productId)
    if (pinned) {
      return pinned
    }
    const ratingRequest = {
      ...facts,
      includeImage,
      productId,
      productName,
      query: type
    }
    const cachedRating = await tryGetRating(ratingRequest)
    // An entry cached by a list page has no thumbnails; when the product
    // page asks for images, refetch instead of serving the imageless copy.
    if (
      cachedRating &&
      !(includeImage && isMissingImages(cachedRating, type))
    ) {
      return cachedRating
    }
    const response = await fetchFromSource(ratingRequest)

    if (
      response.status !== RatingResultStatus.NotFound &&
      !response.transient
    ) {
      await cacheRating(ratingRequest, response)
    }
    return response
  } catch {
    return { status: RatingResultStatus.NotFound } as RatingResponse
  }
}

// Both lookups are Algolia queries, and Algolia serves any origin. On Chrome a
// content script's cross-origin fetch is an ordinary CORS request, so running
// them here needs no host permission at all — which is what keeps algolia.net
// out of the manifest and out of the install prompt. Firefox works
// differently: it routes content-script requests through the extension's
// principal and blocks any host missing from `permissions` whatever CORS says,
// so that build hands the whole lookup to the background instead.
async function fetchFromSource(
  ratingRequest: RatingRequest
): Promise<RatingResponse> {
  // Rum and whisky are read from their sites by the background on either
  // browser: it holds the host permissions the popup asks for.
  if (
    import.meta.env.FIREFOX ||
    ratingRequest.query === ProductType.Rum ||
    ratingRequest.query === ProductType.Whisky
  ) {
    return await browser.runtime.sendMessage<RatingRequest, RatingResponse>(
      ratingRequest
    )
  }

  if (ratingRequest.query === ProductType.Wine) {
    return await fetchRatingFromVivino(
      ratingRequest.productName,
      ratingRequest.includeImage ?? true,
      { country: ratingRequest.country, producer: ratingRequest.producer },
      fetchImageViaBackground
    )
  }

  const askForConfig = (refresh: boolean) =>
    browser.runtime.sendMessage<SearchConfigRequest, UntappdSearchConfig>({
      refresh,
      type: 'untappdSearchConfig'
    })
  return await fetchRatingFromUntappd(
    ratingRequest.productName,
    await askForConfig(false),
    () => askForConfig(true)
  )
}

// Label thumbnails stay a background job even on Chrome: images.vivino.com
// sends no CORS headers, and the page CSP blocks hotlinking them anyway.
async function fetchImageViaBackground(
  url: string | undefined
): Promise<string | undefined> {
  if (!url) {
    return undefined
  }
  return await browser.runtime.sendMessage<ImageRequest, string | undefined>({
    type: 'vivinoImage',
    url
  })
}

function isMissingImages(rating: RatingResponse, type: ProductType): boolean {
  if (type !== ProductType.Wine) {
    return false
  }
  if (rating.status === RatingResultStatus.Found) {
    // An entry cached before vintages and runners-up were fetched has a
    // thumbnail but neither; refetch it rather than show the product page
    // without its vintage line and "Fel träff?" until the entry expires.
    return !rating.imageDataUrl || rating.vintages === undefined
  }
  return rating.alternatives?.some((a) => !a.imageDataUrl) ?? false
}

const LIST_FETCH_DELAY_MS = 300

// What a lookup held back while its site is paused answers. Transient, so
// nothing caches it.
const NOT_FETCHED: RatingResponse = {
  link: null,
  name: null,
  rating: 0,
  status: RatingResultStatus.NotFound,
  transient: true,
  votes: 0
}

let listFetchQueue: Promise<undefined> = Promise.resolve(undefined)

// A circuit breaker per rating site. Vivino and Untappd answer a burst of
// queries with 429s, and a ban outlasts the burst: going on at the queue's
// pace would only renew it — for the cards too, which share the key and the
// IP. (A product page's single lookup goes around the queue and the breaker:
// the user asked for that one wine.) So after BREAKER_FAILURES transient failures in a row
// the site is left alone for a while, doubling each time it is still failing,
// and the first lookup after the pause decides whether it is over.
const BREAKER_FAILURES = 5
const BREAKER_FIRST_PAUSE_MS = 60_000
const BREAKER_MAX_PAUSE_MS = 10 * 60_000
interface Breaker {
  failures: number
  nextPause: number
  pausedUntil: number
  // Paused at least once since the last success: the next failure pauses it
  // again at once.
  tripped: boolean
}
const breakers = new Map<RatingSource['id'], Breaker>()
// Kept for the tab, not just the page: product links are full page loads, and
// each load would otherwise grant a banned site five fresh queries.
const BREAKERS_KEY = 'bolaget-plus:breakers'
const BREAKER_SOURCES: readonly string[] = [
  'connosr',
  'rumx',
  'untappd',
  'vivino'
] satisfies RatingSource['id'][]
function isBreakerSource(source: string): source is RatingSource['id'] {
  return BREAKER_SOURCES.includes(source)
}
let breakersLoaded = false

export async function enqueueListFetch(
  productId: string,
  productName: string,
  type: ProductType,
  facts: ProductFacts = {}
): Promise<RatingResponse> {
  // Cached ratings render immediately — only real network fetches go through
  // the throttled queue, so a revisited list page fills in instantly instead
  // of trickling one badge per delay tick.
  const pinned = await getPinnedRating(productId).catch(() => null)
  if (pinned) {
    return pinned
  }
  const request = {
    ...facts,
    includeImage: false,
    productId,
    productName,
    query: type
  }
  const cached = await tryGetRating(request).catch(() => null)
  if (cached) {
    return cached
  }

  const task = listFetchQueue.then(async (): Promise<RatingResponse> => {
    // Held back without the wait while the site is paused.
    if (sourcePausedUntil(type) > 0) return { ...NOT_FETCHED }
    await new Promise((wait) => setTimeout(wait, LIST_FETCH_DELAY_MS))
    if (sourcePausedUntil(type) > 0) return { ...NOT_FETCHED }
    // A card ahead in the queue may have fetched this product meanwhile (the
    // same wine in two sizes, a re-sort). Served from the cache, and not
    // counted for the breaker, which a cache hit would reset as if the site
    // had answered.
    const meanwhile = await tryGetRating(request).catch(() => null)
    if (meanwhile) return meanwhile
    const rating = await fetchRating(productId, productName, type, false, facts)
    recordLookup(type, rating)
    return rating
  })
  listFetchQueue = task.then(() => undefined)
  return task
}

// When the site rating products of this type may be asked again, as a
// timestamp; 0 when it is not paused.
export function sourcePausedUntil(type: ProductType): number {
  loadBreakers()
  const breaker = breakers.get(sourceOf(type))
  return breaker && breaker.pausedUntil > Date.now() ? breaker.pausedUntil : 0
}

// Whether the user has let the extension read the site that rates this kind
// of spirit. A setting switched on elsewhere and synced here, or a permission
// revoked since, leaves the switch on without it; the page then shows nothing,
// as if the switch were off, rather than "no rating" on every bottle.
export async function spiritAccessGranted(type: ProductType): Promise<boolean> {
  try {
    return await browser.runtime.sendMessage<SpiritAccessRequest, boolean>({
      query: type,
      type: 'spiritAccess'
    })
  } catch {
    return false
  }
}

function loadBreakers() {
  if (breakersLoaded) return
  breakersLoaded = true
  try {
    const raw = sessionStorage.getItem(BREAKERS_KEY)
    if (!raw) return
    for (const [source, breaker] of Object.entries(
      JSON.parse(raw) as Record<string, Breaker>
    )) {
      // Only a whole breaker: a missing number would pause for NaN — never.
      if (
        isBreakerSource(source) &&
        [breaker.failures, breaker.nextPause, breaker.pausedUntil].every(
          Number.isFinite
        )
      ) {
        breakers.set(source, breaker)
      }
    }
  } catch {
    // Unreadable or blocked: start without a pause.
  }
}

function recordLookup(type: ProductType, rating: RatingResponse) {
  loadBreakers()
  const source = sourceOf(type)
  const breaker = breakers.get(source) ?? {
    failures: 0,
    nextPause: BREAKER_FIRST_PAUSE_MS,
    pausedUntil: 0,
    tripped: false
  }
  breakers.set(source, breaker)
  if (!rating.transient) {
    // Nothing to record unless it was failing.
    if (breaker.failures === 0 && !breaker.tripped) return
    breaker.failures = 0
    breaker.nextPause = BREAKER_FIRST_PAUSE_MS
    breaker.tripped = false
    saveBreakers()
    return
  }
  breaker.failures++
  if (breaker.tripped || breaker.failures >= BREAKER_FAILURES) {
    breaker.pausedUntil = Date.now() + breaker.nextPause
    breaker.nextPause = Math.min(breaker.nextPause * 2, BREAKER_MAX_PAUSE_MS)
    breaker.failures = 0
    breaker.tripped = true
  }
  saveBreakers()
}

function saveBreakers() {
  try {
    sessionStorage.setItem(
      BREAKERS_KEY,
      JSON.stringify(Object.fromEntries(breakers))
    )
  } catch {
    // Blocked: the pause holds for this page only.
  }
}

function sourceOf(type: ProductType): RatingSource['id'] {
  return sourceFor(type).id
}
