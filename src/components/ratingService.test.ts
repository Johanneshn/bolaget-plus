import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import {
  ProductType,
  RatingRequest,
  RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import { pinMatch, unpinMatch } from '@/components/pinnedMatches'
import { saveRating } from '@/components/ratingsCache'
import {
  enqueueListFetch,
  fetchRating,
  sourcePausedUntil
} from '@/components/ratingService'

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

describe('enqueueListFetch', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  // The throttle exists to pace requests at the two rating sites; a cache hit
  // talks to neither, so making it wait behind the queue meant a revisited
  // list page trickled in one badge per tick.
  it('serves a cached rating without waiting for the throttle queue', async () => {
    await saveRating(request, rating)
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage')

    // No timer is ever advanced below, so a cache hit routed through the
    // queue's setTimeout would never settle — which is the regression: a
    // fully-cached list page trickled in one badge per delay tick.
    vi.useFakeTimers()
    try {
      await expect(
        enqueueListFetch(
          request.productId,
          request.productName,
          ProductType.Wine
        )
      ).resolves.toEqual(rating)
    } finally {
      vi.useRealTimers()
    }

    expect(sendMessage).not.toHaveBeenCalled()
  })

  // On Chrome the Algolia queries run in the content script — that is what
  // keeps algolia.net out of the manifest — so a cache miss goes straight to
  // the network rather than through the background script.
  it('falls through to the throttled fetch when nothing is cached', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: [
            {
              id: 7,
              name: 'Crianza',
              statistics: { ratings_average: 4.1, ratings_count: 1200 },
              vintages: [{ id: 71, statistics: { ratings_count: 900 } }],
              winery: { name: 'El Coto' }
            }
          ],
          nbHits: 5
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await enqueueListFetch(
        '456',
        'El Coto Crianza',
        ProductType.Wine
      )

      expect(result.status).toBe(RatingResultStatus.Found)
      expect(result.link).toBe('https://www.vivino.com/wines/71')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [requested] = fetchMock.mock.calls[0]
      const requestedUrl =
        requested instanceof Request ? requested.url : requested.toString()
      expect(requestedUrl).toContain('algolia.net')
      // List-page lookups never render thumbnails, so the background is never
      // asked to download one.
      expect(sendMessage).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a match the user picked by hand', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  const pick = {
    link: 'https://www.vivino.com/wines/2',
    name: 'The Right Wine',
    rating: 3.7,
    votes: 55
  }

  it('wins over the cached automatic match, on the page and on a card', async () => {
    await saveRating(request, rating)
    await pinMatch(request.productId, pick)

    const expected = { ...pick, pinned: true, status: RatingResultStatus.Found }
    await expect(
      fetchRating(request.productId, request.productName, ProductType.Wine)
    ).resolves.toMatchObject(expected)
    await expect(
      enqueueListFetch(request.productId, request.productName, ProductType.Wine)
    ).resolves.toMatchObject(expected)
  })

  it('gives way to the automatic match again once undone', async () => {
    await saveRating(request, rating)
    await pinMatch(request.productId, pick)
    await unpinMatch(request.productId)

    await expect(
      fetchRating(request.productId, request.productName, ProductType.Wine)
    ).resolves.toEqual(rating)
  })
})

describe('an entry cached by an older version', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('is refetched on the product page when it lacks the vintages', async () => {
    await saveRating(request, {
      ...rating,
      imageDataUrl: 'data:image/png;base64,AAAA'
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ hits: [], nbHits: 0 })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchRating(
      request.productId,
      request.productName,
      ProductType.Wine,
      true
    )

    expect(fetchMock).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('the list lookup queue', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  const vivinoHit = (name: string) =>
    new Response(
      JSON.stringify({
        hits: [
          {
            id: 7,
            name,
            statistics: { ratings_average: 4.1, ratings_count: 1200 },
            vintages: [{ id: 71, statistics: { ratings_count: 900 } }],
            winery: { name: 'El Coto' }
          }
        ],
        nbHits: 1
      })
    )

  // A "Topp 10" run queues hundreds of lookups; a card scrolled into view
  // during it must not wait for all of them.
  it('serves a card before the lookups of a Topp 10 run', async () => {
    const order: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_url, init) => {
        const body = JSON.parse(init?.body as string) as { params: string }
        order.push(new URLSearchParams(body.params).get('query') ?? '')
        return Promise.resolve(vivinoHit('Crianza'))
      })
    )
    try {
      const bulk = ['b1', 'b2', 'b3'].map((id) =>
        enqueueListFetch(
          id,
          `El Coto Bulk ${id}`,
          ProductType.Wine,
          {},
          {
            bulk: true
          }
        )
      )
      const card = enqueueListFetch('c1', 'El Coto Card', ProductType.Wine)
      await Promise.all([...bulk, card])
      expect(order.indexOf('El Coto Card')).toBeLessThanOrEqual(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // A run must not query the site again for every card already badged just
  // because it knows the producer and the card did not.
  it('reuses a cached rating for a Topp 10 lookup that knows more', async () => {
    await saveRating(request, rating)
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        enqueueListFetch(
          request.productId,
          request.productName,
          ProductType.Wine,
          { country: 'es', producer: 'El Coto' },
          { bulk: true }
        )
      ).resolves.toEqual(rating)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops the lookups of a cancelled run without asking the site', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(vivinoHit('Crianza'))
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const run = new AbortController()
      const lookups = ['x1', 'x2', 'x3'].map((id) =>
        enqueueListFetch(
          id,
          `Wine ${id}`,
          ProductType.Wine,
          {},
          {
            bulk: true,
            signal: run.signal
          }
        )
      )
      run.abort()
      const results = await Promise.all(lookups)
      expect(results.every((result) => result.transient)).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // A rate limit answered by more queries at the same pace only renews the
  // ban — for the cards and product pages too.
  it('pauses a site that keeps turning lookups away', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('', { status: 429 }))
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          enqueueListFetch(
            `r${String(i)}`,
            `Wine ${String(i)}`,
            ProductType.Wine,
            {},
            {
              bulk: true
            }
          )
        )
      )
      expect(results.every((result) => result.transient)).toBe(true)
      // Five failures in a row open the breaker; the rest never leave.
      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(sourcePausedUntil(ProductType.Wine)).toBeGreaterThan(Date.now())
      // Untappd is another site, and is not paused with Vivino.
      expect(sourcePausedUntil(ProductType.Beer)).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
