import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import { ProductType, RatingResultStatus } from '@/@types/types'

import {
  fetchSpiritRating,
  matchSpirit,
  parseConnosrSitemap,
  parseRating,
  parseRumxSitemap,
  type SpiritEntry,
  words
} from './spirits'

// Names as the two sitemaps spell them (October 2026), including the near
// misses that a looser rule matched to the wrong bottle.
const rumx = [
  'afd-ron-barcelo-gran-anejo',
  'bacardi-carta-blanca',
  'bacardi-carta-fuego-superior-spiced-rum',
  'bardinet-rhum-negrita-dark-signature',
  'diplomatico-mantuano',
  'diplomatico-reserva-exclusiva',
  'diplomatico-single-vintage',
  'havana-club-anejo-3-anos',
  'pernod-havana-club-rum-anejo-3-anos',
  'ron-zacapa-reserva-limitada',
  'ron-zacapa-la-armonia-the-harmony-cask',
  'west-indies-planteray-extra-old-xo-20th-anniversary'
].map((slug, i) => ({
  name: slug.replace(/-/g, ' '),
  url: `https://rumx.com/en/rums/${String(i + 1)}/${slug}/`
}))
// A second Bacardi Carta Blanca record: RumX lists some rums twice.
rumx.push({
  name: 'bacardi carta blanca',
  url: 'https://rumx.com/en/rums/301/bacardi-carta-blanca/'
})

const connosr: SpiritEntry[] = [
  'glenmorangie-10-year-old',
  'glenmorangie-12-year-old-ch-de-meursault',
  'highland-park-12-year-old',
  'highland-park-12-year-old-old-label',
  'jameson',
  'jameson-12-year-old-special-reserve',
  'jim-beam-devils-cut-bourbon',
  'johnnie-walker-red-label',
  'johnnie-walker-red-label-15l',
  'laphroaig-10-year-old',
  'laphroaig-10-year-old-bottled-1970s',
  'loch-lomond-original'
].map((slug, i) => ({
  name: slug.replace(/-/g, ' '),
  url: `https://www.connosr.com/${slug}-whisky-reviews-${String(i + 1)}`
}))

const found = (match: ReturnType<typeof matchSpirit>) =>
  match.status === 'found'
    ? match.urls.map((url) => /\/([^/]+)\/?$/.exec(url)?.[1])
    : match.status

describe('matching a spirit by name', () => {
  it('finds the bottle Systembolaget names', () => {
    expect(
      found(matchSpirit('Diplomático', 'Diplomático Reserva Exclusiva', rumx))
    ).toEqual(['diplomatico-reserva-exclusiva'])
    expect(
      found(matchSpirit('Highland Park', 'Highland Park 12 Years', connosr))
    ).toEqual(['highland-park-12-year-old-whisky-reviews-3'])
    expect(found(matchSpirit('Jameson', 'Jameson', connosr))).toEqual([
      'jameson-whisky-reviews-5'
    ])
  })

  // RumX prefixes some names with the producer's: "afd ron barcelo …".
  it('lets a producer name stand before the brand', () => {
    expect(found(matchSpirit('Barceló', 'Barceló Gran Añejo', rumx))).toEqual([
      'afd-ron-barcelo-gran-anejo'
    ])
  })

  // "12 Years" must never be the 10 or the 18.
  it('requires the same age', () => {
    expect(
      matchSpirit('Glenmorangie', 'Glenmorangie 12 Years', connosr)
    ).toEqual({ status: 'uncertain' })
    expect(
      found(matchSpirit('Laphroaig', 'Laphroaig 10 Years', connosr))
    ).toEqual(['laphroaig-10-year-old-whisky-reviews-10'])
  })

  // Each of these matched the wrong bottle under a looser rule.
  it('does not match a different expression of the brand', () => {
    for (const [brand, title, entries] of [
      ['Ron Zacapa', 'Ron Zacapa Gran Reserva', rumx],
      ['Jim Beam', 'Jim Beam Bourbon', connosr],
      ['Loch Lomond Single Malt', 'Loch Lomond Single Malt Kombipack', connosr]
    ] as const) {
      expect(matchSpirit(brand, title, entries).status, title).toBe('uncertain')
    }
  })

  it('does not match a special edition the title does not name', () => {
    expect(
      found(matchSpirit('Johnnie Walker', 'Johnnie Walker Red Label', connosr))
    ).toEqual(['johnnie-walker-red-label-whisky-reviews-8'])
  })

  // One rum listed twice, once with its producer's name in front: the same
  // product — both pages are read and the better-rated record wins.
  it('treats records that differ only in a producer prefix as one', () => {
    expect(
      found(matchSpirit('Havana Club', 'Havana Club Añejo 3 Años', rumx))
    ).toEqual([
      'havana-club-anejo-3-anos',
      'pernod-havana-club-rum-anejo-3-anos'
    ])
    expect(
      found(matchSpirit('Bacardi', 'Bacardi Carta Blanca', rumx))
    ).toHaveLength(2)
  })

  it('is not found when the site has no such brand', () => {
    expect(matchSpirit('Silent Shade', 'Silent Shade Dark Rum', rumx)).toEqual({
      status: 'notFound'
    })
  })
})

describe('words a name is matched on', () => {
  it('writes ages one way and drops filler and accents', () => {
    expect(words('Glengoyne Single Malt 16 Years Old')).toEqual([
      'glengoyne',
      '16yo'
    ])
    expect(words('glengoyne 16 year old')).toEqual(['glengoyne', '16yo'])
    expect(words('Havana Club Añejo 3 Años')).toEqual([
      'havana',
      'club',
      'anejo',
      '3yo'
    ])
    expect(words("Jack Daniel's")).toEqual(['jack', 'daniels'])
  })
})

describe('reading the sites', () => {
  it('reads product names out of the sitemaps', () => {
    expect(
      parseRumxSitemap(
        '<urlset><url><loc>https://rumx.com/en/rums/3/diplomatico-reserva-exclusiva/</loc></url><url><loc>https://rumx.com/en/distilleries/x/</loc></url></urlset>'
      )
    ).toEqual([
      {
        name: 'diplomatico reserva exclusiva',
        url: 'https://rumx.com/en/rums/3/diplomatico-reserva-exclusiva/'
      }
    ])
    expect(
      parseConnosrSitemap(
        '<urlset><url><loc>https://www.connosr.com/lagavulin-16-year-old-whisky-reviews-147</loc></url><url><loc>https://www.connosr.com/jameson-whiskey-reviews-879</loc></url></urlset>'
      ).map((entry) => entry.name)
    ).toEqual(['lagavulin 16 year old', 'jameson'])
  })

  it('reads the rating out of a product page', () => {
    const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Lagavulin 16 Year Old",
      "aggregateRating":{"@type":"AggregateRating","worstRating":"1","bestRating":"100","reviewCount":"88","ratingCount":"475","ratingValue":"89.62"}}</script></html>`
    expect(parseRating(html)).toEqual({
      name: 'Lagavulin 16 Year Old',
      rating: 89.62,
      scale: 100,
      votes: 475
    })
    expect(parseRating('<html>no rating</html>')).toBeNull()
  })

  // RumX nests its Product in a "@graph".
  it('reads a rating nested in a graph', () => {
    const html = `<script type=application/ld+json>{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":["Product"],"name":"Diplomático Reserva Exclusiva","aggregateRating":{"@type":"AggregateRating","ratingValue":"7.4","bestRating":"10.0","worstRating":"0.1","ratingCount":1584}}]}</script>`
    expect(parseRating(html)).toEqual({
      name: 'Diplomático Reserva Exclusiva',
      rating: 7.4,
      scale: 10,
      votes: 1584
    })
  })
})

describe('looking up a spirit', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  const sitemap = `<urlset>${[
    'https://rumx.com/en/rums/12432/bacardi-carta-blanca/',
    'https://rumx.com/en/rums/301/bacardi-carta-blanca/',
    'https://rumx.com/en/rums/3/diplomatico-reserva-exclusiva/'
  ]
    .map((url) => `<url><loc>${url}</loc></url>`)
    .join('')}</urlset>`
  const page = (name: string, rating: string, votes: string) =>
    `<script type="application/ld+json">{"@type":"Product","name":"${name}","aggregateRating":{"ratingValue":"${rating}","bestRating":"10.0","ratingCount":${votes}}}</script>`

  it('reads the matched page, and keeps the sitemap for later lookups', async () => {
    const fetchText = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('sitemap-rums.xml')
          ? sitemap
          : page('Diplomático Reserva Exclusiva', '7.4', '1584')
      )
    )

    const rating = await fetchSpiritRating(
      ProductType.Rum,
      'Diplomático Reserva Exclusiva',
      'Diplomático',
      fetchText
    )
    expect(rating).toMatchObject({
      link: 'https://rumx.com/en/rums/3/diplomatico-reserva-exclusiva/',
      rating: 7.4,
      scale: 10,
      status: RatingResultStatus.Found,
      votes: 1584
    })

    await fetchSpiritRating(
      ProductType.Rum,
      'Diplomático Reserva Exclusiva',
      'Diplomático',
      fetchText
    )
    // The sitemap once; the product page per lookup.
    expect(
      fetchText.mock.calls.filter(([url]) => url.endsWith('.xml'))
    ).toHaveLength(1)
  })

  it('takes the better-rated of two records with one name', async () => {
    const fetchText = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('.xml')
          ? sitemap
          : url.includes('/301/')
            ? page('Bacardi Carta Blanca', '4.1', '2600')
            : page('Bacardi Carta Blanca', '4.3', '40')
      )
    )
    const rating = await fetchSpiritRating(
      ProductType.Rum,
      'Bacardi Carta Blanca',
      'Bacardi',
      fetchText
    )
    expect(rating).toMatchObject({ rating: 4.1, votes: 2600 })
  })

  // A sitemap or page that cannot be read is a failure to retry, not "no
  // rating": it must not be cached.
  it('reports a failed read as transient', async () => {
    const rating = await fetchSpiritRating(
      ProductType.Rum,
      'Diplomático Reserva Exclusiva',
      'Diplomático',
      () => Promise.resolve(null)
    )
    expect(rating.transient).toBe(true)
  })
})
