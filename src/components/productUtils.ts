import { ProductType } from '@/@types/types'
import { countryCodeFromName } from '@/components/countries'

// A list card is a `[data-slot="product-tile"]` whose parts carry their own
// data-slot names. Systembolaget's class names are utility classes that
// reshuffle between redesigns; the slot names describe what each part is, so
// they are what a card is read by.
export const CARD_LINK_SELECTOR = 'a[data-slot="product-tile-action"]'
const CARD_SELECTOR = '[data-slot="product-tile"]'
const CARD_TITLE_SELECTOR = '[data-slot="product-summary-title"]'
const CARD_SUBTITLE_SELECTOR = '[data-slot="product-summary-subtitle"]'
const CARD_COUNTRY_SELECTOR = '[data-slot="product-summary-country"]'
const CARD_METADATA_SELECTOR = '[data-slot="product-summary-metadata"]'
// The visible price ("249:-"); the screen-reader twin says "249 kronor".
const CARD_PRICE_SELECTOR =
  '[data-slot="product-summary-price"] [aria-hidden="true"]'

// The last segment of a card link's accessible label: "750 ml", "3 l".
const VOLUME_SEGMENT = /^\d[\d\s,.]*(cl|l|ml)$/i

// A subtitle that is nothing but the vintage ("2021"), as products without a
// grape or appellation line render it.
const VINTAGE_ONLY = /^(19|20)\d{2}$/

// What the embedded page data tells us about a product beyond its name.
interface PageProduct {
  country?: string
  packaging?: string
  producer?: string
}

// The card a product link belongs to, for a link the page has just rendered.
export function getCard(link: Element): Element {
  return link.closest(CARD_SELECTOR) ?? link
}

// A list card's country, as an ISO alpha-2 code. The embedded page data does
// not cover list pages at all — /sortiment/ ships CMS content only and fetches
// its products client-side — so the card's own country line ("Italien", next
// to the flag) is the one place a card can be asked.
export function getCardCountry(card: Element): null | string {
  return (
    countryCodeFromName(
      card.querySelector(CARD_COUNTRY_SELECTOR)?.textContent
    ) ?? null
  )
}

export function getCardName(card: Element): null | string {
  const title = card.querySelector(CARD_TITLE_SELECTOR)
  if (!title) return null

  // The title link holds the name twice: once for the eye (aria-hidden) and
  // once, with subtitle and packaging appended, for screen readers.
  const name = (
    title.querySelector('[aria-hidden="true"]') ?? title
  ).textContent.trim()
  if (!name) return null

  const subtitle =
    card.querySelector(CARD_SUBTITLE_SELECTOR)?.textContent.trim() ?? ''
  return buildSearchName(name, subtitle) || null
}

// The card's price per litre, from its price ("249:-", "129:90") and the
// volume opening its details line ("750 ml · 13 % vol. · Nr …"). Null when
// either is missing, so a card that cannot be compared is left out of a value
// ranking rather than ranked on a guess.
export function getCardPricePerLitre(card: Element): null | number {
  const priceText =
    card.querySelector(CARD_PRICE_SELECTOR)?.textContent.replace(/\s/g, '') ??
    ''
  const price = /(\d+)(?::(\d{2}))?/.exec(priceText)
  const volume = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/i.exec(
    card.querySelector(CARD_METADATA_SELECTOR)?.textContent ?? ''
  )
  if (!price || !volume) return null

  // The öre group is optional, so it can be missing despite its string type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const kronor = Number(price[1]) + Number(price[2] ?? 0) / 100
  const amount = Number(volume[1].replace(',', '.'))
  const unit = volume[2].toLowerCase()
  const litres =
    unit === 'ml' ? amount / 1000 : unit === 'cl' ? amount / 100 : amount
  return kronor > 0 && litres > 0 ? kronor / litres : null
}

export function getCardProductId(card: Element): null | string {
  return extractProductId(getCardHref(card))
}

export function getCardProductType(card: Element): ProductType {
  const href = getCardHref(card)
  if (href.includes('/produkt/vin/')) return ProductType.Wine
  if (href.includes('/produkt/ol/')) return ProductType.Beer
  if (href.includes('/produkt/cider-blanddrycker/')) return ProductType.Cider
  return ProductType.Uncertain
}

// The producer Systembolaget names for a product, for the Vivino lookup to
// confirm a winery with. Only the embedded page data carries it, so it is
// missing after an SPA navigation to a product the loaded payload never held —
// the lookup then falls back to judging the title alone, as it always has.
export function getProducer(productId: string): null | string {
  return getProductFromPageData(productId)?.producer ?? null
}

// The product page's country, as an ISO alpha-2 code.
export function getProductCountry(productId: string): null | string {
  return countryCodeFromName(getProductFromPageData(productId)?.country) ?? null
}

export function getProductId(): null | string {
  return extractProductId(window.location.href)
}

export function getProductName(): null | string {
  const headerChildren = document.querySelector('main h1')?.children

  if (!headerChildren || headerChildren.length === 0) {
    return null
  }

  //eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const firstLine = (headerChildren[0] as HTMLElement).innerText.trim() ?? ''
  if (headerChildren.length === 1) {
    return buildSearchName(firstLine, '')
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const secondLine = (headerChildren[1] as HTMLElement).innerText.trim() ?? ''

  return buildSearchName(firstLine, secondLine)
}

export function getProductType(): ProductType {
  const url = window.location.href
  if (url.includes('/produkt/vin/')) {
    return ProductType.Wine
  }

  if (url.includes('/produkt/ol/')) {
    return ProductType.Beer
  }

  if (url.includes('/produkt/cider-blanddrycker/')) {
    return ProductType.Cider
  }

  return ProductType.Uncertain
}

// The vintage on the product page's title ("Pinot Noir, 2024" or just "2024"),
// for showing that vintage's own Vivino rating. Null for a non-vintage wine.
export function getProductVintage(): null | string {
  const subtitle = document.querySelector('main h1')?.children[1]
  const last = subtitle?.textContent.split(',').pop()?.trim() ?? ''
  return VINTAGE_ONLY.test(last) ? last : null
}

// Wine formats that are not a bottle and have no comparable Vivino rating.
// We exclude these rather than allow-list bottle types, so bottle variants
// (Flaska, Magnum, Halvflaska, …) all pass without enumerating them.
const NON_BOTTLE_FORMATS = [
  'box',
  'bag-in-box',
  'burk',
  'pet',
  'tetra',
  'påse',
  'pappförpackning',
  'fat',
  'pouch'
]

// A card's packaging segment is read out of a label that also holds the name
// and subtitle, so should the label ever come without one, the segment found
// is prose — the formats have to match as whole words there: "Bag-in-Box" and
// "PET" must hit, "Petit" and "Fatamorgana" must not.
const NON_BOTTLE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NON_BOTTLE_FORMATS.join('|')})(?![\\p{L}\\p{N}])`,
  'iu'
)

export function isBottle(): boolean {
  const main = document.querySelector('main')
  if (main == null) {
    return true
  }

  const productId = getProductId()
  const descriptor =
    (productId ? getPackagingFromPageData(productId) : null) ??
    getSelectedPackaging(main) ??
    getPackagingDescriptor(main)
  // If we can't read the packaging, assume bottle rather than block the rating.
  if (!descriptor) {
    return true
  }

  return !isNonBottlePackaging(descriptor)
}

// The list-page counterpart of isBottle(): a card links straight to the product
// page, so a box wine has to be filtered out here too or the badge shows a
// rating the product page itself refuses to show.
export function isCardBottle(card: Element, productId: string): boolean {
  const packaging = getPackagingFromPageData(productId)
  if (packaging) {
    return !isNonBottlePackaging(packaging)
  }

  // Cards the embedded page data doesn't cover (in practice all of them) only
  // leave the title link's accessible label, which ends in the packaging and
  // volume: "Crudo, Nerello Mascalese Frappato, 2025, Box, 3000 ml".
  const segments = (getCardLink(card)?.textContent ?? '')
    .split(',')
    .map((segment) => segment.trim())
  const volumeIndex = segments.length - 1
  if (volumeIndex < 1 || !VOLUME_SEGMENT.test(segments[volumeIndex])) {
    return true
  }

  return !NON_BOTTLE_PATTERN.test(segments[volumeIndex - 1])
}

export function isListPage(): boolean {
  return window.location.pathname.includes('/sortiment/')
}

function buildProductMap(raw: string): Map<string, PageProduct> {
  const map = new Map<string, PageProduct>()

  let root: unknown
  try {
    const parsed = JSON.parse(raw) as {
      props?: { pageProps?: { fallback?: unknown } }
    }
    root = parsed.props?.pageProps?.fallback
  } catch {
    return map
  }

  // The fallback is keyed by request URL and shaped differently per page type
  // (a bare product, a search response, a paged list), so walk it and index
  // every product object found rather than guessing at the nesting. The node
  // budget keeps an unexpectedly large payload from stalling the page.
  const queue: unknown[] = [root]
  for (let visited = 0; queue.length > 0 && visited < 5000; visited++) {
    const node = queue.shift()
    if (typeof node !== 'object' || node === null) {
      continue
    }
    if (Array.isArray(node)) {
      queue.push(...(node as unknown[]))
      continue
    }

    const product = node as {
      country?: unknown
      packagingLevel1?: unknown
      producerName?: unknown
      productNumber?: unknown
    }
    if (typeof product.productNumber === 'string') {
      const country = readString(product.country)
      const packaging = readString(product.packagingLevel1)?.toLowerCase()
      const producer = readString(product.producerName)
      // The payload nests the same product under several keys, and not every
      // copy is complete — keep the fields already found rather than letting a
      // sparser copy blank them.
      const known = map.get(product.productNumber)
      if (country ?? packaging ?? producer) {
        map.set(product.productNumber, {
          country: country ?? known?.country,
          packaging: packaging ?? known?.packaging,
          producer: producer ?? known?.producer
        })
      }
    }
    queue.push(...(Object.values(node) as unknown[]))
  }

  return map
}

// Turns the two title lines Systembolaget renders — the name and a subtitle
// that ends in the vintage ("Brunello di Montalcino, 2021", or just "2021") —
// into the name searched for on Vivino/Untappd. Both the product page and a
// list card go through here: they used to derive the query differently, one
// dropping the vintage and one keeping it, so the same wine was badged with
// two different Vivino entries depending on which view it was read from.
// The vintage is dropped because Vivino indexes a wine under one name for all
// its vintages — the year is absent from every hit's name, so carrying it into
// the query only drags the name similarity down, blocks an exact-name match,
// and shifts Algolia's ranking towards unrelated wines. The rating displayed
// is Vivino's pooled wine-level average across vintages either way.
function buildSearchName(name: string, subtitle: string): string {
  const withoutVintage = subtitle.includes(',')
    ? subtitle.slice(0, subtitle.lastIndexOf(',')).trim()
    : subtitle.trim()

  return VINTAGE_ONLY.test(withoutVintage)
    ? name.trim()
    : `${name} ${withoutVintage}`.trim()
}

function extractProductId(url: string): null | string {
  return /-(\d+)\/?$/.exec(url)?.[1] ?? null
}

function getCardHref(card: Element): string {
  return getCardLink(card)?.getAttribute('href') ?? ''
}

function getCardLink(card: Element): Element | null {
  return card.matches(CARD_LINK_SELECTOR)
    ? card
    : card.querySelector(CARD_LINK_SELECTOR)
}

// Reads the packaging type from the format line under the product title, which
// reads "{packaging} · {volume} · {alcohol} % vol." — e.g. "Flaska", "Magnum",
// "Bag-in-Box". Anchored on the alcohol content, which is always present.
function getPackagingDescriptor(main: HTMLElement): null | string {
  const volumeLeaf = Array.from(main.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && /%\s*vol\.?/i.test(el.textContent)
  )
  if (!volumeLeaf) {
    return null
  }

  let formatLine: HTMLElement | null = null
  let node: HTMLElement | null = volumeLeaf as HTMLElement
  for (let i = 0; i < 4 && node; i++) {
    const text = node.textContent
    if (/[·•]/.test(text) && /\d/.test(text) && text.length < 80) {
      formatLine = node
      break
    }
    node = node.parentElement
  }
  // No compact format line near the alcohol content (products with a packaging
  // dropdown only render "{alcohol} % vol."). Never fall back to a larger
  // container — its text can contain words like "fatkaraktär" that
  // false-match the non-bottle list.
  if (!formatLine) {
    return null
  }

  const firstSegment = formatLine.textContent
    .split(/[·•]/)[0]
    .trim()
    .toLowerCase()
  return firstSegment ? firstSegment : null
}

// Systembolaget embeds the data of the initially loaded page in Next.js'
// __NEXT_DATA__ script; "packagingLevel1" is the packaging name ("Flaska",
// "Box", …), "producerName" the producer and "country" the origin. A product
// page carries its own product; a list page carries none at all (/sortiment/
// ships CMS content and fetches its products client-side), which is why a card
// falls back to its own text for everything. Index whatever is there and only
// trust an entry that matches the product being asked about — SPA navigations
// don't refresh the script.
let pageDataCache: null | { map: Map<string, PageProduct>; raw: string } = null

function getPackagingFromPageData(productId: string): null | string {
  return getProductFromPageData(productId)?.packaging ?? null
}

function getProductFromPageData(productId: string): null | PageProduct {
  const raw = document.getElementById('__NEXT_DATA__')?.textContent
  if (!raw) {
    return null
  }

  if (pageDataCache?.raw !== raw) {
    pageDataCache = { map: buildProductMap(raw), raw }
  }
  return pageDataCache.map.get(productId) ?? null
}

function getSelectedPackaging(main: HTMLElement): null | string {
  for (const el of main.querySelectorAll('select, [role="combobox"]')) {
    // The dropdown's hidden <select> has no options until the app hydrates,
    // so the selected option can be undefined despite its non-nullish type.
    const source = el instanceof HTMLSelectElement ? el.selectedOptions[0] : el
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const text = source?.textContent.trim().toLowerCase() ?? ''
    if (/\d\s*(cl|l|ml)\b/.test(text)) {
      return text
    }
  }
  return null
}

// Products sold in several packagings replace the static format line with a
// dropdown whose selected value reads "{packaging}, {volume} ml". Read the
// current selection; requiring a volume keeps unrelated dropdowns (store
// picker, quantity, …) from being mistaken for it.
// The packaging descriptor is short and already isolated ("Bag-in-Box",
// "PET-flaska", "box, 3000 ml"), so a plain substring test is enough — unlike
// the free-form card text NON_BOTTLE_PATTERN guards.
function isNonBottlePackaging(descriptor: string): boolean {
  return NON_BOTTLE_FORMATS.some((format) => descriptor.includes(format))
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
