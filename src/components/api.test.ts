import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BeerResponse,
  RatingResultStatus,
  UntappdSearchConfig
} from '@/@types/types'
import {
  fetchRatingFromUntappd,
  fetchRatingFromVivino,
  fetchUntappdSearchConfig
} from '@/components/api'

// The beer lookup takes Untappd's Algolia credentials as an argument — the
// background reads the live pair off untappd.com, so unit tests hand it a
// fixed stand-in.
const searchConfig: UntappdSearchConfig = {
  appId: '9WBO4RQ3HO',
  searchKey: 'test-search-key'
}

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

describe('fetchRatingFromVivino', () => {
  it('accepts a hit whose winery is confirmed by the query', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 1,
            name: 'Crianza',
            statistics: { ratings_average: 4.1, ratings_count: 1200 },
            vintages: [
              { id: 11, statistics: { ratings_count: 30 } },
              { id: 12, statistics: { ratings_count: 900 } }
            ],
            winery: { name: 'El Coto' }
          }
        ],
        nbHits: 100
      })
    )

    const result = await fetchRatingFromVivino('El Coto Crianza', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('El Coto Crianza')
    expect(result.rating).toBe(4.1)
    expect(result.votes).toBe(1200)
    // Links by the most-rated vintage, not the wine id.
    expect(result.link).toBe('https://www.vivino.com/wines/12')
  })

  it('accepts an exact name match when the title is distinctive', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 2,
            name: 'Contacto Loureiro',
            statistics: { ratings_average: 4.0, ratings_count: 500 },
            winery: { name: 'Anselmo Mendes' }
          }
        ],
        nbHits: 3
      })
    )

    const result = await fetchRatingFromVivino('Contacto Loureiro', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    // No vintage data — falls back to the wine-id page.
    expect(result.link).toBe('https://www.vivino.com/w/2')
  })

  it('rejects an exact name match on a common style title', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 3,
            name: 'Prosecco Extra Dry',
            statistics: { ratings_average: 4.5, ratings_count: 9000 },
            winery: { name: 'Casa Bella' }
          }
        ],
        nbHits: 1714
      })
    )

    const result = await fetchRatingFromVivino('Prosecco Extra Dry', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBeUndefined()
    expect(result.link).toContain('vivino.com/search')
    expect(result.alternatives).toHaveLength(1)
  })

  it('rejects a near-namesake from an unconfirmed producer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 4,
            name: 'R Riesling Organic',
            statistics: { ratings_average: 4.2, ratings_count: 800 },
            winery: { name: 'R Wines' }
          }
        ],
        nbHits: 49
      })
    )

    const result = await fetchRatingFromVivino('Riesling Organic', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
  })

  it('accepts a hit the page producer confirms but the title cannot', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 20,
            name: 'Mucho Mas Merlot',
            statistics: { ratings_average: 3.4, ratings_count: 120 },
            winery: { name: 'Mucho Mas' }
          },
          {
            id: 21,
            name: 'Mucho Más Tinto',
            statistics: { ratings_average: 4.0, ratings_count: 15500 },
            winery: { name: 'Félix Solís' }
          }
        ],
        nbHits: 240
      })
    )

    const result = await fetchRatingFromVivino('Mucho Mas', false, {
      producer: 'Félix Solís Avantis'
    })

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('Félix Solís Mucho Más Tinto')
    expect(result.rating).toBe(4.0)
  })

  it("prefers the wine asked for over the producer's line extension", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 22,
            name: 'Mucho Mas Gold',
            statistics: { ratings_average: 3.9, ratings_count: 300 },
            winery: { name: 'Félix Solís' }
          },
          {
            id: 23,
            name: 'Mucho Más Tinto',
            statistics: { ratings_average: 4.0, ratings_count: 15500 },
            winery: { name: 'Félix Solís' }
          }
        ],
        nbHits: 240
      })
    )

    const result = await fetchRatingFromVivino('Mucho Mas', false, {
      producer: 'Félix Solís Avantis'
    })

    // "Gold" is a word the Systembolaget title never mentions; "Tinto" is a
    // colour it is free to leave out.
    expect(result.name).toBe('Félix Solís Mucho Más Tinto')
  })

  it('falls back to the title rules when the producer confirms nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 24,
            name: 'Crianza',
            statistics: { ratings_average: 4.1, ratings_count: 1200 },
            winery: { name: 'El Coto' }
          }
        ],
        nbHits: 100
      })
    )

    const result = await fetchRatingFromVivino('El Coto Crianza', false, {
      producer: 'Bodega Sin Relación'
    })

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('El Coto Crianza')
  })

  it('rejects a same-named wine from another country', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 30,
            name: 'Mucho Mas Merlot',
            region: { country: { code: 'cl', name: 'Chile' } },
            statistics: { ratings_average: 3.4, ratings_count: 120 },
            winery: { name: 'Mucho Mas' }
          }
        ],
        nbHits: 240
      })
    )

    // All a list card can read off itself is the country — and it is enough to
    // rule out the Chilean namesake of a Spanish wine.
    const result = await fetchRatingFromVivino('Mucho Mas', false, {
      country: 'es'
    })

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    // Still worth suggesting: better a "did you mean" than an empty card.
    expect(result.alternatives).toHaveLength(1)
  })

  it('keeps a hit whose country Vivino does not give', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 31,
            name: 'Crianza',
            statistics: { ratings_average: 4.1, ratings_count: 1200 },
            winery: { name: 'El Coto' }
          }
        ],
        nbHits: 100
      })
    )

    const result = await fetchRatingFromVivino('El Coto Crianza', false, {
      country: 'es'
    })

    // An unknown country is not a mismatch.
    expect(result.status).toBe(RatingResultStatus.Found)
  })

  it('reads the country from a bare region country code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            id: 32,
            name: 'Crianza',
            region: { country_code: 'CL', name: 'Central Valley' },
            statistics: { ratings_average: 4.1, ratings_count: 1200 },
            winery: { name: 'El Coto' }
          }
        ],
        nbHits: 100
      })
    )

    const result = await fetchRatingFromVivino('El Coto Crianza', false, {
      country: 'es'
    })

    expect(result.status).toBe(RatingResultStatus.Uncertain)
  })

  it('ignores hidden hits', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            hidden: true,
            id: 5,
            name: 'Hidden Wine',
            statistics: { ratings_average: 4.9, ratings_count: 10 },
            winery: { name: 'Hidden Winery' }
          }
        ],
        nbHits: 1
      })
    )

    const result = await fetchRatingFromVivino('Hidden Wine', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBeUndefined()
  })

  it('marks HTTP errors as transient so they are never cached', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))

    const result = await fetchRatingFromVivino('El Coto Crianza', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBe(true)
    expect(result.link).toContain('vivino.com/search')
  })

  it('marks network failures as transient', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const result = await fetchRatingFromVivino('El Coto Crianza', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBe(true)
  })
})

describe('fetchRatingFromUntappd', () => {
  it('returns the best-matching beer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            beer_name: 'Pabst Blue Ribbon',
            beer_slug: 'pabst-brewing-company-pabst-blue-ribbon',
            bid: 3092,
            brewery_beer_name: 'Pabst Brewing Company Pabst Blue Ribbon',
            brewery_name: 'Pabst Brewing Company',
            rating_count: 500000,
            rating_score: 2.9
          }
        ]
      })
    )

    const result = await fetchRatingFromUntappd(
      'Pabst Blue Ribbon',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.rating).toBe(2.9)
    expect(result.votes).toBe(500000)
    expect(result.link).toBe(
      'https://untappd.com/b/pabst-brewing-company-pabst-blue-ribbon/3092'
    )
    expect((result as BeerResponse).brewery).toBe('Pabst Brewing Company')
  })

  it('normalizes a missing score to 0 for the N/A rendering', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            beer_name: 'Rare Beer',
            beer_slug: 'rare-beer',
            bid: 1,
            brewery_beer_name: 'Tiny Brewery Rare Beer',
            brewery_name: 'Tiny Brewery',
            rating_count: null,
            rating_score: null
          }
        ]
      })
    )

    const result = await fetchRatingFromUntappd('Rare Beer', searchConfig)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.rating).toBe(0)
    expect(result.votes).toBe(0)
  })

  it('returns uncertain with a search link when nothing matches well', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            beer_name: 'Zzz Qqq',
            beer_slug: 'zzz-qqq',
            bid: 2,
            brewery_beer_name: 'Www Zzz Qqq',
            brewery_name: 'Www',
            rating_count: 5,
            rating_score: 3.0
          }
        ]
      })
    )

    const result = await fetchRatingFromUntappd(
      'Mellanmust Julebrygd',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.link).toContain('untappd.com/search')
    expect(result.alternatives).toHaveLength(1)
  })

  it('returns not found for an empty result set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits: [] }))

    const result = await fetchRatingFromUntappd(
      'Nonexistent Beer',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.NotFound)
  })

  it('marks HTTP errors as transient so they are never cached', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))

    const result = await fetchRatingFromUntappd(
      'Pabst Blue Ribbon',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBe(true)
    expect(result.link).toContain('untappd.com/search')
  })

  it('marks network failures as transient', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const result = await fetchRatingFromUntappd(
      'Pabst Blue Ribbon',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBe(true)
  })
})

describe('fetchUntappdSearchConfig', () => {
  // Untappd ships the credentials its own search JS uses in a JSON blob on
  // the search page. Reading them at runtime is what lets a rotated key heal
  // itself, so the parser has to survive their markup.
  function searchPage(config: string): Response {
    return new Response(
      `<html><body><script>window.UNTAPPD_SEARCH_CONFIG = ${config};</script></body></html>`
    )
  }

  it('reads the app id and search key off the search page', async () => {
    fetchMock.mockResolvedValueOnce(
      searchPage(
        JSON.stringify({
          appId: 'NEWAPPID12',
          autocompleteSearchKey: 'not-the-one-we-want',
          searchKey: 'rotated-key'
        })
      )
    )

    const config = await fetchUntappdSearchConfig()

    expect(config).toEqual({ appId: 'NEWAPPID12', searchKey: 'rotated-key' })
  })

  it('stops at the matching brace, not the first nested one', async () => {
    fetchMock.mockResolvedValueOnce(
      searchPage(
        JSON.stringify({
          appId: 'NESTED1234',
          filters: { beer: { abv: [0, 100] } },
          searchKey: 'nested-key'
        })
      )
    )

    const config = await fetchUntappdSearchConfig()

    expect(config.searchKey).toBe('nested-key')
  })

  it('falls back to the pinned pair when the blob is missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>no config here</html>'))

    const config = await fetchUntappdSearchConfig()

    expect(config.appId).toBe('9WBO4RQ3HO')
    expect(config.searchKey).toMatch(/^[0-9a-f]{32}$/)
  })

  it('falls back when the request fails outright', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    const config = await fetchUntappdSearchConfig()

    expect(config.appId).toBe('9WBO4RQ3HO')
  })
})
