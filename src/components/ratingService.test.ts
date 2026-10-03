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
import { enqueueListFetch, fetchRating } from '@/components/ratingService'

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
