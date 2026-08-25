import { storage } from '@wxt-dev/storage'
import browser from 'webextension-polyfill'

import { RatingRequest, RatingResponse } from '@/@types/types'

const CACHE_EXPIRATION_DAYS = 1

// The per-entry metadata @wxt-dev/storage keeps alongside a cached rating.
type CacheMeta = Record<string, unknown> & {
  datetime: string
  producer?: null | string
}

const RATINGS_KEY_PREFIX = 'ratings:'
// @wxt-dev/storage stores an item's metadata under `<key>$`.
const META_KEY_SUFFIX = '$'
// The MV3 service worker restarts on every message after a short idle, so an
// unguarded sweep would re-read the whole cache — base64 label images included
// — many times per browsing session. Hourly is often enough for a cache that
// expires daily.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
// Deliberately outside RATINGS_KEY_PREFIX so the sweep never evicts its own
// bookkeeping.
const LAST_SWEEP_KEY = 'local:ratings-last-sweep'

// tryGetRating only evicts an entry when its own product is revisited after
// expiry; without a sweep, entries for products never seen again pile up
// forever — and since responses carry base64 label images they would
// eventually exhaust the storage.local quota. Run on background startup.
export async function removeExpiredRatings(): Promise<void> {
  const startedAt = Date.now()
  const lastSweep = await storage.getItem<number>(LAST_SWEEP_KEY)
  if (lastSweep !== null && startedAt - lastSweep < SWEEP_INTERVAL_MS) {
    return
  }
  await storage.setItem(LAST_SWEEP_KEY, startedAt)

  const allItems = await browser.storage.local.get(null)
  const now = new Date()
  const expiredKeys: string[] = []

  for (const [key, value] of Object.entries(allItems)) {
    if (!key.startsWith(RATINGS_KEY_PREFIX)) {
      continue
    }
    if (!key.endsWith(META_KEY_SUFFIX)) {
      // saveRating's two writes are not atomic, so a terminated service worker
      // can leave a value with no metadata. tryGetRating rejects such an entry
      // without evicting it, so it would otherwise never expire.
      if (!Object.hasOwn(allItems, `${key}${META_KEY_SUFFIX}`)) {
        expiredKeys.push(key)
      }
      continue
    }
    const valueKey = key.slice(0, -META_KEY_SUFFIX.length)
    if (!Object.hasOwn(allItems, valueKey)) {
      // The mirror image: metadata whose value is gone is dead weight.
      expiredKeys.push(key)
      continue
    }
    const datetime =
      typeof value === 'object' &&
      value !== null &&
      'datetime' in value &&
      typeof value.datetime === 'string'
        ? value.datetime
        : null
    const expired =
      !datetime ||
      calculateDaysDifference(new Date(datetime), now) > CACHE_EXPIRATION_DAYS
    if (expired) {
      expiredKeys.push(valueKey, key)
    }
  }

  if (expiredKeys.length > 0) {
    await browser.storage.local.remove(expiredKeys)
  }
}

export async function saveRating(
  ratingRequest: RatingRequest,
  rating: RatingResponse
): Promise<void> {
  const key = generateCacheKey(ratingRequest)
  await Promise.all([
    storage.setItem(key, rating),
    storage.setMeta(key, {
      datetime: new Date().toISOString(),
      // What the match was made to know. Stored so a later lookup that knows
      // more is not served an answer that was reached with less — see
      // tryGetRating.
      producer: ratingRequest.producer ?? null
    })
  ])

  return
}

export async function tryGetRating(
  ratingRequest: RatingRequest
): Promise<null | RatingResponse> {
  const key = generateCacheKey(ratingRequest)
  const [cachedRating, metadata] = await Promise.all([
    storage.getItem<RatingResponse>(key),
    storage.getMeta<CacheMeta>(key)
  ])
  if (!cachedRating || !metadata.datetime) {
    return null
  }

  // One product is looked up from two places — its list card and its product
  // page — and they must land on the same wine. They share this entry, which
  // settles it, but only if the better-informed lookup gets to write it: a
  // card whose page data doesn't reach that far cannot see the producer, and
  // a match made without it is not one the product page may then be served.
  // Left in place rather than evicted; the refetch overwrites it.
  if (
    ratingRequest.producer !== undefined &&
    (metadata.producer ?? undefined) !== ratingRequest.producer
  ) {
    return null
  }
  const diffDays = calculateDaysDifference(
    new Date(metadata.datetime),
    new Date()
  )

  if (diffDays > CACHE_EXPIRATION_DAYS) {
    await storage.removeItem(key, {
      removeMeta: true
    })
    return null
  }

  return cachedRating
}

function calculateDaysDifference(date1: Date, date2: Date): number {
  const diffTime = date2.getTime() - date1.getTime()
  return diffTime / (1000 * 3600 * 24)
}

function generateCacheKey(ratingRequest: RatingRequest): `local:${string}` {
  return `local:ratings:${ratingRequest.productId}-${ratingRequest.query}`
}
