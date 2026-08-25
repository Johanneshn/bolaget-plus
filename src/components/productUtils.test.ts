// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getCardCountry,
  getCardName,
  getProducer,
  getProductName,
  isCardBottle
} from '@/components/productUtils'

// A list card as Systembolaget renders it: category line, name, subtitle,
// the "Nr {productNumber}" line, then the format/price details.
function renderCard(options: {
  category?: string
  details?: string[]
  productId?: string
  subtitle?: string
  title?: string
}): Element {
  const {
    category = 'Rött vin, Fylligt & Smakrikt',
    details = ['Flaska, 750 ml', '129:00', '172:00 kr/l'],
    productId = '203701',
    subtitle = '2021',
    title = 'Amadio'
  } = options

  const lines = [category, title, subtitle, `Nr ${productId}`, ...details]
  document.body.innerHTML = `
    <a id="tile:${productId}" href="/produkt/vin/amadio-${productId}/">
      ${lines.map((line) => `<p>${line}</p>`).join('')}
    </a>`

  const card = document.querySelector('a')
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

describe('isCardBottle', () => {
  it('accepts a card whose details say nothing about the packaging', () => {
    const card = renderCard({ details: ['750 ml', '129:00'] })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('rejects a bag-in-box card', () => {
    const card = renderCard({ details: ['Bag-in-Box, 3000 ml', '249:00'] })

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it.each(['Box, 3000 ml', 'Burk, 250 ml', 'PET-flaska, 750 ml', 'Fat, 20 l'])(
    'rejects a card packaged as %s',
    (packaging) => {
      const card = renderCard({ details: [packaging, '249:00'] })

      expect(isCardBottle(card, '203701')).toBe(false)
    }
  )

  it('ignores a format word that is part of the product name', () => {
    const card = renderCard({ title: 'Boxwood Petit Verdot' })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('ignores a format word that is only part of a longer word', () => {
    const card = renderCard({ details: ['Flaska, 750 ml', 'Fatlagrat'] })

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('reads the packaging from the embedded page data when present', () => {
    renderPageData([{ packagingLevel1: 'Box', productNumber: '203701' }])
    // Details deliberately look like a bottle — the page data is authoritative.
    const card = renderCard({ details: ['3000 ml', '249:00'] })

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it('does not apply another product’s packaging to this card', () => {
    renderPageData([{ packagingLevel1: 'Box', productNumber: '999999' }])
    const card = renderCard({})

    expect(isCardBottle(card, '203701')).toBe(true)
  })

  it('falls back to the card text when the page data is unparseable', () => {
    const script = document.createElement('script')
    script.id = '__NEXT_DATA__'
    script.textContent = '{ not json'
    document.head.appendChild(script)
    const card = renderCard({ details: ['Box, 3000 ml'] })

    expect(isCardBottle(card, '203701')).toBe(false)
  })

  it('assumes bottle when the product-number line is missing', () => {
    const card = renderCard({ details: ['Box, 3000 ml'], productId: '203701' })
    card.innerHTML = '<p>Amadio</p><p>Box, 3000 ml</p>'

    expect(isCardBottle(card, '203701')).toBe(true)
  })
})

describe('getCardCountry', () => {
  it('reads the country out of a detail line', () => {
    const card = renderCard({
      details: ['Spanien, Kastilien-La Mancha', 'Flaska, 750 ml', '99:00']
    })

    expect(getCardCountry(card, '203701')).toBe('es')
  })

  it('matches the country however the line is punctuated', () => {
    const card = renderCard({
      details: ['Flaska · 750 ml · Sydafrika', '129:00']
    })

    expect(getCardCountry(card, '203701')).toBe('za')
  })

  it('folds the Swedish spelling to the same code as the English one', () => {
    const card = renderCard({ details: ['Österrike', '129:00'] })

    expect(getCardCountry(card, '203701')).toBe('at')
  })

  it('ignores a country word in the wine name', () => {
    // The two lines above the product number are the name and subtitle; a wine
    // called "Chile" is not a country line.
    const card = renderCard({
      details: ['Flaska, 750 ml', '99:00'],
      subtitle: 'Chile',
      title: 'Chile'
    })

    expect(getCardCountry(card, '203701')).toBeNull()
  })

  it('is null when no line names a country it knows', () => {
    const card = renderCard({ details: ['Flaska, 750 ml', '99:00'] })

    expect(getCardCountry(card, '203701')).toBeNull()
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
  it('joins the name and subtitle above the product-number line', () => {
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

  it('drops the category line', () => {
    const card = renderCard({ subtitle: '' })

    expect(getCardName(card)).toBe('Amadio')
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
