// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import {
  applyListView,
  ensureListControls,
  injectCardSpinner,
  replaceCardSpinner,
  setRating,
  setUncertain
} from '@/components/domUtils'

function badge(card: Element, rating: number, votes: number): string {
  const spinner = injectCardSpinner(card, '203701')
  if (!spinner) throw new Error('spinner not injected')
  replaceCardSpinner(card, spinner, '203701', ProductType.Wine, {
    link: 'https://www.vivino.com/w/1',
    rating,
    status: RatingResultStatus.Found,
    votes
  } as RatingResponse)
  return card.querySelector('.bp-card-score')?.textContent ?? ''
}

function renderCard(productId: string): Element {
  document.body.innerHTML = `
    <div data-slot="product-tile">
      <h3 data-slot="product-summary-title">
        <a data-slot="product-tile-action" href="/produkt/vin/amadio-${productId}/">Amadio</a>
      </h3>
      <div data-slot="product-summary-metadata">750 ml · 13 % vol. · Nr ${productId}</div>
    </div>`
  const card = document.querySelector('[data-slot="product-tile"]')
  if (!card) throw new Error('card not rendered')
  return card
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('replaceCardSpinner', () => {
  it('shows the score', () => {
    expect(badge(renderCard('203701'), 3.8, 7606)).toBe('3,8')
  })

  it('writes numbers the way the Swedish page does', () => {
    const card = renderCard('203701')
    badge(card, 4, 98172)

    expect(card.querySelector('.bp-card-score')?.textContent).toBe('4,0')
    expect(card.querySelector('.bp-card-votes')?.textContent).toBe(
      '(98\u00a0172)'
    )
  })

  it('labels the badge for screen readers', () => {
    const card = renderCard('203701')
    badge(card, 4.1, 812)

    expect(
      card.querySelector('.bp-card-rating')?.getAttribute('aria-label')
    ).toBe('4,1 av 5, 812 röster')
  })

  it('shows a score of 0 as not rated yet, not as zero', () => {
    // Vivino reports an average of 0 for a wine with too few ratings.
    expect(badge(renderCard('203701'), 0, 24)).toBe('–')
  })

  it('does not badge a tile that has moved on to another product', () => {
    const card = renderCard('203701')
    const spinner = injectCardSpinner(card, '203701')
    if (!spinner) throw new Error('spinner not injected')
    card.querySelector('a')?.setAttribute('href', '/produkt/vin/other-999999/')

    replaceCardSpinner(card, spinner, '203701', ProductType.Wine, {
      link: null,
      rating: 3.8,
      status: RatingResultStatus.Found,
      votes: 10
    } as RatingResponse)

    expect(card.querySelector('.bp-card-rating')).toBeNull()
  })
})

describe('setRating', () => {
  function renderProductPage(): void {
    document.body.innerHTML =
      '<main><h1><span>Bread & Butter</span></h1></main>'
  }

  const rating = {
    link: 'https://www.vivino.com/wines/1',
    name: 'Bread & Butter Pinot Noir',
    rating: 4,
    status: RatingResultStatus.Found,
    vintages: [
      { id: 25, rating: 0, votes: 4, year: '2025' },
      { id: 24, rating: 3.9, votes: 846, year: '2024' }
    ],
    votes: 98172
  } as RatingResponse

  it('shows the rating of the vintage on the shelf', () => {
    renderProductPage()
    setRating(ProductType.Wine, rating, rating.link, '2024')

    const line = document.querySelector<HTMLAnchorElement>('.bp-vintage')
    expect(line?.textContent).toBe('Årgång 2024: 3,9 (846 röster)')
    expect(line?.href).toBe('https://www.vivino.com/wines/24')
  })

  it('says so when the vintage has too few ratings', () => {
    renderProductPage()
    setRating(ProductType.Wine, rating, rating.link, '2025')

    expect(document.querySelector('.bp-vintage')?.textContent).toBe(
      'Årgång 2025: Inte tillräckligt många betyg än'
    )
  })

  it('shows no vintage line for a vintage Vivino does not list', () => {
    renderProductPage()
    setRating(ProductType.Wine, rating, rating.link, '2019')

    expect(document.querySelector('.bp-vintage')).toBeNull()
  })
})

describe('correcting a match', () => {
  function renderProductPage(): void {
    document.body.innerHTML = '<main><h1><span>Amadio</span></h1></main>'
  }

  const runnerUp = {
    link: 'https://www.vivino.com/wines/2',
    name: 'The Right Wine',
    rating: 3.7,
    votes: 55
  }

  it('offers the runners-up behind a folded "wrong match" toggle', () => {
    renderProductPage()
    const chosen: unknown[] = []
    setRating(
      ProductType.Wine,
      {
        alternatives: [runnerUp],
        link: 'https://www.vivino.com/wines/1',
        name: 'Amadio',
        rating: 4,
        status: RatingResultStatus.Found,
        votes: 10
      },
      null,
      null,
      { onChoose: (pick) => chosen.push(pick) }
    )

    const list = document.querySelector<HTMLElement>(
      '.bp-correction .bp-alt-list'
    )
    expect(list?.hidden).toBe(true)
    document
      .querySelector<HTMLButtonElement>('.bp-correction > button')
      ?.click()
    expect(list?.hidden).toBe(false)

    document.querySelector<HTMLButtonElement>('.bp-choose')?.click()
    expect(chosen).toEqual([runnerUp])
  })

  it('lets the user undo a pick', () => {
    renderProductPage()
    let undone = false
    setRating(
      ProductType.Wine,
      { ...runnerUp, pinned: true, status: RatingResultStatus.Found },
      runnerUp.link,
      null,
      { onUndo: () => (undone = true) }
    )

    expect(document.querySelector('.bp-correction')?.textContent).toBe(
      'Ditt val · Ångra'
    )
    document.querySelector<HTMLButtonElement>('.bp-correction button')?.click()
    expect(undone).toBe(true)
  })

  it('lets the user pick an alternative when the match is uncertain', () => {
    renderProductPage()
    const chosen: unknown[] = []
    setUncertain(
      ProductType.Wine,
      {
        alternatives: [runnerUp],
        link: 'https://www.vivino.com/search/wines?q=amadio',
        name: null,
        rating: 0,
        status: RatingResultStatus.Uncertain,
        votes: 0
      },
      (pick) => chosen.push(pick)
    )

    document.querySelector<HTMLButtonElement>('.bp-choose')?.click()
    expect(chosen).toEqual([runnerUp])
  })
})

describe('sorting and filtering a result list', () => {
  function renderList(ratings: (null | number)[]): HTMLUListElement {
    document.body.innerHTML = `<ul>${ratings
      .map(
        (rating, index) =>
          `<li id="item-${index.toString()}"><div data-slot="product-tile"${
            rating === null ? '' : ` data-bp-rating="${rating.toString()}"`
          }></div></li>`
      )
      .join('')}</ul>`
    const list = document.querySelector('ul')
    if (!list) throw new Error('list not rendered')
    return list
  }

  function item(index: number): HTMLElement {
    const element = document.getElementById(`item-${index.toString()}`)
    if (!element) throw new Error('item not rendered')
    return element
  }

  it('hides rated cards below the minimum but never unrated ones', () => {
    const list = renderList([4.2, 3.4, null, 3.6])
    applyListView(list, { minRating: 3.5, sortByRating: false })

    expect(item(0).style.display).toBe('')
    expect(item(1).style.display).toBe('none')
    expect(item(2).style.display).toBe('')
    expect(item(3).style.display).toBe('')
  })

  it('orders rated cards best first and leaves unrated ones after them', () => {
    const list = renderList([3.6, null, 4.2])
    applyListView(list, { minRating: 0, sortByRating: true })

    expect(Number(item(2).style.order)).toBeLessThan(
      Number(item(0).style.order)
    )
    expect(item(1).style.order).toBe('')
  })

  it('hands the list back unchanged when both are turned off', () => {
    const list = renderList([3.4, 4.2])
    applyListView(list, { minRating: 4, sortByRating: true })
    applyListView(list, { minRating: 0, sortByRating: false })

    expect(item(0).hasAttribute('style')).toBe(false)
    expect(item(1).hasAttribute('style')).toBe(false)
  })

  it('reports the chosen minimum and sort from its controls', () => {
    const list = renderList([4.2])
    const changes: unknown[] = []
    ensureListControls(list, { minRating: 0, sortByRating: false }, (view) =>
      changes.push(view)
    )

    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('.bp-sort button')
    ]
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Alla',
      '3,5+',
      '4,0+',
      'Sortera på betyg'
    ])
    buttons[2].click()
    buttons[3].click()
    expect(changes).toEqual([
      { minRating: 4, sortByRating: false },
      { minRating: 0, sortByRating: true }
    ])
  })
})
