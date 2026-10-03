// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { ProductType } from '@/@types/types'
import {
  getCard,
  getCardCountry,
  getCardName,
  getCardPricePerLitre,
  getCardProductId,
  getCardProductType,
  getProducer,
  getProductName,
  getProductVintage,
  isCardBottle
} from '@/components/productUtils'

// A list card as Systembolaget renders it: a tile whose title link carries the
// name for the eye and, for screen readers, the name, subtitle, packaging and
// volume; then the subtitle, the details line and the country.
function renderCard(options: {
  category?: string
  country?: string
  packaging?: null | string
  productId?: string
  subtitle?: string
  title?: string
  volume?: string
}): Element {
  const {
    category = 'Rött vin, Fylligt & Smakrikt',
    country = 'Italien',
    packaging = 'Flaska',
    productId = '203701',
    subtitle = '2021',
    title = 'Amadio',
    volume = '750 ml'
  } = options

  const label = [title, subtitle, packaging, volume].filter(Boolean).join(', ')
  document.body.innerHTML = `
    <div data-slot="product-tile">
      <div data-slot="product-summary-content">
        <p data-slot="product-summary-category">${category}</p>
        <h3 data-slot="product-summary-title">
          <a data-slot="product-tile-action" href="/produkt/vin/amadio-${productId}/">
            <span aria-hidden="true">${title}</span>
            <span class="sr-only">${label}</span>
          </a>
        </h3>
        <p data-slot="product-summary-subtitle">${subtitle}</p>
        <div data-slot="product-summary-metadata">${volume} · 13 % vol. · Nr ${productId}</div>
        <div data-slot="product-summary-country"><p>${country}</p></div>
      </div>
    </div>`

  const card = document.querySelector('[data-slot="product-tile"]')
  if (!card) throw new Error('card not rendered')
  return card
}

function renderPageData(products: object[]): void {
  const script = document.createElement('script')
  script.id = '__NEXT_DATA__'
  script.textContent = JSON.stringify({
    props: { pageProps: { fallback: { '/api/search': { products } } } }
  })
  document.head.appendChild(script)
}

// The same title as a product page renders it: one <h1> holding the name and
// the subtitle that carries the appellation/grape and the vintage. Appended
// rather than assigned so a card and a product page can coexist in one test.
function renderProductPage(title: string, subtitle?: string): void {
  const lines = subtitle === undefined ? [title] : [title, subtitle]
  document.body.insertAdjacentHTML(
    'beforeend',
    `<main><h1>${lines
      .map((line) => `<span>${line}</span>`)
      .join('')}</h1></main>`
  )
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('getCard', () => {
  it('resolves a product link to the tile it sits in', () => {
    const card = renderCard({ productId: '262708' })
    const link = card.querySelector('a')
    if (!link) throw new Error('link not rendered')

    expect(getCard(link)).toBe(card)
    expect(getCardProductId(card)).toBe('262708')
    expect(getCardProductType(card)).toBe(ProductType.Wine)
  })
})

describe('isCardBottle', () => {
  it('accepts a card packaged as a bottle', () => {
    const card = renderCard({ packaging: 'Lättare glasflaska' })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('accepts a card whose label names no packaging', () => {
    const card = renderCard({ packaging: null })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it.each([
    ['Bag-in-Box', '3000 ml'],
    ['Box', '3000 ml'],
    ['Burk', '250 ml'],
    ['PET-flaska', '750 ml'],
    ['Fat', '20 l']
  ])('rejects a card packaged as %s', (packaging, volume) => {
    const card = renderCard({ packaging, volume })

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it('ignores a format word that is part of the product name', () => {
    const card = renderCard({ title: 'Boxwood Petit Verdot' })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('ignores a format word that is only part of a longer word', () => {
    // No packaging in the label, so the segment before the volume is the
    // subtitle.
    const card = renderCard({ packaging: null, subtitle: 'Fatamorgana' })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('reads the packaging from the embedded page data when present', () => {
    renderPageData([{ packagingLevel1: 'Box', productNumber: '203701' }])
    // The label deliberately says bottle — the page data is authoritative.
    const card = renderCard({})

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it('does not apply another product’s packaging to this card', () => {
    renderPageData([{ packagingLevel1: 'Box', productNumber: '999999' }])
    const card = renderCard({})

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('falls back to the card label when the page data is unparseable', () => {
    const script = document.createElement('script')
    script.id = '__NEXT_DATA__'
    script.textContent = '{ not json'
    document.head.appendChild(script)
    const card = renderCard({ packaging: 'Box', volume: '3000 ml' })

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it('assumes bottle when the label does not end in a volume', () => {
    const card = renderCard({ packaging: 'Box', volume: '' })

    expect(isCardBottle(card, '203701')).toBe(true)
  })
})

describe('getCardCountry', () => {
  it('reads the country line', () => {
    const card = renderCard({ country: 'Spanien' })

    expect(getCardCountry(card)).toBe('es')
  })

  it('folds the Swedish spelling to the same code as the English one', () => {
    const card = renderCard({ country: 'Österrike' })

    expect(getCardCountry(card)).toBe('at')
  })

  it('ignores a country word in the wine name', () => {
    const card = renderCard({ subtitle: 'Chile', title: 'Chile' })

    expect(getCardCountry(card)).toBe('it')
  })

  it('is null when the country line names no country it knows', () => {
    const card = renderCard({ country: '' })

    expect(getCardCountry(card)).toBeNull()
  })
})

describe('getCardPricePerLitre', () => {
  function tile(price: string, details: string): Element {
    document.body.innerHTML = `<div data-slot="product-tile"><div data-slot="product-summary-metadata">${details}</div><div data-slot="product-summary-price"><p aria-hidden="true">${price}</p><span>…</span></div></div>`
    const card = document.querySelector('[data-slot="product-tile"]')
    if (!card) throw new Error('tile not rendered')
    return card
  }

  it.each([
    ['149:-', '750 ml · 13 % vol. · Nr 1', 198.67],
    ['29:90', '330 ml · 5 % vol. · Nr 2', 90.61],
    ['249:-', '3 l · 13 % vol. · Nr 3', 83],
    ['1 249:-', '75 cl · 40 % vol. · Nr 4', 1665.33]
  ])('reads %s for %s', (price, details, expected) => {
    expect(getCardPricePerLitre(tile(price, details))).toBeCloseTo(expected, 1)
  })

  it('is null without a price or a volume', () => {
    expect(getCardPricePerLitre(tile('', '750 ml'))).toBeNull()
    expect(getCardPricePerLitre(tile('149:-', 'Nr 1'))).toBeNull()
  })
})

describe('getProducer', () => {
  it('reads the producer the embedded page data names', () => {
    renderPageData([
      {
        packagingLevel1: 'Flaska',
        producerName: 'Felix Solis',
        productNumber: '5234001'
      }
    ])

    expect(getProducer('5234001')).toBe('Felix Solis')
  })

  it('keeps a field a sparser copy of the same product omits', () => {
    renderPageData([
      {
        packagingLevel1: 'Flaska',
        producerName: 'Felix Solis',
        productNumber: '5234001'
      },
      { packagingLevel1: 'Flaska', productNumber: '5234001' }
    ])

    expect(getProducer('5234001')).toBe('Felix Solis')
  })

  it('is null for a product the page data does not cover', () => {
    renderPageData([
      {
        packagingLevel1: 'Flaska',
        producerName: 'Felix Solis',
        productNumber: '5234001'
      }
    ])

    // What an SPA navigation leaves behind: the payload of the page that was
    // loaded first, holding nothing about the product now on screen.
    expect(getProducer('203701')).toBeNull()
  })

  it('is null when the product carries no producer', () => {
    renderPageData([{ packagingLevel1: 'Box', productNumber: '203701' }])

    expect(getProducer('203701')).toBeNull()
  })
})

describe('getCardName', () => {
  it('joins the name and subtitle', () => {
    const card = renderCard({
      subtitle: 'Brunello di Montalcino, 2021',
      title: 'Armatura'
    })

    expect(getCardName(card)).toBe('Armatura Brunello di Montalcino')
  })

  it('drops a subtitle that is nothing but the vintage', () => {
    const card = renderCard({})

    expect(getCardName(card)).toBe('Amadio')
  })

  it('leaves out the category line and the screen-reader label', () => {
    const card = renderCard({ subtitle: '' })

    expect(getCardName(card)).toBe('Amadio')
  })
})

describe('getProductVintage', () => {
  it('reads the vintage at the end of the subtitle', () => {
    renderProductPage('Bread & Butter', 'Pinot Noir, 2024')

    expect(getProductVintage()).toBe('2024')
  })

  it('reads a subtitle that is nothing but the vintage', () => {
    renderProductPage('Amadio', '2021')

    expect(getProductVintage()).toBe('2021')
  })

  it('is null for a wine without a vintage', () => {
    renderProductPage('Jinyu', 'Junmai Ginjo')

    expect(getProductVintage()).toBeNull()
  })
})

describe('getProductName', () => {
  it('joins the name and subtitle, without the vintage', () => {
    renderProductPage('Armatura', 'Brunello di Montalcino, 2021')

    expect(getProductName()).toBe('Armatura Brunello di Montalcino')
  })

  it('drops a subtitle that is nothing but the vintage', () => {
    renderProductPage('Amadio', '2021')

    expect(getProductName()).toBe('Amadio')
  })

  it('returns the name alone when the title has no subtitle', () => {
    renderProductPage('Amadio')

    expect(getProductName()).toBe('Amadio')
  })
})

// The two views share one cache entry (keyed on the product number), so a card
// and the product page it links to must search for the exact same name —
// otherwise the same wine is badged with two different Vivino entries
// depending on where it is read, and on which view fetched first.
describe('the list card and the product page agree', () => {
  it.each([
    ['Armatura', 'Brunello di Montalcino, 2021'],
    ['Amadio', '2021'],
    ['Barone Ricasoli', 'Brolio Chianti Classico, 2021'],
    ['Omnipollo', 'Fatamorgana']
  ])('derives one name for %s', (title, subtitle) => {
    const card = renderCard({ subtitle, title })
    renderProductPage(title, subtitle)

    // Asserted rather than implied: two nulls would satisfy the comparison.
    expect(getCardName(card)).not.toBeNull()
    expect(getCardName(card)).toBe(getProductName())
  })
})
