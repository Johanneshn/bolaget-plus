import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'

import {
  fetchAllProducts,
  findListSearch,
  rankTopList,
  tastedWinesOf,
  toTopListProduct
} from './topList'

const searchHit = {
  categoryLevel1: 'Vin',
  country: 'Italien',
  packagingLevel1: 'Glasflaska',
  price: 149.9,
  producerName: 'Cantina Birgi',
  productNameBold: 'Crudo',
  productNameThin: 'Nerello Mascalese Frappato',
  productNumber: '262708',
  vintage: '2025',
  volume: 750
}

describe('reading a search hit', () => {
  it('builds the same query a card would, without the vintage', () => {
    const product = toTopListProduct(searchHit)
    expect(product).toMatchObject({
      facts: { country: 'it', producer: 'Cantina Birgi' },
      isBottle: true,
      name: 'Crudo Nerello Mascalese Frappato',
      productId: '262708',
      type: ProductType.Wine,
      url: 'https://www.systembolaget.se/produkt/vin/crudo-262708/'
    })
  })

  it('flags boxes and skips kinds without ratings', () => {
    expect(
      toTopListProduct({ ...searchHit, packagingLevel1: 'Box' })?.isBottle
    ).toBe(false)
    expect(toTopListProduct({ ...searchHit, categoryLevel1: 'Sprit' })).toBe(
      null
    )
    expect(
      toTopListProduct({ ...searchHit, categoryLevel1: 'Öl' })?.url
    ).toContain('/produkt/ol/')
  })
})

describe('ranking', () => {
  const product = toTopListProduct(searchHit)
  if (!product) throw new Error('fixture must parse')
  const found = (rating: number, votes: number): RatingResponse => ({
    link: null,
    name: null,
    rating,
    status: RatingResultStatus.Found,
    votes
  })

  it('ranks by rating, breaks ties on votes, and drops unrated', () => {
    const ranked = rankTopList(
      [
        found(4.1, 20),
        found(4.3, 10),
        found(4.1, 900),
        found(0, 5),
        { ...found(4.9, 50), status: RatingResultStatus.Uncertain }
      ].map((rating, i) => ({
        product: { ...product, productId: String(i) },
        rating
      }))
    )
    expect(ranked.map(({ rating }) => rating.votes)).toEqual([10, 900, 20])
  })

  it('lists a wine once, in the size closest to a bottle', () => {
    const half = { ...product, productId: '1', volumeMl: 375 }
    const bottle = { ...product, productId: '2', volumeMl: 750 }
    const rating = { ...found(4.3, 100), link: 'https://www.vivino.com/w/1' }
    const ranked = rankTopList([
      { product: half, rating },
      { product: bottle, rating }
    ])
    expect(ranked.map(({ product }) => product.productId)).toEqual(['2'])
  })

  it('counts a wine as tasted in every size', () => {
    const link = 'https://www.vivino.com/w/1'
    const entries = [
      {
        product: { ...product, productId: '1', volumeMl: 750 },
        rating: { ...found(4.5, 10), link },
        tasted: true
      },
      {
        product: { ...product, productId: '2', volumeMl: 375 },
        rating: { ...found(4.5, 10), link }
      }
    ]
    expect(rankTopList(entries, { hideTasted: true })).toEqual([])
    expect(rankTopList(entries)[0].tasted).toBe(true)
  })

  it('leaves tasted ones out when asked to', () => {
    const entries = [
      {
        product: { ...product, productId: '1' },
        rating: found(4.5, 10),
        tasted: true
      },
      { product: { ...product, productId: '2' }, rating: found(4.0, 10) }
    ]
    expect(rankTopList(entries)).toHaveLength(2)
    expect(
      rankTopList(entries, { hideTasted: true }).map(
        ({ product }) => product.productId
      )
    ).toEqual(['2'])
  })
})

describe('ranking at the printed precision', () => {
  const beer = toTopListProduct({ ...searchHit, categoryLevel1: 'Öl' })
  if (!beer) throw new Error('fixture must parse')
  const found = (rating: number, votes: number): RatingResponse => ({
    link: `https://untappd.com/b/${String(rating)}`,
    name: null,
    rating,
    status: RatingResultStatus.Found,
    votes
  })

  it('puts an Untappd 3,5 above a 3,46 with more votes', () => {
    const ranked = rankTopList([
      { product: { ...beer, productId: '1' }, rating: found(3.46, 76_000) },
      { product: { ...beer, productId: '2' }, rating: found(3.5, 71_000) }
    ])
    expect(ranked.map((entry) => entry.rating.rating)).toEqual([3.5, 3.46])
  })
})

describe('the bottle thumbnail', () => {
  it("is the one the site's own cards load", () => {
    const product = toTopListProduct({
      ...searchHit,
      images: [
        {
          imageUrl:
            'https://product-cdn.systembolaget.se/productimages/63436468/63436468'
        }
      ]
    })
    expect(product?.imageUrl).toBe(
      'https://www.systembolaget.se/_next/image/?url=https%3A%2F%2Fproduct-cdn.systembolaget.se%2Fproductimages%2F63436468%2F63436468_100.webp&w=64&q=75'
    )
    expect(toTopListProduct(searchHit)?.imageUrl).toBeUndefined()
  })
})

describe('tasted wines', () => {
  const product = toTopListProduct(searchHit)
  if (!product) throw new Error('fixture must parse')
  const rating: RatingResponse = {
    link: 'https://www.vivino.com/wines/1',
    name: 'Crudo',
    rating: 4,
    status: RatingResultStatus.Found,
    votes: 100
  }

  // The footnote's "N provade varor är dolda" has to count what the ranking
  // hides: wines, not bottle sizes.
  it('counts a wine tasted in two sizes once', () => {
    const tasted = tastedWinesOf([
      { product, rating, tasted: true },
      {
        product: { ...product, productId: '2', volumeMl: 375 },
        rating,
        tasted: true
      },
      {
        product: { ...product, productId: '3' },
        rating: { ...rating, link: 'https://www.vivino.com/wines/2' }
      }
    ])
    expect(tasted.size).toBe(1)
  })
})

describe('fetching the whole range', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const hit = (id: number) => ({ ...searchHit, productNumber: String(id) })
  const page = (ids: number[], docCount: number, nextPage = -1) =>
    new Response(
      JSON.stringify({
        metadata: { docCount, nextPage },
        products: ids.map(hit)
      })
    )
  const searchUrl =
    'https://api-extern.systembolaget.se/sb-api-ecommerce/v2/productsearch/search?categoryLevel1=Vin'

  // nextPage has been missing or -1 on a page that was not the last; the run
  // must not stop at 30 of 45 and call it the whole range.
  it('pages until the total is reached, whatever nextPage says', async () => {
    const pages = [
      page(
        Array.from({ length: 30 }, (_, i) => i),
        45
      ),
      page(
        Array.from({ length: 15 }, (_, i) => 30 + i),
        45
      )
    ]
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(pages.shift() ?? page([], 45))
    )
    vi.stubGlobal('fetch', fetchMock)

    const found = await fetchAllProducts(searchUrl, { onProgress: vi.fn() })
    expect(found && 'products' in found && found.products).toHaveLength(45)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('looks a product up once when the range shifts it onto the next page', async () => {
    const pages = [page([1, 2, 3], 4), page([3, 4], 4)]
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(pages.shift() ?? page([], 4)))
    )

    const found = await fetchAllProducts(searchUrl, { onProgress: vi.fn() })
    expect(
      found && 'products' in found && found.products.map((p) => p.productId)
    ).toEqual(['1', '2', '3', '4'])
  })

  it('stops after the first page when the range is too long', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(page([1], 5000))
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchAllProducts(searchUrl, { onProgress: vi.fn() })
    ).resolves.toEqual({ tooMany: 5000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops when the user declines a long run', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(page([1], 400)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchAllProducts(searchUrl, {
        confirmTotal: () => Promise.resolve(false),
        onProgress: vi.fn()
      })
    ).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Without "N varor" to match, the newest search may be another list's.
  it('picks no search without a count to tell them apart', async () => {
    await expect(findListSearch(null)).resolves.toBeNull()
  })
})
