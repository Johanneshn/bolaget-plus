import { expect, test } from '@playwright/test'

import type { VivinoHit } from '../src/@types/types'

import { RatingResultStatus, UntappdSearchConfig } from '../src/@types/types'
import {
  fetchRatingFromUntappd,
  fetchRatingFromVivino,
  fetchUntappdSearchConfig
} from '../src/components/api'

// These tests query Vivino and Untappd for real, so they fail whenever those
// sites change, rate-limit the runner, or are simply down. That is the point —
// but it also means they are not a signal about this repository, so they live
// in the nightly smoke run rather than in CI. The mocked counterparts that do
// gate CI are in api-matching.spec.ts.

// The credentials Untappd's search page is shipping right now. Reading them
// live is the point: if their markup changes, these tests fail instead of the
// extension silently falling back to a pinned key that may be rotated out.
const liveConfig: UntappdSearchConfig = {
  appId: '9WBO4RQ3HO',
  searchKey: '1d347324d67ec472bb7132c66aead485'
}

test.describe('API Integration Tests', () => {
  test('fetchUntappdSearchConfig reads live credentials from untappd.com', async () => {
    const config = await fetchUntappdSearchConfig()

    expect(config.appId).toMatch(/^[0-9A-Z]{10}$/)
    expect(config.searchKey).toMatch(/^[0-9a-f]{32}$/)
    // Copy them onto the shared object so the lookups below use whatever is
    // live, not a hardcoded pair.
    Object.assign(liveConfig, config)
  })

  test('fetchRatingFromVivino returns data for valid query', async () => {
    const result = await fetchRatingFromVivino('Bread & Butter')

    expect(result).not.toBeNull()
    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.rating).toBeGreaterThan(0)
    expect(result.votes).toBeGreaterThan(0)
    expect(result.link).toContain('vivino.com')
  })

  // Regression: the explore endpoint missed even top-selling wines (its index
  // only covers marketplace listings). The Algolia index must find them.
  test('fetchRatingFromVivino finds a top-selling wine', async () => {
    const result = await fetchRatingFromVivino(
      'Casillero del Diablo Cabernet Sauvignon',
      false
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.votes).toBeGreaterThan(10000)
  })

  // The country filter is only worth anything if Vivino's index actually
  // carries a country, and it is read from whichever of several shapes the
  // index build happens to use. This test is what tells us the assumption
  // still holds — if it fails, the filter has quietly stopped filtering.
  test('the Vivino index carries a country the extension can read', async () => {
    const response = await fetch(
      'https://9takgwjuxl-dsn.algolia.net/1/indexes/WINES_prod/query',
      {
        body: JSON.stringify({
          params: new URLSearchParams({
            hitsPerPage: '1',
            query: 'Casillero del Diablo Cabernet Sauvignon'
          }).toString()
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Algolia-API-Key': '60c11b2f1068885161d95ca068d3a6ae',
          'X-Algolia-Application-Id': '9TAKGWJUXL'
        },
        method: 'POST'
      }
    )
    const data = (await response.json()) as { hits?: VivinoHit[] }
    const hit = data.hits?.[0]

    expect(hit).toBeDefined()
    // Chile, whichever way this build of the index spells it.
    const raw =
      hit?.region?.country ?? hit?.region?.country_code ?? hit?.country
    expect(raw, `no country on the hit: ${JSON.stringify(hit)}`).toBeDefined()
  })

  // The country of a Chilean wine must rule out a Spanish product, and the
  // filter must not throw away the wine that is genuinely from there.
  test('the live country filter keeps the right wine and drops the wrong one', async () => {
    const right = await fetchRatingFromVivino(
      'Casillero del Diablo Cabernet Sauvignon',
      false,
      { country: 'cl' }
    )
    expect(right.status).toBe(RatingResultStatus.Found)

    const wrong = await fetchRatingFromVivino(
      'Casillero del Diablo Cabernet Sauvignon',
      false,
      { country: 'se' }
    )
    expect(wrong.status).toBe(RatingResultStatus.Uncertain)
  })

  test('fetchRatingFromUntappd returns data for valid query', async () => {
    const result = await fetchRatingFromUntappd('Pabst Blue Ribbon', liveConfig)

    expect(result).not.toBeNull()
    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.rating).toBeGreaterThan(0)
    expect(result.votes).toBeGreaterThan(0)
    expect(result.link).toContain('untappd.com')
  })

  // Issue #85: a collaboration's Systembolaget title names both breweries,
  // while Untappd indexes the beer under one ("Nordic Unity APA", Hop Notch).
  test('fetchRatingFromUntappd finds a collaboration titled with both breweries', async () => {
    const result = await fetchRatingFromUntappd(
      'Hop Notch x Fat Lizard Nordic Unity',
      liveConfig
    )

    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.link).toContain('/6252924')
  })

  test('fetchRatingFromUntappd returns data for a cider query', async () => {
    const result = await fetchRatingFromUntappd('Rekorderlig Päron', liveConfig)

    expect(result).not.toBeNull()
    expect(result.status).toBe(RatingResultStatus.Found)
    expect(result.rating).toBeGreaterThan(0)
    expect(result.votes).toBeGreaterThan(0)
    expect(result.link).toContain('untappd.com')
  })
})
