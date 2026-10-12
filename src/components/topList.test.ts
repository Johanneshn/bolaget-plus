import { describe, expect, it } from 'vitest'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'

import { rankTopList, toTopListProduct } from './topList'

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
