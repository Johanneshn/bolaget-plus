import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import {
  clearTasted,
  countTasted,
  exportTasted,
  getTastedSource,
  importTasted,
  importUntappdExport,
  parseUntappdExport,
  setTasted
} from '@/components/tasted'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('parseUntappdExport', () => {
  it('reads beer ids from a JSON export', () => {
    const json = JSON.stringify([
      { beer_name: 'Nordic Unity APA', bid: 6252924 },
      { beer_name: 'Pabst Blue Ribbon', bid: '3092' },
      { beer_name: 'Nordic Unity APA', bid: 6252924 }
    ])
    expect(parseUntappdExport(json)).toEqual([6252924, 3092])
  })

  it('reads beer ids from a CSV export with commas inside quoted names', () => {
    const csv = [
      'beer_name,brewery_name,bid,rating_score',
      '"Hop, Skip & Jump",Some Brewery,111,4',
      'Pabst Blue Ribbon,"Pabst Brewing Company",3092,2.5'
    ].join('\n')
    expect(parseUntappdExport(csv)).toEqual([111, 3092])
  })

  it('finds nothing in a file that is not an Untappd export', () => {
    expect(parseUntappdExport('name,score\nfoo,1')).toEqual([])
    expect(parseUntappdExport('{ not json')).toEqual([])
  })
})

describe('getTastedSource', () => {
  it('reports a product the user marked, until unmarked', async () => {
    await setTasted('203701', true)
    expect(await getTastedSource('203701')).toBe('self')
    expect(await countTasted()).toBe(1)

    await setTasted('203701', false)
    expect(await getTastedSource('203701')).toBeNull()
  })

  it('reports a beer found in the imported Untappd history', async () => {
    await importUntappdExport(JSON.stringify([{ bid: 6252924 }]))

    expect(
      await getTastedSource(
        '3309915',
        'https://untappd.com/b/hop-notch-brewing-nordic-unity-apa/6252924'
      )
    ).toBe('untappd')
    expect(
      await getTastedSource('155315', 'https://untappd.com/b/pabst/3092')
    ).toBeNull()
  })

  it('clears every mark', async () => {
    await setTasted('1', true)
    await setTasted('2', true)
    await clearTasted()
    expect(await countTasted()).toBe(0)
  })
})

describe('exporting and importing tasted marks', () => {
  it('round-trips the marks into another browser, keeping what is there', async () => {
    await setTasted('203701', true)
    await setTasted('7667101', true)
    const file = await exportTasted()

    fakeBrowser.reset()
    await setTasted('155315', true)
    expect(await importTasted(file)).toBe(2)

    expect(await countTasted()).toBe(3)
    expect(await getTastedSource('7667101')).toBe('self')
  })

  it('refuses a file that is not a Bolaget+ export', async () => {
    expect(await importTasted(JSON.stringify([{ bid: 1 }]))).toBe(0)
    expect(await importTasted('not json')).toBe(0)
    expect(await countTasted()).toBe(0)
  })
})
