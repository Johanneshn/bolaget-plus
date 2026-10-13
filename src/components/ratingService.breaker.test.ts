import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import { ProductType, RatingResultStatus } from '@/@types/types'

// The breaker lives in module state; each test imports a fresh copy.
async function freshService() {
  vi.resetModules()
  return await import('@/components/ratingService')
}

const rateLimited = () => Promise.resolve(new Response('', { status: 429 }))

describe('the rate-limit breaker', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    // Only the clock is faked: the queue's 300 ms pacing runs for real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // A ban outlasts the pause; the first lookup after it must find that out
  // alone, not five more of them.
  it('sends one probe after a pause, and pauses twice as long when it fails', async () => {
    const { enqueueListFetch, sourcePausedUntil } = await freshService()
    const fetchMock = vi.fn<typeof fetch>(rateLimited)
    vi.stubGlobal('fetch', fetchMock)
    const lookUp = (id: string) =>
      enqueueListFetch(id, `Wine ${id}`, ProductType.Wine)

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(lookUp))
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const firstPause = sourcePausedUntil(ProductType.Wine) - Date.now()
    expect(firstPause).toBe(60_000)

    vi.setSystemTime(Date.now() + firstPause + 1)
    await Promise.all(['f', 'g', 'h'].map(lookUp))
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(sourcePausedUntil(ProductType.Wine) - Date.now()).toBe(120_000)
  })

  // A cache hit says nothing about whether the site is answering again.
  it('is not reset by a lookup the cache answered', async () => {
    const { enqueueListFetch, sourcePausedUntil } = await freshService()
    const { saveRating } = await import('@/components/ratingsCache')
    const fetchMock = vi.fn<typeof fetch>(rateLimited)
    vi.stubGlobal('fetch', fetchMock)
    const lookUp = (id: string) =>
      enqueueListFetch(id, `Wine ${id}`, ProductType.Wine)

    await Promise.all(['a', 'b', 'c', 'd'].map(lookUp))
    await saveRating(
      {
        includeImage: false,
        productId: 'cached',
        productName: 'Wine cached',
        query: ProductType.Wine
      },
      {
        link: 'https://www.vivino.com/wines/1',
        name: 'Cached',
        rating: 4,
        status: RatingResultStatus.Found,
        votes: 100
      }
    )
    await lookUp('cached')
    await lookUp('e')
    expect(sourcePausedUntil(ProductType.Wine)).toBeGreaterThan(Date.now())
  })

  it('resets once the site answers again', async () => {
    const { enqueueListFetch, sourcePausedUntil } = await freshService()
    let limited = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        limited
          ? rateLimited()
          : Promise.resolve(
              new Response(JSON.stringify({ hits: [], nbHits: 0 }))
            )
      )
    )
    const lookUp = (id: string) =>
      enqueueListFetch(id, `Wine ${id}`, ProductType.Wine)

    await Promise.all(['a', 'b', 'c', 'd'].map(lookUp))
    limited = false
    await lookUp('e')
    limited = true
    await Promise.all(['f', 'g', 'h', 'i'].map(lookUp))
    // Four failures after a success: not five in a row yet.
    expect(sourcePausedUntil(ProductType.Wine)).toBe(0)
  })
})
