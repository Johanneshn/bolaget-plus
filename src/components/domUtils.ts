import { i18n } from '#i18n'

import {
  BeerResponse,
  ProductType,
  RatingAlternative,
  RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import { getCardProductId } from '@/components/productUtils'

const RATING_CONTAINER_ID = 'rating-container'
const RATING_CONTAINER_BODY_ID = 'rating-container-body'
const STYLE_ID = 'bolaget-plus-css'

// The rating section borrows Systembolaget's own design tokens (with
// fallbacks for when a redesign renames them) so it reads as part of the
// product page: a flat block between hairlines, labelled like the page's own
// "FYLLIGHET"-style headings, rather than a branded widget on top of it.
const FG = 'var(--foreground, #262626)'
const MUTED_FG = 'var(--muted-foreground, #262626b3)'
const BORDER = 'var(--border, #2626261a)'
const MUTED_BG = 'var(--muted, #2626260d)'

const STYLES = `
  #${RATING_CONTAINER_ID} {
    margin: 16px 0;
    padding: 12px 0;
    border-top: 1px solid ${BORDER};
    border-bottom: 1px solid ${BORDER};
    font-family: inherit;
    font-size: 14px;
    color: ${FG};
  }
  #${RATING_CONTAINER_ID} .bp-header {
    margin-bottom: 8px;
    font-family: var(--font-bolaget-medium-condensed, inherit);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${MUTED_FG};
  }
  #${RATING_CONTAINER_ID} .bp-rating-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #${RATING_CONTAINER_ID} .bp-score {
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
  }
  #${RATING_CONTAINER_ID} .bp-scale {
    color: ${MUTED_FG};
    font-size: 13px;
  }
  #${RATING_CONTAINER_ID} .bp-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  #${RATING_CONTAINER_ID} .bp-meta {
    color: ${MUTED_FG};
    font-size: 13px;
    line-height: 1.4;
  }
  #${RATING_CONTAINER_ID} .bp-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: ${FG};
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }
  #${RATING_CONTAINER_ID} .bp-link:hover {
    text-decoration-thickness: 2px;
  }
  #${RATING_CONTAINER_ID} .bp-message {
    color: ${MUTED_FG};
  }
  #${RATING_CONTAINER_ID} .bp-alt-list {
    display: flex;
    flex-direction: column;
    margin-top: 6px;
  }
  #${RATING_CONTAINER_ID} .bp-alt-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 44px;
    padding: 6px 8px;
    border-top: 1px solid ${BORDER};
    color: ${FG};
    text-decoration: none;
  }
  #${RATING_CONTAINER_ID} .bp-alt-item:hover,
  #${RATING_CONTAINER_ID} .bp-alt-item:active {
    background: ${MUTED_BG};
  }
  #${RATING_CONTAINER_ID} .bp-alt-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  #${RATING_CONTAINER_ID} .bp-alt-score {
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
  }
  #${RATING_CONTAINER_ID} .bp-alt-votes {
    color: ${MUTED_FG};
    font-size: 11px;
    font-weight: 400;
  }
  #${RATING_CONTAINER_ID} .bp-thumb {
    width: 36px;
    height: 48px;
    object-fit: contain;
    flex-shrink: 0;
  }
  #${RATING_CONTAINER_ID} .bp-alt-thumb {
    width: 28px;
    height: 38px;
    object-fit: contain;
    flex-shrink: 0;
  }
  @media (hover: hover) and (pointer: fine) {
    #${RATING_CONTAINER_ID} .bp-thumb,
    #${RATING_CONTAINER_ID} .bp-alt-thumb {
      cursor: zoom-in;
    }
  }
  .bp-zoom-preview {
    position: fixed;
    display: none;
    max-width: 220px;
    max-height: 260px;
    padding: 6px;
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    object-fit: contain;
    pointer-events: none;
    z-index: 2147483647;
  }
  #${RATING_CONTAINER_ID} .bp-spinner-wrap {
    display: flex;
    align-items: center;
    height: 48px;
    gap: 10px;
  }
  #${RATING_CONTAINER_ID} .bp-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid ${BORDER};
    border-top-color: ${FG};
    border-radius: 50%;
    animation: bp-spin 0.8s linear infinite;
  }
  @keyframes bp-spin {
    to { transform: rotate(360deg); }
  }
  .bp-card-rating {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
  }
  .bp-card-rating svg { width: 14px; height: 14px; }
  .bp-card-rating .bp-card-score {
    font-weight: 700;
    font-size: 12px;
    color: ${FG};
  }
  .bp-card-rating .bp-card-votes {
    color: ${MUTED_FG};
    font-size: 11px;
  }
  .bp-card-spinner-inline {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-top: 6px;
    border: 2px solid ${BORDER};
    border-top-color: ${FG};
    border-radius: 50%;
    animation: bp-spin 0.8s linear infinite;
  }
`

export function getAndClearContainer(): HTMLElement {
  let container = document.getElementById(RATING_CONTAINER_BODY_ID)
  if (!container) {
    injectRatingContainer()
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  container = document.getElementById(RATING_CONTAINER_BODY_ID)!
  // Re-rendering can remove a hovered thumbnail without a mouseleave firing.
  hideZoomPreview()
  container.innerHTML = ''
  return container
}

export function injectRatingContainer() {
  if (document.getElementById(RATING_CONTAINER_BODY_ID)) {
    return
  }
  const ratingContainer = document.createElement('div')
  ratingContainer.id = RATING_CONTAINER_ID

  const header = document.createElement('div')
  header.className = 'bp-header'
  header.textContent = 'Bolaget+'
  ratingContainer.appendChild(header)

  const bodyDiv = document.createElement('div')
  bodyDiv.id = RATING_CONTAINER_BODY_ID
  ratingContainer.appendChild(bodyDiv)

  const productHeader = document.querySelector('main h1')
  if (productHeader?.parentNode) {
    productHeader.parentNode.insertBefore(
      ratingContainer,
      productHeader.nextSibling
    )
  }

  ensureStyles()
}

export function setMessage(message: string) {
  const ratingContainer = document.getElementById(RATING_CONTAINER_BODY_ID)
  if (!ratingContainer) {
    return
  }
  ratingContainer.innerHTML = `<div class="bp-message">${message}</div>`
}

export function setRating(
  productType: ProductType,
  rating: RatingResponse,
  link: null | string
) {
  const ratingContainer = getAndClearContainer()

  const svg =
    productType === ProductType.Wine
      ? generateStarsSvg(rating.rating)
      : generateCapSvg(rating.rating)

  // A score of 0 means the source has too few ratings to compute one yet.
  const scoreHtml =
    rating.rating > 0
      ? `<span class="bp-score">${rating.rating.toString()}</span>
        <span class="bp-scale">/ 5</span>`
      : `<span class="bp-score" title="${i18n.t('noRatingYet')}">N/A</span>`

  const ratingRow = document.createElement('div')
  ratingRow.className = 'bp-rating-row'
  ratingRow.innerHTML = `
        ${svg}
        ${scoreHtml}
      `
  if (rating.imageDataUrl) {
    ratingRow.prepend(createThumbnail(rating.imageDataUrl, 'bp-thumb'))
  }

  const meta = document.createElement('div')
  meta.className = 'bp-meta'
  meta.innerText = `${rating.votes.toString()} ${i18n.t('votes')}`
  if (productType !== ProductType.Wine) {
    const beerRating = rating as BeerResponse
    if (beerRating.brewery) {
      meta.innerText += ` · ${beerRating.brewery}`
    }
  }

  const linkLabel =
    productType === ProductType.Wine
      ? i18n.t('linkToVivino')
      : i18n.t('linkToUntappd')

  const footer = document.createElement('div')
  footer.className = 'bp-footer'
  footer.appendChild(meta)
  footer.appendChild(createSourceLink(link, linkLabel))

  ratingContainer.appendChild(ratingRow)
  ratingContainer.appendChild(footer)
}

export function setUncertain(productType: ProductType, rating: RatingResponse) {
  const ratingContainer = getAndClearContainer()
  const alternatives = rating.alternatives ?? []

  const message = document.createElement('div')
  message.className = 'bp-message'
  message.innerText =
    alternatives.length > 0
      ? `${i18n.t('closestMatches')}:`
      : i18n.t('uncertainMatch')
  ratingContainer.appendChild(message)

  if (alternatives.length > 0) {
    const list = document.createElement('div')
    list.className = 'bp-alt-list'
    for (const alternative of alternatives) {
      list.appendChild(createAlternativeItem(alternative))
    }
    ratingContainer.appendChild(list)
  }

  const linkLabel =
    productType === ProductType.Wine
      ? i18n.t('searchAtVivino')
      : i18n.t('searchAtUntappd')

  const footer = document.createElement('div')
  footer.className = 'bp-footer'
  footer.style.justifyContent = 'center'
  footer.style.marginTop = '6px'
  footer.appendChild(createSourceLink(rating.link, linkLabel))

  ratingContainer.appendChild(footer)
}

export function showLoadingSpinner() {
  const ratingContainer = getAndClearContainer()
  const spinner = document.createElement('div')
  spinner.className = 'bp-spinner-wrap'
  spinner.innerHTML = `
      <div class="bp-spinner"></div>
      <span class="bp-message">${i18n.t('loading')}</span>
    `

  ratingContainer.appendChild(spinner)
}

function createAlternativeItem(
  alternative: RatingAlternative
): HTMLAnchorElement {
  const item = document.createElement('a')
  item.className = 'bp-alt-item'
  item.href = alternative.link
  item.target = '_blank'
  item.rel = 'noopener noreferrer'

  if (alternative.imageDataUrl) {
    item.appendChild(createThumbnail(alternative.imageDataUrl, 'bp-alt-thumb'))
  }

  const name = document.createElement('span')
  name.className = 'bp-alt-name'
  name.textContent = alternative.name

  const score = document.createElement('span')
  score.className = 'bp-alt-score'
  // A score of 0 means the source has too few ratings to compute one yet.
  score.textContent =
    alternative.rating > 0 ? alternative.rating.toString() : 'N/A'
  if (alternative.votes > 0) {
    const votes = document.createElement('span')
    votes.className = 'bp-alt-votes'
    votes.textContent = ` (${alternative.votes.toString()})`
    score.appendChild(votes)
  }

  item.appendChild(name)
  item.appendChild(score)
  return item
}

function createSourceLink(
  link: null | string,
  label: string
): HTMLAnchorElement {
  const linkElement = document.createElement('a')
  linkElement.className = 'bp-link'
  if (link) {
    linkElement.href = link
  }
  linkElement.target = '_blank'
  linkElement.rel = 'noopener noreferrer'
  linkElement.append(label)
  linkElement.insertAdjacentHTML(
    'beforeend',
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>`
  )
  return linkElement
}

function createThumbnail(dataUrl: string, className: string): HTMLImageElement {
  const img = document.createElement('img')
  img.className = className
  img.src = dataUrl
  img.alt = ''
  attachZoomOnHover(img, dataUrl)
  return img
}

let zoomPreview: HTMLImageElement | null = null

// Desktop-only: hovering a small label thumbnail floats an enlarged copy next
// to it. The card itself is `overflow: hidden`, so the preview lives on <body>.
function attachZoomOnHover(img: HTMLImageElement, dataUrl: string): void {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return
  }
  img.addEventListener('mouseenter', () => {
    const preview = getZoomPreview()
    preview.src = dataUrl
    positionZoomPreview(preview, img)
    preview.style.display = 'block'
  })
  img.addEventListener('mouseleave', hideZoomPreview)
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

function generateCapSvg(rating: number): string {
  const maxCaps = 5
  const yellowColor = '#ffc000'
  const grayColor = '#d8d8d8'
  const heightAndWidth = '28px'
  const capSvg = (fill: string) => `
  <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${heightAndWidth}" height="${heightAndWidth}" viewBox="0 0 50 50" style="shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd" xmlns:xlink="http://www.w3.org/1999/xlink">
    <g><path style="opacity:0.954" fill="${fill}" d="M 20.5,-0.5 C 22.1667,-0.5 23.8333,-0.5 25.5,-0.5C 25.8656,0.694594 26.699,1.36126 28,1.5C 31.7073,-0.156277 34.2073,1.01039 35.5,5C 39.7905,4.43599 41.9571,6.26933 42,10.5C 45.7611,11.7146 46.9277,14.048 45.5,17.5C 45.4534,19.0377 46.1201,20.0377 47.5,20.5C 47.5,21.8333 47.5,23.1667 47.5,24.5C 46.4749,25.3739 45.8082,26.5405 45.5,28C 47.1563,31.7073 45.9896,34.2073 42,35.5C 42.564,39.7905 40.7307,41.9571 36.5,42C 35.3336,45.5714 33.1669,46.7381 30,45.5C 28.3009,45.3866 27.1342,46.0532 26.5,47.5C 25.1667,47.5 23.8333,47.5 22.5,47.5C 21.6261,46.4749 20.4595,45.8082 19,45.5C 15.2927,47.1563 12.7927,45.9896 11.5,42C 7.20953,42.564 5.04286,40.7307 5,36.5C 1.42855,35.3336 0.261888,33.1669 1.5,30C 1.61345,28.3009 0.94678,27.1342 -0.5,26.5C -0.5,25.1667 -0.5,23.8333 -0.5,22.5C 0.525111,21.6261 1.19178,20.4595 1.5,19C -0.156277,15.2927 1.01039,12.7927 5,11.5C 4.43599,7.20953 6.26933,5.04286 10.5,5C 11.6664,1.42855 13.8331,0.261888 17,1.5C 18.6991,1.61345 19.8658,0.94678 20.5,-0.5 Z"/></g>
  </svg>
  `

  let capsHtml = ''
  for (let i = 0; i < maxCaps; i++) {
    if (rating >= i + 1) {
      capsHtml += capSvg(yellowColor)
    } else if (rating >= i + 0.5) {
      const gradientId = `bp-half-cap-${i.toString()}`
      capsHtml += `
      <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${heightAndWidth}" height="${heightAndWidth}" viewBox="0 0 50 50" style="shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <linearGradient id="${gradientId}">
            <stop offset="50%" stop-color="${yellowColor}" />
            <stop offset="50%" stop-color="${grayColor}" />
          </linearGradient>
        </defs>
        <g><path style="opacity:0.954" fill="url(#${gradientId})" d="M 20.5,-0.5 C 22.1667,-0.5 23.8333,-0.5 25.5,-0.5C 25.8656,0.694594 26.699,1.36126 28,1.5C 31.7073,-0.156277 34.2073,1.01039 35.5,5C 39.7905,4.43599 41.9571,6.26933 42,10.5C 45.7611,11.7146 46.9277,14.048 45.5,17.5C 45.4534,19.0377 46.1201,20.0377 47.5,20.5C 47.5,21.8333 47.5,23.1667 47.5,24.5C 46.4749,25.3739 45.8082,26.5405 45.5,28C 47.1563,31.7073 45.9896,34.2073 42,35.5C 42.564,39.7905 40.7307,41.9571 36.5,42C 35.3336,45.5714 33.1669,46.7381 30,45.5C 28.3009,45.3866 27.1342,46.0532 26.5,47.5C 25.1667,47.5 23.8333,47.5 22.5,47.5C 21.6261,46.4749 20.4595,45.8082 19,45.5C 15.2927,47.1563 12.7927,45.9896 11.5,42C 7.20953,42.564 5.04286,40.7307 5,36.5C 1.42855,35.3336 0.261888,33.1669 1.5,30C 1.61345,28.3009 0.94678,27.1342 -0.5,26.5C -0.5,25.1667 -0.5,23.8333 -0.5,22.5C 0.525111,21.6261 1.19178,20.4595 1.5,19C -0.156277,15.2927 1.01039,12.7927 5,11.5C 4.43599,7.20953 6.26933,5.04286 10.5,5C 11.6664,1.42855 13.8331,0.261888 17,1.5C 18.6991,1.61345 19.8658,0.94678 20.5,-0.5 Z"/></g>
      </svg>`
    } else {
      capsHtml += capSvg(grayColor)
    }
  }

  return `<div style="display: flex">${capsHtml}</div>`
}

function getZoomPreview(): HTMLImageElement {
  if (!zoomPreview) {
    zoomPreview = document.createElement('img')
    zoomPreview.className = 'bp-zoom-preview'
    zoomPreview.alt = ''
    document.body.appendChild(zoomPreview)
    // The preview position is a snapshot of the anchor; hide instead of
    // drifting when the page (or any ancestor) scrolls.
    window.addEventListener('scroll', hideZoomPreview, {
      capture: true,
      passive: true
    })
  }
  return zoomPreview
}

function hideZoomPreview(): void {
  if (zoomPreview) {
    zoomPreview.style.display = 'none'
  }
}

function positionZoomPreview(
  preview: HTMLImageElement,
  anchor: HTMLElement
): void {
  const margin = 8
  const gap = 12
  // Max rendered box: max-width/max-height (220x260) plus 6px padding per side.
  const boxWidth = 232
  const boxHeight = 272
  const rect = anchor.getBoundingClientRect()

  let top = rect.top + rect.height / 2 - boxHeight / 2
  top = Math.max(margin, Math.min(top, window.innerHeight - boxHeight - margin))

  // Prefer the right of the thumbnail; flip left when it would overflow.
  let left = rect.right + gap
  if (left + boxWidth > window.innerWidth - margin) {
    left = rect.left - gap - boxWidth
  }

  preview.style.top = `${top.toString()}px`
  preview.style.left = `${left.toString()}px`
}

const CARD_RATING_CLASS = 'bp-card-rating'

// A badge or spinner names the product it was made for, since the SPA may
// re-render a tile for another product (a new sort or filter) and keep the old
// tile element, with our badge still in it.
const CARD_PRODUCT_ATTRIBUTE = 'data-bp-product'
const CARD_INJECTED_SELECTOR = `.${CARD_RATING_CLASS}, .bp-card-spinner-inline`

export function injectCardSpinner(
  card: Element,
  productId: string
): HTMLElement | null {
  for (const injected of card.querySelectorAll(CARD_INJECTED_SELECTOR)) {
    if (injected.getAttribute(CARD_PRODUCT_ATTRIBUTE) === productId) {
      return null
    }
    injected.remove()
  }
  ensureStyles()
  const anchor = findCardAnchor(card)
  if (!anchor) return null

  const spinner = document.createElement('div')
  spinner.className = 'bp-card-spinner-inline'
  spinner.setAttribute(CARD_PRODUCT_ATTRIBUTE, productId)
  anchor.insertAdjacentElement('afterend', spinner)
  return spinner
}

export function replaceCardSpinner(
  card: Element,
  spinner: HTMLElement,
  productId: string,
  productType: ProductType,
  rating: RatingResponse
): void {
  spinner.remove()
  if (rating.status !== RatingResultStatus.Found) {
    return
  }
  const svg =
    productType === ProductType.Wine
      ? generateStarsSvg(rating.rating)
      : generateCapSvg(rating.rating)
  const badge = document.createElement('div')
  badge.className = CARD_RATING_CLASS
  badge.setAttribute(CARD_PRODUCT_ATTRIBUTE, productId)
  badge.innerHTML = `
    ${svg}
    ${cardScoreHtml(rating.rating)}
    <span class="bp-card-votes">(${rating.votes.toString()})</span>
  `
  // The SPA may have re-rendered the card's contents while the rating request
  // was in flight, detaching the spinner or putting another product in the
  // tile — so re-check both instead of replacing a node that may be gone.
  if (card.querySelector(`.${CARD_RATING_CLASS}`)) return
  if (getCardProductId(card) !== productId) return
  findCardAnchor(card)?.insertAdjacentElement('afterend', badge)
}

// A score of 0 means the source has too few ratings to compute one yet —
// Vivino withholds the average below about 25 ratings — not that it is rated
// zero, so show it as on the product page.
function cardScoreHtml(score: number): string {
  return score > 0
    ? `<span class="bp-card-score">${score.toString()}</span>`
    : `<span class="bp-card-score" title="${i18n.t('noRatingYet')}">N/A</span>`
}

// The line a card's badge goes under: the "750 ml · 13 % vol. · Nr 223701"
// details below the name. Located by its data-slot name, which — unlike the
// utility class names around it — says what the element is.
function findCardAnchor(card: Element): Element | null {
  return card.querySelector('[data-slot="product-summary-metadata"]')
}

function generateStarsSvg(rating: number): string {
  const maxStars = 5
  const redColor = '#dc3545' // Red color for the stars
  const grayColor = '#e4e5e9' // Gray color for empty stars

  // Function to create an SVG star with a given fill color
  const starSvg = (fill: string) => `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="${fill}" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 .587l3.668 7.568L24 9.423l-6 5.832 1.416 8.25L12 18.897 4.584 23.505 6 15.255l-6-5.832 8.332-1.268L12 .587z"/>
      </svg>`

  let starsHtml = ''
  for (let i = 0; i < maxStars; i++) {
    if (rating >= i + 1) {
      // Full red star
      starsHtml += starSvg(redColor)
    } else if (rating >= i + 0.5) {
      // Half red star using linear gradient
      const gradientId = `bp-half-star-${i.toString()}`
      starsHtml += `
          <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="${gradientId}">
                <stop offset="50%" stop-color="${redColor}" />
                <stop offset="50%" stop-color="${grayColor}" />
              </linearGradient>
            </defs>
            <path d="M12 .587l3.668 7.568L24 9.423l-6 5.832 1.416 8.25L12 18.897 4.584 23.505 6 15.255l-6-5.832 8.332-1.268L12 .587z" fill="url(#${gradientId})"/>
          </svg>`
    } else {
      // Empty gray star
      starsHtml += starSvg(grayColor)
    }
  }

  return `<div style="display: flex">${starsHtml}</div>`
}
