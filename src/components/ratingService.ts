import browser from 'webextension-polyfill'

import {
  ImageRequest,
  ProductFacts,
  ProductType,
  RatingRequest,
  RatingResponse,
  RatingResultStatus,
  SearchConfigRequest,
  UntappdSearchConfig
} from '@/@types/types'

import { fetchRatingFromUntappd, fetchRatingFromVivino } from './api'
import { getPinnedRating } from './pinnedMatches'
import { saveRating as cacheRating, tryGetRating } from './ratingsCache'

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
  if (import.meta.env.FIREFOX) {
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

  const config = await browser.runtime.sendMessage<
    SearchConfigRequest,
    UntappdSearchConfig
  >({ type: 'untappdSearchConfig' })
  return await fetchRatingFromUntappd(ratingRequest.productName, config)
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

// What a lookup that never reached the network answers: cancelled, or held
// back while its source is paused. Transient, so nothing caches it.
const NOT_FETCHED: RatingResponse = {
  link: null,
  name: null,
  rating: 0,
  status: RatingResultStatus.NotFound,
  transient: true,
  votes: 0
}

// The lookups waiting for their turn, in two lanes paced as one: a card the
// user is looking at goes before the hundreds a "Topp 10" run queues, or the
// cards scrolled to during a run would sit as spinners until it ends.
interface QueuedLookup {
  // Answers from the cache when it can, else waits its turn's delay and asks
  // the site.
  run: () => Promise<void>
  skip: () => void
  // Whether its turn may be skipped without a wait: cancelled, or its source
  // paused.
  skippable: () => boolean
}
const cardLane: QueuedLookup[] = []
const bulkLane: QueuedLookup[] = []
let draining = false

async function drainLanes() {
  if (draining) return
  draining = true
  try {
    for (;;) {
      const next = cardLane.shift() ?? bulkLane.shift()
      if (!next) break
      if (next.skippable()) {
        next.skip()
        continue
      }
      await next.run()
    }
  } finally {
    draining = false
  }
}

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
const breakers = new Map<'untappd' | 'vivino', Breaker>()
// Kept for the tab, not just the page: product links are full page loads, and
// each load would otherwise grant a banned site five fresh queries.
const BREAKERS_KEY = 'bolaget-plus:breakers'
let breakersLoaded = false

export async function enqueueListFetch(
  productId: string,
  productName: string,
  type: ProductType,
  facts: ProductFacts = {},
  options: {
    // A "Topp 10" lookup: it waits behind the cards, and a cached rating
    // serves it even when it knows a fact the entry was matched without — a
    // run should not query the site again for every card already badged.
    bulk?: boolean
    signal?: AbortSignal
  } = {}
): Promise<RatingResponse> {
  const { bulk = false, signal } = options
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
  const fromCache = async () => {
    if (bulk) {
      // Asked without the facts, the cache answers with whatever it holds; a
      // rating found is kept, anything less gets its chance at the facts.
      const known = await tryGetRating({
        includeImage: false,
        productId,
        productName,
        query: type
      }).catch(() => null)
      if (known?.status === RatingResultStatus.Found) return known
    }
    return await tryGetRating(request).catch(() => null)
  }
  const cached = await fromCache()
  if (cached) {
    return cached
  }

  return new Promise<RatingResponse>((resolve) => {
    const lookup: QueuedLookup = {
      run: async () => {
        signal?.removeEventListener('abort', leaveQueue)
        // A card or a run ahead in the queue may have fetched this product
        // meanwhile. Served without the delay — and without counting for the
        // breaker, which a cache hit would reset as if the site had answered.
        const meanwhile = await fromCache()
        if (meanwhile) {
          resolve(meanwhile)
          return
        }
        await new Promise((wait) => setTimeout(wait, LIST_FETCH_DELAY_MS))
        if (lookup.skippable()) {
          resolve({ ...NOT_FETCHED })
          return
        }
        // Filled during the wait: still not an answer from the site.
        const late = await fromCache()
        if (late) {
          resolve(late)
          return
        }
        const rating = await fetchRating(
          productId,
          productName,
          type,
          false,
          facts
        )
        recordLookup(type, rating)
        resolve(rating)
      },
      skip: () => {
        resolve({ ...NOT_FETCHED })
      },
      skippable: () => signal?.aborted === true || sourcePausedUntil(type) > 0
    }
    const lane = bulk ? bulkLane : cardLane
    lane.push(lookup)
    // A cancelled "Topp 10" run leaves the queue at once, so a later run or
    // card is not held up behind its leftovers.
    function leaveQueue() {
      const index = lane.indexOf(lookup)
      if (index === -1) return
      lane.splice(index, 1)
      lookup.skip()
    }
    signal?.addEventListener('abort', leaveQueue, { once: true })
    void drainLanes()
  })
}

// When the site rating products of this type may be asked again, as a
// timestamp; 0 when it is not paused.
export function sourcePausedUntil(type: ProductType): number {
  loadBreakers()
  const breaker = breakers.get(sourceOf(type))
  return breaker && breaker.pausedUntil > Date.now() ? breaker.pausedUntil : 0
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
        (source === 'untappd' || source === 'vivino') &&
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

function sourceOf(type: ProductType): 'untappd' | 'vivino' {
  return type === ProductType.Wine ? 'vivino' : 'untappd'
}
