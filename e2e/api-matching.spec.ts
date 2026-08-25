import { expect, test } from '@playwright/test'

import type { VivinoHit } from '../src/@types/types'

import { RatingResultStatus, UntappdSearchConfig } from '../src/@types/types'
import {
  fetchRatingFromUntappd,
  fetchRatingFromVivino
} from '../src/components/api'

// Every test in this file stubs globalThis.fetch, so it needs no network and
// no browser: these are the API regression tests that gate CI. The live
// Vivino/Untappd queries they were extracted from are in api-live.spec.ts.

// The search credentials the mocked Untappd responses are answered with. The
// live values are read from untappd.com by api-live.spec.ts; here they only
// need to be well-formed.
const searchConfig: UntappdSearchConfig = {
  appId: '9WBO4RQ3HO',
  searchKey: '1d347324d67ec472bb7132c66aead485'
}

// Routes mocked fetches: true for the Algolia search call, false for the
// image downloads that follow it.
function isVivinoSearchUrl(url: string): boolean {
  return new URL(url).hostname === '9takgwjuxl-dsn.algolia.net'
}

// Builds an Algolia WINES_prod hit. Wine names in the index do NOT include
// the producer — that lives in the separate winery field.
function vivinoHit(
  overrides: Partial<VivinoHit> & { name: string }
): VivinoHit {
  return {
    id: 1,
    statistics: { ratings_average: 4.0, ratings_count: 100 },
    vintages: [{ id: 9001, statistics: { ratings_count: 100 } }],
    ...overrides
  }
}

function vivinoSearchResponse(hits: VivinoHit[], nbHits?: number): Response {
  return {
    json: () => Promise.resolve({ hits, nbHits: nbHits ?? hits.length }),
    ok: true
  } as Response
}

// Offline tests: even Algolia misses some wines, so a miss must surface an
// Uncertain result with a working search link — never a dead-end NotFound.
test.describe('Vivino lookup misses (mocked fetch)', () => {
  const realFetch = globalThis.fetch

  test.afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('returns Uncertain with a search link when the search has no hits', async () => {
    globalThis.fetch = () => Promise.resolve(vivinoSearchResponse([]))

    const result = await fetchRatingFromVivino('Torre do Olivar')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.link).toBe(
      'https://www.vivino.com/search/wines?q=Torre%20do%20Olivar'
    )
    // A genuine no-match is definitive and may be cached.
    expect(result.transient).toBeUndefined()
  })

  test('returns Uncertain with a search link when the request fails', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network down'))

    const result = await fetchRatingFromVivino('Some Obscure Wine')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.link).toContain('vivino.com/search/wines')
    // Network failures are transient and must not be cached for a day.
    expect(result.transient).toBe(true)
  })

  test('marks rate-limited responses transient so they are not cached', async () => {
    globalThis.fetch = () =>
      Promise.resolve({ ok: false, status: 429 } as Response)

    const result = await fetchRatingFromVivino('Some Wine')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.transient).toBe(true)
  })

  // Regression test: vivino.com/wines/{id} resolves by vintage id, not the
  // generic wine id — using wine.id links to an unrelated wine (e.g. the
  // Black Stallion Cabernet Sauvignon 2023's wine.id 1166077 resolves to a
  // 2005 Bourgogne Pinot Noir instead). The displayed rating is the pooled
  // wine-level one, so the link must go to the most-rated vintage (Vivino's
  // "all vintages" entry when present).
  test('links the most-rated vintage, never the generic wine id', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 1166077,
            name: 'Cabernet Sauvignon',
            vintages: [
              { id: 173862896, statistics: { ratings_count: 54 } },
              { id: 155001234, statistics: { ratings_count: 3 } }
            ],
            winery: { name: 'Black Stallion' }
          })
        ])
      )

    const result = await fetchRatingFromVivino(
      'Black Stallion Napa Valley Cabernet Sauvignon',
      false
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.link).toBe('https://www.vivino.com/wines/173862896')
  })

  test('falls back to the wine page when a hit has no vintages', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 8619,
            name: 'Crianza',
            vintages: [],
            winery: { name: 'El Coto' }
          })
        ])
      )

    const result = await fetchRatingFromVivino('El Coto Crianza', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.link).toBe('https://www.vivino.com/w/8619')
  })

  test('returns ranked alternatives when no Vivino match is confident enough', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          // Fantasy wines with no winery data: none can be confirmed as the
          // right producer, so even "Falco Nero Riserva" (similarity 0.514,
          // above the 0.5 floor) must not auto-match — it leads the ranked
          // alternatives instead.
          vivinoHit({
            id: 1,
            name: 'Torre Bianca Chardonnay',
            vintages: [{ id: 11, statistics: { ratings_count: 100 } }]
          }),
          vivinoHit({
            id: 2,
            name: 'Falco Nero Riserva',
            statistics: { ratings_average: 4.4, ratings_count: 300 },
            vintages: [{ id: 22, statistics: { ratings_count: 300 } }]
          }),
          vivinoHit({
            id: 3,
            name: 'Nero d Avola Sicilia',
            statistics: { ratings_average: 3.8, ratings_count: 50 },
            vintages: [{ id: 33, statistics: { ratings_count: 50 } }]
          }),
          vivinoHit({
            id: 4,
            name: 'Rioja Gran Reserva',
            statistics: { ratings_average: 3.9, ratings_count: 80 },
            vintages: [{ id: 44, statistics: { ratings_count: 80 } }]
          })
        ])
      )

    const result = await fetchRatingFromVivino('Torre del Falco Nero 2020')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.link).toContain('vivino.com/search/wines')
    // Capped at 3, ranked by similarity to the query.
    expect(result.alternatives).toHaveLength(3)
    expect(result.alternatives?.[0]).toEqual({
      link: 'https://www.vivino.com/wines/22',
      name: 'Falco Nero Riserva',
      rating: 4.4,
      votes: 300
    })
  })

  test('attaches label thumbnails as data URLs (page CSP blocks hotlinking)', async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (isVivinoSearchUrl(url)) {
        return Promise.resolve(
          vivinoSearchResponse([
            vivinoHit({
              id: 42,
              image: {
                variations: {
                  label_medium: '//images.vivino.com/thumbs/fake_150x200.png'
                }
              },
              name: 'Cabernet Sauvignon',
              winery: { name: 'Black Stallion' }
            })
          ])
        )
      }
      // Image request — must be the https-normalized thumbnail URL.
      expect(url).toBe('https://images.vivino.com/thumbs/fake_150x200.png')
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(fakePng.buffer),
        headers: new Headers({ 'content-type': 'image/png' }),
        ok: true
      } as unknown as Response)
    }

    const result = await fetchRatingFromVivino(
      'Black Stallion Napa Valley Cabernet Sauvignon'
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.imageDataUrl).toBe(
      `data:image/png;base64,${Buffer.from(fakePng).toString('base64')}`
    )
  })

  test('attaches thumbnails to alternatives when the match is uncertain', async () => {
    const fakePng = new Uint8Array([1, 2, 3])
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (isVivinoSearchUrl(url)) {
        return Promise.resolve(
          vivinoSearchResponse([
            vivinoHit({
              id: 7,
              image: {
                variations: {
                  label_medium: '//images.vivino.com/thumbs/alt.png'
                }
              },
              name: 'Totally Unrelated Wine',
              vintages: [{ id: 77, statistics: { ratings_count: 10 } }],
              winery: { name: 'Somebody Else' }
            })
          ])
        )
      }
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(fakePng.buffer),
        headers: new Headers({ 'content-type': 'image/png' }),
        ok: true
      } as unknown as Response)
    }

    const result = await fetchRatingFromVivino('Zzz Qqq 1999')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives?.[0].imageDataUrl).toMatch(
      /^data:image\/png;base64,/
    )
  })

  test('skips thumbnail downloads when includeImage is false (list pages)', async () => {
    const imageRequests: string[] = []
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (isVivinoSearchUrl(url)) {
        return Promise.resolve(
          vivinoSearchResponse([
            vivinoHit({
              id: 42,
              image: {
                variations: {
                  label_medium: '//images.vivino.com/thumbs/x.png'
                }
              },
              name: 'Cabernet Sauvignon',
              winery: { name: 'Black Stallion' }
            })
          ])
        )
      }
      imageRequests.push(url)
      return Promise.reject(new Error('unexpected image fetch'))
    }

    const result = await fetchRatingFromVivino(
      'Black Stallion Napa Valley Cabernet Sauvignon',
      false
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.imageDataUrl).toBeUndefined()
    expect(imageRequests).toHaveLength(0)
    // Internal scoring fields must not leak into the response/cache.
    expect(result).not.toHaveProperty('similarityRate')
    expect(result).not.toHaveProperty('wineNameSimilarityRate')
    expect(result).not.toHaveProperty('imageUrl')
    expect(result).not.toHaveProperty('winery')
  })

  test('ignores hidden hits', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            hidden: true,
            name: 'Brut Cuvée',
            winery: { name: 'Barefoot' }
          })
        ])
      )

    const result = await fetchRatingFromVivino('Barefoot Brut Cuvée', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.alternatives).toBeUndefined()
  })

  // Regression: a wine that isn't on Vivino returns same-style,
  // different-producer candidates. Shared style words ("Prosecco Extra Dry",
  // "Blanc de Noirs Brut", "Cava Brut") push the name-similarity over 0.5,
  // but with an unconfirmed winery the result must be Uncertain, not a
  // confidently-wrong Found. Reported cases:
  //   Casteloro …  -> Alberto Nani Organic Prosecco Extra Dry
  //   Noria …      -> Fleury Blanc de Noirs Brut Champagne
  //   El Mar …     -> Mas Fi Cava Brut
  for (const { alt, query, wineName, winery } of [
    {
      alt: 'Alberto Nani Organic Prosecco Extra Dry',
      query: 'Casteloro Prosecco Organic Extra Dry',
      wineName: 'Organic Prosecco Extra Dry',
      winery: 'Alberto Nani'
    },
    {
      alt: 'Fleury Blanc de Noirs Brut Champagne',
      query: 'Noria Blanc de Noirs Brut',
      wineName: 'Blanc de Noirs Brut Champagne',
      winery: 'Fleury'
    },
    {
      alt: 'Mas Fi Cava Brut',
      query: 'El Mar Cava Brut',
      wineName: 'Cava Brut',
      winery: 'Mas Fi'
    },
    {
      alt: 'Cuvage Brut Rosé',
      query: 'Gorgeous Brut Rosé',
      wineName: 'Brut Rosé',
      winery: 'Cuvage'
    }
  ]) {
    test(`is Uncertain when only style words match, not the producer (${winery})`, async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          vivinoSearchResponse([
            vivinoHit({
              id: 99,
              name: wineName,
              statistics: { ratings_average: 4.0, ratings_count: 500 },
              vintages: [{ id: 990, statistics: { ratings_count: 500 } }],
              winery: { name: winery }
            })
          ])
        )

      const result = await fetchRatingFromVivino(query, false)

      expect(result.status).toBe(RatingResultStatus.Uncertain)
      expect(result.link).toContain('vivino.com/search/wines')
      // The wrong wine is still offered as a "did you mean" suggestion,
      // displayed with its producer.
      expect(result.alternatives?.[0].name).toBe(alt)
    })
  }

  test('stays Found when the winery is confirmed by the query', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 55,
            name: 'Bubbly Brut Cuvée',
            statistics: { ratings_average: 3.9, ratings_count: 900 },
            vintages: [{ id: 550, statistics: { ratings_count: 900 } }],
            winery: { name: 'Barefoot' }
          })
        ])
      )

    const result = await fetchRatingFromVivino('Barefoot Brut Cuvée', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.link).toBe('https://www.vivino.com/wines/550')
  })

  // Regression: an any-token winery check would accept "Knight Black Horse"
  // for "Black Knight" (two shared tokens, different producer). Every
  // distinctive winery token must appear in the query.
  test('rejects a winery that only partially overlaps the query', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            name: 'Black Opal Cabernet Sauvignon',
            winery: { name: 'Knight Black Horse' }
          })
        ])
      )

    const result = await fetchRatingFromVivino(
      'Black Knight Cabernet Sauvignon',
      false
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
  })

  // A hit with no winery data can still be accepted when the name alone is
  // exactly the query — but only exactly. A similarity threshold is not
  // enough: compareTwoStrings ignores whitespace, so "Riesling Organic"
  // scores 0.97 against "R Riesling Organic" yet is a different producer's
  // wine.
  test('accepts a winery-less hit only on an exact name', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({ name: 'Black Knight Cabernet Sauvignon' })
        ])
      )

    const exact = await fetchRatingFromVivino(
      'Black Knight Cabernet Sauvignon',
      false
    )
    expect(exact.status).toBe(RatingResultStatus.Found)

    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([vivinoHit({ name: 'Riesling Organic' })])
      )

    const close = await fetchRatingFromVivino('R Riesling Organic', false)
    expect(close.status).toBe(RatingResultStatus.Uncertain)
  })

  // Regression: the confirmed producer must win even when a same-style wine
  // from another producer has the higher name-similarity. Gating only the
  // top-ranked candidate turned "Mionetto Prosecco Brut" into an Uncertain
  // because Masottina's prosecco outscored Mionetto's own.
  test('prefers a confirmed producer over a better-scoring namesake style', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 1,
            name: 'Prosecco Brut',
            vintages: [{ id: 111, statistics: { ratings_count: 4000 } }],
            winery: { name: 'Masottina' }
          }),
          vivinoHit({
            id: 2,
            name: 'Prestige Collection Brut Prosecco Treviso',
            statistics: { ratings_average: 3.8, ratings_count: 31142 },
            vintages: [{ id: 222, statistics: { ratings_count: 31142 } }],
            winery: { name: 'Mionetto' }
          })
        ])
      )

    const result = await fetchRatingFromVivino('Mionetto Prosecco Brut', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe(
      'Mionetto Prestige Collection Brut Prosecco Treviso'
    )
    expect(result.link).toBe('https://www.vivino.com/wines/222')
  })

  // Regression: "Château"/"Bodegas"/"Weingut" are corporate-form words, not
  // brands. They are skipped when confirming the winery, so the remaining
  // token ("Pajzos") decides — and it is not in this query.
  test('does not confirm a winery on a shared corporate-form word', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            name: 'Aszú 5 Puttonyos',
            statistics: { ratings_average: 4.3, ratings_count: 168 },
            winery: { name: 'Château Pajzos' }
          })
        ])
      )

    const result = await fetchRatingFromVivino(
      'Château Dereszla Tokaji Aszù 5 Puttonyos',
      false
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
  })

  // Products whose Systembolaget title omits the producer ("Barbera d'Alba
  // Busije" is by Giacosa Fratelli) can only match on the name itself. An
  // exact name on a distinctive title (few index-wide hits) is accepted, and
  // the comparison must tolerate Vivino's typographic apostrophes.
  test('accepts an exact distinctive name even when the producer is not in the title', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse(
          [
            vivinoHit({
              name: 'Barbera d’Alba Busije',
              statistics: { ratings_average: 3.9, ratings_count: 16073 },
              winery: { name: 'Giacosa Fratelli' }
            })
          ],
          2
        )
      )

    const result = await fetchRatingFromVivino("Barbera d'Alba Busije", false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('Giacosa Fratelli Barbera d’Alba Busije')
  })

  // Regression: an exact name on a GENERIC title is no proof of identity —
  // "Piemonte Barbera" exists verbatim under several producers (1714 index
  // hits), and Systembolaget's is not the one Vivino ranks first. Stays
  // Uncertain, with the namesake as a suggestion.
  test('stays Uncertain on an exact name that is common in the index', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse(
          [
            vivinoHit({
              name: 'Piemonte Barbera',
              winery: { name: 'Marco Pontarelli' }
            })
          ],
          1714
        )
      )

    const result = await fetchRatingFromVivino('Piemonte Barbera', false)

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.alternatives?.[0].name).toBe(
      'Marco Pontarelli Piemonte Barbera'
    )
  })

  // Same producer, several cuvées: the wine whose name actually matches must
  // win, not whichever the search ranks first.
  test('picks the matching cuvée among same-producer hits', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 1181471,
            name: 'Coto Mayor Crianza',
            statistics: { ratings_average: 3.7, ratings_count: 9940 },
            vintages: [{ id: 111, statistics: { ratings_count: 9940 } }],
            winery: { name: 'El Coto' }
          }),
          vivinoHit({
            id: 8619,
            name: 'Crianza',
            statistics: { ratings_average: 3.6, ratings_count: 76089 },
            vintages: [{ id: 222, statistics: { ratings_count: 76089 } }],
            winery: { name: 'El Coto' }
          })
        ])
      )

    const result = await fetchRatingFromVivino('El Coto Crianza', false)

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('El Coto Crianza')
    expect(result.link).toBe('https://www.vivino.com/wines/222')
  })

  // Regression (Systembolaget 5234001 "Mucho Mas"): the title is nothing but
  // the brand, and an unrelated Chilean winery is literally called "Mucho
  // Mas" — so its wines pass the winery check on a title that says nothing
  // about the producer, while the wine actually on the shelf (Félix Solís'
  // "Mucho Más Tinto", 15k+ ratings) fails it *and* the 0.5 name threshold,
  // because the producer we prefix onto its name is absent from the title.
  // Systembolaget names the producer on the page; that is what settles it.
  test('matches a brand-only title through the producer on the page', async () => {
    const hits = [
      vivinoHit({
        id: 5798850,
        name: 'Mucho Mas Merlot',
        statistics: { ratings_average: 3.3, ratings_count: 138 },
        vintages: [{ id: 111, statistics: { ratings_count: 138 } }],
        winery: { name: 'Mucho Mas' }
      }),
      vivinoHit({
        id: 12200870,
        name: 'Mucho Mas Gold',
        statistics: { ratings_average: 3.9, ratings_count: 402 },
        vintages: [{ id: 222, statistics: { ratings_count: 402 } }],
        winery: { name: 'Félix Solís' }
      }),
      vivinoHit({
        id: 6266660,
        name: 'Mucho Más Tinto',
        statistics: { ratings_average: 3.8, ratings_count: 15500 },
        vintages: [{ id: 154917912, statistics: { ratings_count: 15500 } }],
        winery: { name: 'Félix Solís' }
      })
    ]
    globalThis.fetch = () => Promise.resolve(vivinoSearchResponse(hits, 240))

    // Without the producer nothing in the title separates the three, and the
    // namesake winery wins on name-similarity alone.
    const blind = await fetchRatingFromVivino('Mucho Mas', false)
    expect(blind.name).toBe('Mucho Mas Merlot')

    // Systembolaget spells it without the accents Vivino uses, and adds the
    // company form — neither may cost the match.
    const result = await fetchRatingFromVivino(
      'Mucho Mas',
      false,
      'Felix Solis Avantis'
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.name).toBe('Félix Solís Mucho Más Tinto')
    expect(result.link).toBe('https://www.vivino.com/wines/154917912')
  })

  // A producer confirms who made the wine, not which of their wines it is:
  // "Gold" is a word the Systembolaget title never mentions, while "Tinto" is
  // a colour the title is free to leave out.
  test('does not let the producer pull in a line extension', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        vivinoSearchResponse([
          vivinoHit({
            id: 9240299,
            name: 'Mucho Más Tinto - Black Edition',
            statistics: { ratings_average: 4.0, ratings_count: 900 },
            vintages: [{ id: 333, statistics: { ratings_count: 900 } }],
            winery: { name: 'Félix Solís' }
          }),
          vivinoHit({
            id: 5722875,
            name: 'Mucho Más Blanco',
            statistics: { ratings_average: 3.7, ratings_count: 4000 },
            vintages: [{ id: 444, statistics: { ratings_count: 4000 } }],
            winery: { name: 'Félix Solís' }
          })
        ])
      )

    const result = await fetchRatingFromVivino(
      'Mucho Mas Blanco',
      false,
      'Felix Solis Avantis'
    )

    expect(result.name).toBe('Félix Solís Mucho Más Blanco')
  })

  test('returns no alternatives when the search has no hits', async () => {
    globalThis.fetch = () => Promise.resolve(vivinoSearchResponse([]))

    const result = await fetchRatingFromVivino('Torre do Olivar')

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.alternatives).toBeUndefined()
  })
})

test.describe('Untappd lookup misses (mocked fetch)', () => {
  const realFetch = globalThis.fetch

  test.afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('returns ranked alternatives when no Untappd match is confident enough', async () => {
    const untappdHit = (
      bid: number,
      name: string,
      rating: number,
      votes: number
    ) => ({
      beer_name: name,
      beer_slug: `slug-${bid.toString()}`,
      bid,
      brewery_beer_name: `Brygghus ${name}`,
      brewery_name: 'Brygghus',
      rating_count: votes,
      rating_score: rating
    })

    globalThis.fetch = () =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            hits: [
              // Similarities to the query (all below the 0.2 threshold):
              // 0.171, 0.194, 0.176, 0.118 — so no auto-accept, and the
              // ranked alternatives start with Sommarlager.
              untappdHit(1, 'Lagerhaus Dunkel', 3.2, 40),
              untappdHit(2, 'Sommarlager', 3.9, 200),
              untappdHit(3, 'Pilsner Urquell', 3.5, 90),
              untappdHit(4, 'Citra Hazy Juice', 3.1, 10)
            ]
          }),
        ok: true
      } as Response)

    const result = await fetchRatingFromUntappd(
      'Mystery Brew IPA',
      searchConfig
    )

    expect(result.status).toBe(RatingResultStatus.Uncertain)
    expect(result.link).toContain('untappd.com/search')
    expect(result.alternatives).toHaveLength(3)
    expect(result.alternatives?.[0].name).toBe('Sommarlager')
    expect(result.alternatives?.[0].link).toBe('https://untappd.com/b/slug-2/2')
  })
})
