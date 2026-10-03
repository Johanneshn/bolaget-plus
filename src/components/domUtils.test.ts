// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import { injectCardSpinner, replaceCardSpinner } from '@/components/domUtils'

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
  // fakeBrowser has no i18n; the message key stands in for the text.
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => key
  )
})

describe('replaceCardSpinner', () => {
  it('shows the score', () => {
    expect(badge(renderCard('203701'), 3.8, 7606)).toBe('3.8')
  })

  it('shows a score of 0 as not rated yet, not as zero', () => {
    // Vivino reports an average of 0 for a wine with too few ratings.
    expect(badge(renderCard('203701'), 0, 24)).toBe('N/A')
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
