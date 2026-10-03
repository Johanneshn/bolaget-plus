import type { TastedSource } from '@/components/tasted'

import {
  BeerResponse,
  ProductType,
  RatingAlternative,
  RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import {
  getCardPricePerLitre,
  getCardProductId
} from '@/components/productUtils'
import { t } from '@/components/strings'

const RATING_CONTAINER_ID = 'rating-container'
const RATING_CONTAINER_BODY_ID = 'rating-container-body'
const STYLE_ID = 'bolaget-plus-css'

// The rating section borrows Systembolaget's own design tokens (with
// fallbacks for when a redesign renames them) so it reads as part of the
// product page: a softly tinted block labelled like the page's own
// "FYLLIGHET"-style headings, rather than a branded widget on top of it.
const FG = 'var(--foreground, #262626)'
const MUTED_FG = 'var(--muted-foreground, #262626b3)'
const BORDER = 'var(--border, #2626261a)'
const PRIMARY = 'var(--primary, #095741)'
const MUTED_BG = 'var(--muted, #2626260d)'

const STYLES = `
  #${RATING_CONTAINER_ID} {
    margin: 16px 0;
    padding: 14px 16px;
    border-radius: 8px;
    background: ${MUTED_BG};
    font-family: inherit;
    font-size: 14px;
    color: ${FG};
  }
  #${RATING_CONTAINER_ID} .bp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 28px;
    margin-bottom: 8px;
  }
  #${RATING_CONTAINER_ID} .bp-label {
    font-family: var(--font-bolaget-medium-condensed, inherit);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${PRIMARY};
  }
  .bp-tasted {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 2px 10px;
    border: 1px solid var(--border-strong, #26262640);
    border-radius: 999px;
    background: transparent;
    color: ${FG};
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .bp-tasted:hover {
    border-color: ${FG};
  }
  .bp-tasted[aria-pressed='true'],
  .bp-tasted-static {
    border-color: ${PRIMARY};
    color: ${PRIMARY};
    font-weight: 600;
  }
  .bp-tasted-static {
    cursor: default;
  }
  .bp-tasted svg,
  .bp-card-tasted svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .bp-card-tasted {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
    color: ${PRIMARY};
    font-size: 12px;
    font-weight: 600;
  }
  #${RATING_CONTAINER_ID} .bp-rating-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #${RATING_CONTAINER_ID} .bp-score {
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
  }
  #${RATING_CONTAINER_ID} .bp-scale {
    color: ${MUTED_FG};
    font-size: 13px;
  }
  #${RATING_CONTAINER_ID} .bp-vintage {
    display: inline-block;
    margin-top: 4px;
    color: ${FG};
    font-size: 13px;
    text-decoration: none;
  }
  #${RATING_CONTAINER_ID} .bp-vintage:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  #${RATING_CONTAINER_ID} .bp-vintage strong {
    font-weight: 700;
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
  #${RATING_CONTAINER_ID} .bp-alt-list[hidden] {
    display: none;
  }
  #${RATING_CONTAINER_ID} .bp-alt-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    border-top: 1px solid ${BORDER};
  }
  #${RATING_CONTAINER_ID} .bp-alt-link {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 8px;
    color: ${FG};
    text-decoration: none;
  }
  #${RATING_CONTAINER_ID} .bp-alt-link:hover,
  #${RATING_CONTAINER_ID} .bp-alt-link:active {
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
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
  }
  #${RATING_CONTAINER_ID} .bp-alt-score svg {
    width: 11px;
    height: 11px;
  }
  #${RATING_CONTAINER_ID} .bp-alt-votes {
    color: ${MUTED_FG};
    font-size: 11px;
    font-weight: 400;
  }
  #${RATING_CONTAINER_ID} :is(a, button):focus-visible,
  .bp-sort button:focus-visible {
    outline: 2px solid ${PRIMARY};
    outline-offset: 2px;
    border-radius: 4px;
  }
  #${RATING_CONTAINER_ID} :is(.bp-score, .bp-alt-score, .bp-meta, .bp-vintage),
  .bp-card-rating {
    font-variant-numeric: tabular-nums;
  }
  #${RATING_CONTAINER_ID} .bp-text-button {
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: ${FG};
    font: inherit;
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  #${RATING_CONTAINER_ID} .bp-text-button:hover {
    text-decoration-thickness: 2px;
  }
  #${RATING_CONTAINER_ID} .bp-choose {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
    padding: 0 4px;
    font-weight: 600;
  }
  #${RATING_CONTAINER_ID} .bp-correction {
    margin-top: 8px;
    color: ${MUTED_FG};
    font-size: 13px;
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
  .bp-sort {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px 16px;
    padding: 0 16px 8px;
    color: ${FG};
    font-size: 14px;
  }
  .bp-filter {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .bp-filter span {
    margin-right: 4px;
    color: ${MUTED_FG};
  }
  .bp-sort button {
    min-height: 36px;
    padding: 6px 14px;
    border: 1px solid var(--border-strong, #26262640);
    border-radius: 999px;
    background: transparent;
    color: ${FG};
    font: inherit;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .bp-sort button:hover {
    border-color: ${FG};
  }
  .bp-sort button[aria-pressed='true'] {
    border-color: ${PRIMARY};
    background: ${PRIMARY};
    color: var(--primary-foreground, #ffffff);
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

// What the user can do about a match: pick another candidate, or undo a pick.
export interface MatchActions {
  onChoose?: (pick: RatingAlternative) => void
  onUndo?: () => void
}

export function getAndClearContainer(): HTMLElement {
  let container = document.getElementById(RATING_CONTAINER_BODY_ID)
  if (!container) {
    injectRatingContainer()
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  container = document.getElementById(RATING_CONTAINER_BODY_ID)!
  // Re-rendering can remove a hovered thumbnail without a mouseleave firing.
  hideZoomPreview()
  container.replaceChildren()
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
  const label = document.createElement('span')
  label.className = 'bp-label'
  label.textContent = 'Bolaget+'
  const tasted = document.createElement('div')
  tasted.className = 'bp-tasted-slot'
  header.append(label, tasted)
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
  const element = document.createElement('div')
  element.className = 'bp-message'
  element.textContent = message
  ratingContainer.replaceChildren(element)
}

export function setRating(
  productType: ProductType,
  rating: RatingResponse,
  link: null | string,
  vintageYear: null | string = null,
  actions: MatchActions = {}
) {
  const ratingContainer = getAndClearContainer()

  const stars = document.createElement('span')
  stars.className = 'bp-stars'
  stars.setAttribute('role', 'img')
  stars.setAttribute('aria-label', ratingLabel(rating))
  stars.appendChild(createRatingIcons(productType, rating.rating))

  const score = document.createElement('span')
  score.setAttribute('aria-hidden', 'true')
  score.appendChild(createScore(rating.rating, 'bp-score'))
  // A score of 0 means the source has too few ratings to compute one yet.
  if (rating.rating > 0) {
    const scale = document.createElement('span')
    scale.className = 'bp-scale'
    scale.textContent = ' / 5'
    score.appendChild(scale)
  }

  const ratingRow = document.createElement('div')
  ratingRow.className = 'bp-rating-row'
  ratingRow.append(stars, score)
  if (rating.imageDataUrl) {
    ratingRow.prepend(createThumbnail(rating.imageDataUrl, 'bp-thumb'))
  }

  const meta = document.createElement('div')
  meta.className = 'bp-meta'
  meta.innerText = `${formatCount(rating.votes)} ${t('votes')}`
  if (productType !== ProductType.Wine) {
    const beerRating = rating as BeerResponse
    if (beerRating.brewery) {
      meta.innerText += ` · ${beerRating.brewery}`
    }
  }

  const linkLabel =
    productType === ProductType.Wine ? t('linkToVivino') : t('linkToUntappd')

  const footer = document.createElement('div')
  footer.className = 'bp-footer'
  footer.appendChild(meta)
  footer.appendChild(createSourceLink(link, linkLabel))

  ratingContainer.appendChild(ratingRow)
  ratingContainer.appendChild(footer)
  const vintage = createVintageLine(rating, vintageYear)
  if (vintage) {
    // Two vote counts on one card need telling apart.
    meta.innerText += ` · ${t('allVintages')}`
    ratingContainer.appendChild(vintage)
  }

  const correction = createCorrection(productType, rating, actions)
  if (correction) ratingContainer.appendChild(correction)
}

// The "Provad" control in the card's header: a toggle for the user's own mark,
// or — for a beer found in their imported Untappd history — a plain note
// saying so, since that is not something to undo from here.
export function setTastedState(
  source: null | TastedSource,
  onToggle: (tasted: boolean) => void
): void {
  const slot = document.querySelector(`#${RATING_CONTAINER_ID} .bp-tasted-slot`)
  if (!slot) return

  if (source === 'untappd') {
    const note = document.createElement('span')
    note.className = 'bp-tasted bp-tasted-static'
    note.append(createCheckIcon(), t('checkedInOnUntappd'))
    slot.replaceChildren(note)
    return
  }

  const tasted = source === 'self'
  // Updated in place when it is already there, so a keyboard or screen-reader
  // user who just pressed it keeps their focus on it.
  let button = slot.querySelector<HTMLButtonElement>('button.bp-tasted')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'bp-tasted'
    slot.replaceChildren(button)
  }
  const current = button
  current.setAttribute('aria-pressed', String(tasted))
  current.replaceChildren(
    ...(tasted ? [createCheckIcon()] : []),
    tasted ? t('tasted') : t('markTasted')
  )
  current.onclick = () => {
    onToggle(current.getAttribute('aria-pressed') !== 'true')
  }
}

export function setUncertain(
  productType: ProductType,
  rating: RatingResponse,
  onChoose?: (pick: RatingAlternative) => void
) {
  const ratingContainer = getAndClearContainer()
  const alternatives = rating.alternatives ?? []

  const message = document.createElement('div')
  message.className = 'bp-message'
  message.innerText =
    alternatives.length > 0 ? `${t('closestMatches')}:` : t('uncertainMatch')
  ratingContainer.appendChild(message)

  if (alternatives.length > 0) {
    ratingContainer.appendChild(
      createAlternativeList(productType, alternatives, onChoose)
    )
  }

  const linkLabel =
    productType === ProductType.Wine
      ? t('searchAtVivino')
      : t('searchAtUntappd')

  const footer = document.createElement('div')
  footer.className = 'bp-footer'
  footer.style.justifyContent = 'flex-end'
  footer.style.marginTop = '6px'
  footer.appendChild(createSourceLink(rating.link, linkLabel))

  ratingContainer.appendChild(footer)
}

export function showLoadingSpinner() {
  const ratingContainer = getAndClearContainer()
  const spinner = document.createElement('div')
  spinner.className = 'bp-spinner-wrap'
  const wheel = document.createElement('div')
  wheel.className = 'bp-spinner'
  const label = document.createElement('span')
  label.className = 'bp-message'
  label.textContent = t('loading')
  spinner.append(wheel, label)

  ratingContainer.appendChild(spinner)
}

// One candidate: a link to it on Vivino/Untappd (thumbnail, name, small stars
// and score) and, when the user can correct the match, a button to pick it.
// The two are siblings — a button cannot sit inside a link.
function createAlternativeItem(
  productType: ProductType,
  alternative: RatingAlternative,
  onChoose?: (pick: RatingAlternative) => void,
  reserveThumbnail = false
): HTMLElement {
  const item = document.createElement('div')
  item.className = 'bp-alt-item'

  const link = document.createElement('a')
  link.className = 'bp-alt-link'
  link.href = alternative.link
  link.target = '_blank'
  link.rel = 'noopener noreferrer'

  if (alternative.imageDataUrl) {
    link.appendChild(createThumbnail(alternative.imageDataUrl, 'bp-alt-thumb'))
  } else if (reserveThumbnail) {
    // Keeps the names aligned with the rows that do have a label image.
    const slot = document.createElement('span')
    slot.className = 'bp-alt-thumb'
    link.appendChild(slot)
  }

  const name = document.createElement('span')
  name.className = 'bp-alt-name'
  name.textContent = alternative.name

  const score = document.createElement('span')
  score.className = 'bp-alt-score'
  // A score of 0 means the source has too few ratings to compute one yet.
  if (alternative.rating > 0) {
    score.appendChild(createRatingIcons(productType, alternative.rating))
  }
  const value = document.createElement('span')
  value.textContent =
    alternative.rating > 0 ? formatScore(alternative.rating) : NO_SCORE
  score.appendChild(value)
  if (alternative.votes > 0) {
    const votes = document.createElement('span')
    votes.className = 'bp-alt-votes'
    votes.textContent = ` (${formatCount(alternative.votes)})`
    score.appendChild(votes)
  }
  score.setAttribute('aria-label', ratingLabel(alternative))

  link.appendChild(name)
  link.appendChild(score)
  item.appendChild(link)

  if (onChoose) {
    const choose = createTextButton(t('choose'), () => {
      onChoose(alternative)
    })
    choose.classList.add('bp-choose')
    item.appendChild(choose)
  }
  return item
}

function createAlternativeList(
  productType: ProductType,
  alternatives: RatingAlternative[],
  onChoose?: (pick: RatingAlternative) => void
): HTMLElement {
  const list = document.createElement('div')
  list.className = 'bp-alt-list'
  const anyImage = alternatives.some((alternative) => alternative.imageDataUrl)
  for (const alternative of alternatives) {
    list.appendChild(
      createAlternativeItem(productType, alternative, onChoose, anyImage)
    )
  }
  return list
}

// Half stars and caps fill through a gradient referenced by id. The id must be
// unique per icon: url(#id) resolves to the first element with that id in the
// page, and when that one sits in a hidden card ("Dölj provade") the gradient
// stops painting for every other icon that shares it.
let gradientCounter = 0
// A check mark, drawn as SVG (one stroke, the text's colour) rather than a
// glyph, built node by node so no markup string is involved.
function createCheckIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5')
  svg.appendChild(path)
  return svg
}

// Below a found match: "Ditt val · Ångra" on a match the user picked, or a
// "Fel träff?" toggle that reveals the runners-up to pick from instead. The
// list stays folded — most matches are right, and the card should say so.
function createCorrection(
  productType: ProductType,
  rating: RatingResponse,
  { onChoose, onUndo }: MatchActions
): HTMLElement | null {
  const row = document.createElement('div')
  row.className = 'bp-correction'

  if (rating.pinned) {
    if (!onUndo) return null
    row.append(`${t('yourPick')} · `)
    row.appendChild(createTextButton(t('undo'), onUndo))
    return row
  }

  const alternatives = rating.alternatives ?? []
  if (!onChoose || alternatives.length === 0) return null

  const list = createAlternativeList(productType, alternatives, onChoose)
  list.hidden = true
  const toggle = createTextButton(t('wrongMatch'), () => {
    list.hidden = !list.hidden
    toggle.setAttribute('aria-expanded', String(!list.hidden))
  })
  toggle.setAttribute('aria-expanded', 'false')
  row.appendChild(toggle)
  row.appendChild(list)
  return row
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
  return linkElement
}

// A button that looks like the card's links: plain underlined text.
function createTextButton(label: string, onClick: () => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'bp-text-button'
  button.textContent = label
  button.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return button
}

function createThumbnail(dataUrl: string, className: string): HTMLImageElement {
  const img = document.createElement('img')
  img.className = className
  img.src = dataUrl
  img.alt = ''
  attachZoomOnHover(img, dataUrl)
  return img
}

// "Årgång 2024: 3.9 (846 röster)" under the pooled rating, when Vivino lists
// the vintage on the shelf. The pooled rating stays the headline: a single
// vintage often has few ratings, and Vivino publishes no average at all below
// its threshold — that case says so rather than hiding the line.
function createVintageLine(
  rating: RatingResponse,
  year: null | string
): HTMLElement | null {
  const vintage = year
    ? rating.vintages?.find((candidate) => candidate.year === year)
    : undefined
  if (!vintage) return null

  const line = document.createElement('a')
  line.className = 'bp-vintage'
  line.href = `https://www.vivino.com/wines/${vintage.id.toString()}`
  line.target = '_blank'
  line.rel = 'noopener noreferrer'

  const label = document.createElement('span')
  label.textContent = `${t('vintage')} ${vintage.year}: `
  line.appendChild(label)

  const score = document.createElement('strong')
  if (vintage.rating > 0) {
    score.textContent = formatScore(vintage.rating)
    line.appendChild(score)
    line.append(` (${formatCount(vintage.votes)} ${t('votes')})`)
  } else {
    score.textContent = t('noRatingYet')
    line.appendChild(score)
  }
  return line
}

function nextGradientId(): string {
  gradientCounter++
  return gradientCounter.toString()
}

// What a screen reader should say for a score shown as stars: "3.9 av 5, 412
// röster" rather than five unlabelled images and a bare number.
function ratingLabel(rating: { rating: number; votes: number }): string {
  const score =
    rating.rating > 0
      ? `${formatScore(rating.rating)} ${t('of')} 5`
      : t('noRatingYet')
  return `${score}, ${formatCount(rating.votes)} ${t('votes')}`
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
      const gradientId = `bp-half-cap-${nextGradientId()}`
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

// "rating": best first. "value": most rating for the money first — see
// valueScores.
export type ListSort = 'none' | 'rating' | 'value'

// How the user wants a result list shown: sorted by rating or by value, and
// with tasted products hidden.
export interface ListView {
  hideTasted: boolean
  sortBy: ListSort
}

// Applies a ListView to a result list. Unrated cards — not looked up yet, not
// on Vivino or Untappd, boxes, too few ratings — are never hidden (no rating is
// not a bad rating) and, when sorting, keep their place after the rated ones.
export function applyListView(list: Element, view: ListView): void {
  const items = [...list.children].map((item) => {
    const tile = item.querySelector<HTMLElement>('[data-slot="product-tile"]')
    return {
      element: item as HTMLElement,
      pricePerLitre: tile ? getCardPricePerLitre(tile) : null,
      rating: Number(tile?.dataset.bpRating ?? 0),
      tile
    }
  })

  // The rank each sortable card gets; unranked cards keep the site's order
  // after them.
  const rank = new Map<HTMLElement, number>()
  if (view.sortBy === 'rating') {
    for (const item of items) {
      if (item.rating > 0) rank.set(item.element, -item.rating)
    }
  } else if (view.sortBy === 'value') {
    const priced = items.flatMap((item) =>
      item.rating > 0 && item.pricePerLitre !== null
        ? [{ ...item, pricePerLitre: item.pricePerLitre }]
        : []
    )
    valueScores(priced).forEach((score, i) => {
      rank.set(priced[i].element, -score)
    })
  }
  const ordered = [...rank.entries()].sort((a, b) => a[1] - b[1])
  const position = new Map(
    ordered.map(([element], index) => [element, index - ordered.length])
  )

  // Systembolaget mixes double-width editorial segments ("Dryck och mat")
  // into the grid. Once cards are reordered or hidden, such a segment can
  // leave an empty cell beside it; while a view is active, segments go last
  // and the grid packs densely, so no holes open up.
  const active = view.sortBy !== 'none' || view.hideTasted
  setStyle(list as HTMLElement, 'grid-auto-flow', active ? 'dense' : null)

  for (const { element, tile } of items) {
    const order = tile ? position.get(element) : active ? 1 : undefined
    setStyle(element, 'order', order === undefined ? null : String(order))
    const hidden = view.hideTasted && tile?.dataset.bpTasted === 'true'
    setStyle(element, 'display', hidden ? 'none' : null)
  }
}

// Clears what a tile carries over from a product it showed before: React can
// re-render a tile for another product (a new sort, a filter) and keep the
// element, with our badge, rating and tasted mark still on it. Without this a
// box wine or a not-found product would keep its predecessor's rating and be
// sorted, or hidden, as if it were that product.
export function clearStaleCard(card: Element, productId: string): void {
  const tile = card as HTMLElement
  if (tile.dataset.bpProduct === productId) return
  for (const injected of card.querySelectorAll(
    `${CARD_INJECTED_SELECTOR}, .bp-card-tasted`
  )) {
    injected.remove()
  }
  delete tile.dataset.bpRating
  delete tile.dataset.bpTasted
  tile.dataset.bpProduct = productId
}

// The Bolaget+ controls above a result list: "Dölj provade" and "Sortera:
// Betyg · Prisvärt". Both work through CSS on the grid items rather than by
// moving or removing them: the list is React's, and React re-renders a list
// whose nodes were changed behind its back into the wrong order or an error.
// Turning both off hands the list to the site unchanged.
export function ensureListControls(
  list: Element,
  view: ListView,
  onChange: (view: ListView, list: Element) => void
): void {
  ensureStyles()
  let control = list.previousElementSibling as HTMLElement | null
  if (!control?.classList.contains('bp-sort')) {
    control = document.createElement('div')
    control.className = 'bp-sort'
    const current = control
    // The list is looked up when a control is used, not captured now: the
    // site may swap the list element out from under a control it keeps.
    const listOf = () => current.nextElementSibling ?? list

    const sort = document.createElement('div')
    sort.className = 'bp-filter'
    sort.setAttribute('role', 'group')
    sort.setAttribute('aria-label', t('sort'))
    const sortLabel = document.createElement('span')
    sortLabel.textContent = `${t('sort')}:`
    sortLabel.setAttribute('aria-hidden', 'true')
    sort.appendChild(sortLabel)
    for (const [sortBy, text] of [
      ['rating', t('sortRating')],
      ['value', t('sortValue')]
    ] as const) {
      const option = document.createElement('button')
      option.type = 'button'
      option.dataset.sortBy = sortBy
      option.textContent = text
      // Pressing the active one again turns sorting off.
      option.addEventListener('click', () => {
        const view = readListView(current)
        onChange(
          { ...view, sortBy: view.sortBy === sortBy ? 'none' : sortBy },
          listOf()
        )
      })
      sort.appendChild(option)
    }

    const hideTasted = document.createElement('button')
    hideTasted.type = 'button'
    hideTasted.className = 'bp-hide-tasted'
    hideTasted.textContent = t('hideTasted')
    hideTasted.addEventListener('click', () => {
      const view = readListView(current)
      onChange({ ...view, hideTasted: !view.hideTasted }, listOf())
    })

    control.append(hideTasted, sort)
    list.before(control)
  }

  control.dataset.sort = view.sortBy
  control.dataset.hideTasted = String(view.hideTasted)
  control
    .querySelector('.bp-hide-tasted')
    ?.setAttribute('aria-pressed', String(view.hideTasted))
  for (const option of control.querySelectorAll<HTMLElement>(
    '[data-sort-by]'
  )) {
    option.setAttribute(
      'aria-pressed',
      String(option.dataset.sortBy === view.sortBy)
    )
  }
}

export function injectCardSpinner(
  card: Element,
  productId: string
): HTMLElement | null {
  clearStaleCard(card, productId)
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

// Marks a list card as tasted ("Provad" under its details) or clears the mark,
// and records it on the tile for the "Dölj provade" filter.
export function markCardTasted(card: Element, tasted: boolean): void {
  ensureStyles()
  ;(card as HTMLElement).dataset.bpTasted = String(tasted)
  const existing = card.querySelector('.bp-card-tasted')
  if (!tasted) {
    existing?.remove()
    return
  }
  if (existing) return
  const mark = document.createElement('div')
  mark.className = 'bp-card-tasted'
  mark.append(createCheckIcon(), t('tasted'))
  const after =
    card.querySelector(`.${CARD_RATING_CLASS}, .bp-card-spinner-inline`) ??
    findCardAnchor(card)
  after?.insertAdjacentElement('afterend', mark)
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
  const badge = document.createElement('div')
  badge.className = CARD_RATING_CLASS
  badge.setAttribute(CARD_PRODUCT_ATTRIBUTE, productId)
  badge.setAttribute('role', 'img')
  badge.setAttribute('aria-label', ratingLabel(rating))
  const votes = document.createElement('span')
  votes.className = 'bp-card-votes'
  votes.textContent = `(${formatCount(rating.votes)})`
  badge.append(
    createRatingIcons(productType, rating.rating),
    createScore(rating.rating, 'bp-card-score'),
    votes
  )
  // The SPA may have re-rendered the card's contents while the rating request
  // was in flight, detaching the spinner or putting another product in the
  // tile — so re-check both instead of replacing a node that may be gone.
  if (card.querySelector(`.${CARD_RATING_CLASS}`)) return
  if (getCardProductId(card) !== productId) return
  ;(card as HTMLElement).dataset.bpRating = rating.rating.toString()
  findCardAnchor(card)?.insertAdjacentElement('afterend', badge)
}

// How much better each card is rated than is usual for its price, in rating
// points. Ratings rise with price (a 300 kr wine is expected to beat a 90 kr
// one), so the cards on the list are fitted with a straight line of rating
// against log price per litre, and each card scores its distance above that
// line: "3,9 where 3,5 is normal at this price" outranks "4,1 where 4,2 is".
// With too few cards to fit a line it falls back to rating per log price.
export function valueScores(
  cards: { pricePerLitre: number; rating: number }[]
): number[] {
  const xs = cards.map((card) => Math.log(card.pricePerLitre))
  const ys = cards.map((card) => card.rating)
  const n = cards.length
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n
  const spread = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0)
  if (n < 5 || spread === 0) {
    return cards.map((card, i) => card.rating / xs[i])
  }
  const slope =
    xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) / spread
  const intercept = meanY - slope * meanX
  return ys.map((y, i) => y - (intercept + slope * xs[i]))
}

// Stars (wine) or bottle caps (beer, cider) for a score. The icons are our own
// static SVG markup, parsed rather than assigned through innerHTML: Mozilla's
// add-on review flags every innerHTML assignment, trusted or not.
function createRatingIcons(productType: ProductType, score: number): Node {
  const markup =
    productType === ProductType.Wine
      ? generateStarsSvg(score)
      : generateCapSvg(score)
  const fragment = document.createDocumentFragment()
  fragment.append(
    ...new DOMParser().parseFromString(markup, 'text/html').body.childNodes
  )
  return fragment
}

function readListView(control: HTMLElement): ListView {
  return {
    hideTasted: control.dataset.hideTasted === 'true',
    sortBy: (['rating', 'value'].includes(control.dataset.sort ?? '')
      ? control.dataset.sort
      : 'none') as ListSort
  }
}

// Sets or clears one inline style property, dropping the style attribute once
// it is empty, so an element of React's is left exactly as React rendered it.
function setStyle(
  element: HTMLElement,
  property: string,
  value: null | string
): void {
  if (value === null) {
    element.style.removeProperty(property)
    if (!element.getAttribute('style')) element.removeAttribute('style')
  } else {
    element.style.setProperty(property, value)
  }
}

// Scores and counts the way the Swedish page around them writes numbers:
// "3,9" and "98 172", not "3.9" and "98172".
const scoreFormat = new Intl.NumberFormat('sv-SE', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 1
})
const countFormat = new Intl.NumberFormat('sv-SE')

// Shown where the source has too few ratings for a score; the reason is in
// the title and the screen-reader label.
const NO_SCORE = '–'

// The score as text. A score of 0 means the source has too few ratings to
// compute one yet — Vivino withholds the average below about 25 ratings — not
// that it is rated zero, so it reads as a dash with the reason on hover.
function createScore(score: number, className: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  if (score > 0) {
    element.textContent = formatScore(score)
  } else {
    element.textContent = NO_SCORE
    element.title = t('noRatingYet')
  }
  return element
}

// The line a card's badge goes under: the "750 ml · 13 % vol. · Nr 223701"
// details below the name. Located by its data-slot name, which — unlike the
// utility class names around it — says what the element is.
function findCardAnchor(card: Element): Element | null {
  return card.querySelector('[data-slot="product-summary-metadata"]')
}

function formatCount(count: number): string {
  return countFormat.format(count)
}

function formatScore(score: number): string {
  return scoreFormat.format(score)
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
      const gradientId = `bp-half-star-${nextGradientId()}`
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
