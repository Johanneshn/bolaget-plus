import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import {
  ProductType,
  RatingRequest,
  RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import {
  removeExpiredRatings,
  saveRating,
  tryGetRating
} from '@/components/ratingsCache'

const request: RatingRequest = {
  includeImage: false,
  productId: '123',
  productName: 'Test Wine',
  query: ProductType.Wine
}

const rating: RatingResponse = {
  link: 'https://www.vivino.com/wines/1',
  name: 'Test Wine',
  rating: 4.2,
  status: RatingResultStatus.Found,
  votes: 10
}

const TWO_DAYS_AGO = new Date(
  Date.now() - 2 * 24 * 60 * 60 * 1000
).toISOString()

const LAST_SWEEP_KEY = 'ratings-last-sweep'

// The sweep's own bookkeeping key is asserted separately; keeping it out here
// leaves the other assertions about cache entries only.
async function storedKeys(): Promise<string[]> {
  const items = await fakeBrowser.storage.local.get(null)
  return Object.keys(items)
    .filter((key) => key !== LAST_SWEEP_KEY)
    .sort()
}

describe('ratingsCache', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('round-trips a saved rating', async () => {
    await saveRating(request, rating)

    await expect(tryGetRating(request)).resolves.toEqual(rating)
  })

  // A product is looked up from its list card and from its product page, and
  // the two must land on the same wine. Only the product page reliably knows
  // the producer, so its match may overwrite the card's — never the reverse.
  it('refetches when a producer is known and the cached match had none', async () => {
    await saveRating(request, rating)

    await expect(
      tryGetRating({ ...request, producer: 'Felix Solis' })
    ).resolves.toBeNull()
    // Left in place: the refetch that follows overwrites it.
    await expect(storedKeys()).resolves.toEqual([
      'ratings:123-wine',
      'ratings:123-wine$'
    ])
  })

  it('serves a producer-confirmed match to a lookup that knows no producer', async () => {
    await saveRating({ ...request, producer: 'Felix Solis' }, rating)

    await expect(tryGetRating(request)).resolves.toEqual(rating)
  })

  it('serves the entry when the producer is the one it was matched with', async () => {
    const withProducer = { ...request, producer: 'Felix Solis' }
    await saveRating(withProducer, rating)

    await expect(tryGetRating(withProducer)).resolves.toEqual(rating)
  })

  // Neither view sees everything: a card reads the country off its own text,
  // the product page also knows the producer. Whichever knows less must not
  // undo the other's match, or the two would take turns overwriting it.
  it('keeps the entry for a lookup that knows less than it did', async () => {
    await saveRating(
      { ...request, country: 'es', producer: 'Felix Solis' },
      rating
    )

    await expect(tryGetRating({ ...request, country: 'es' })).resolves.toEqual(
      rating
    )
  })

  it('refetches when the lookup adds the producer to what the card knew', async () => {
    await saveRating({ ...request, country: 'es' }, rating)

    await expect(
      tryGetRating({ ...request, country: 'es', producer: 'Felix Solis' })
    ).resolves.toBeNull()
  })

  it('evicts an expired entry on read', async () => {
    await saveRating(request, rating)
    await fakeBrowser.storage.local.set({
      'ratings:123-wine$': { datetime: TWO_DAYS_AGO }
    })

    await expect(tryGetRating(request)).resolves.toBeNull()
    await expect(storedKeys()).resolves.toEqual([])
  })

  it('sweeps expired entries for products never revisited', async () => {
    await saveRating(request, rating)
    await saveRating({ ...request, productId: '999' }, rating)
    await fakeBrowser.storage.local.set({
      'ratings:999-wine$': { datetime: TWO_DAYS_AGO }
    })

    await removeExpiredRatings()

    await expect(storedKeys()).resolves.toEqual([
      'ratings:123-wine',
      'ratings:123-wine$'
    ])
  })

  it('sweeps entries whose metadata is missing a timestamp', async () => {
    await fakeBrowser.storage.local.set({
      'ratings:555-beer': rating,
      'ratings:555-beer$': {}
    })

    await removeExpiredRatings()

    await expect(storedKeys()).resolves.toEqual([])
  })

  it('leaves fresh entries and unrelated keys alone', async () => {
    await saveRating(request, rating)
    await fakeBrowser.storage.local.set({ unrelated: 'value' })

    await removeExpiredRatings()

    await expect(storedKeys()).resolves.toEqual([
      'ratings:123-wine',
      'ratings:123-wine$',
      'unrelated'
    ])
  })

  // saveRating's setItem/setMeta pair is not atomic, and neither half is
  // self-evicting: a value with no metadata is refused by tryGetRating without
  // being removed, and metadata with no value is never even looked at.
  it('sweeps a value entry whose metadata never landed', async () => {
    await fakeBrowser.storage.local.set({ 'ratings:777-wine': rating })

    await removeExpiredRatings()

    await expect(storedKeys()).resolves.toEqual([])
  })

  it('sweeps metadata left behind without its value', async () => {
    await fakeBrowser.storage.local.set({
      'ratings:777-wine$': { datetime: new Date().toISOString() }
    })

    await removeExpiredRatings()

    await expect(storedKeys()).resolves.toEqual([])
  })

  // The MV3 service worker restarts constantly, and each sweep reads every
  // cached value — label images included — so it must not run per restart.
  it('sweeps at most once per interval, then again once it lapses', async () => {
    await saveRating({ ...request, productId: '999' }, rating)
    await fakeBrowser.storage.local.set({
      'ratings:999-wine$': { datetime: TWO_DAYS_AGO }
    })

    await removeExpiredRatings()
    await expect(storedKeys()).resolves.toEqual([])

    // An entry that expires just after a sweep waits for the next window.
    await saveRating(request, rating)
    await fakeBrowser.storage.local.set({
      'ratings:123-wine$': { datetime: TWO_DAYS_AGO }
    })

    await removeExpiredRatings()
    await expect(storedKeys()).resolves.toEqual([
      'ratings:123-wine',
      'ratings:123-wine$'
    ])

    // Backdating the marker stands in for the next browsing session.
    await fakeBrowser.storage.local.set({
      [LAST_SWEEP_KEY]: Date.now() - 2 * 60 * 60 * 1000
    })

    await removeExpiredRatings()
    await expect(storedKeys()).resolves.toEqual([])
  })
})
