import { storage } from '@wxt-dev/storage'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'

// Rum ratings from RumX, whisky ratings from Connosr. Neither has a search the
// extension may use — RumX's Algolia key is locked to rumx.com, Connosr's
// search runs in its page — but both publish what is needed for open reading:
// a sitemap naming every product, and on each product page its community
// rating as schema.org JSON-LD. Both sites' robots.txt allow it, and RumX
// welcomes user-triggered fetches outright (rumx.com/llms.txt). So a lookup
// matches the product's name against the sitemap, read at most once a week,
// and then reads the one page it matched: what a visitor's browser would.
//
// Runs in the background script, which holds the optional host permissions
// the popup asks for when rum or whisky is switched on.

export interface SpiritEntry {
  // The product's name as its URL spells it, in words.
  name: string
  url: string
}

interface SpiritSite {
  parse: (xml: string) => SpiritEntry[]
  // The page for a search the user can make themselves when no match is sure.
  search: (query: string) => string
  sitemap: string
}

export const SPIRIT_SITES: Partial<Record<ProductType, SpiritSite>> = {
  [ProductType.Rum]: {
    parse: parseRumxSitemap,
    search: (query) =>
      `https://rumx.com/en/rums/?q=${encodeURIComponent(query)}`,
    sitemap: 'https://rumx.com/en/sitemap-rums.xml'
  },
  [ProductType.Whisky]: {
    parse: parseConnosrSitemap,
    search: (query) =>
      `https://www.connosr.com/search?q=${encodeURIComponent(query)}`,
    sitemap: 'https://www.connosr.com/sitemap/xml/products'
  }
}

// The hosts the popup asks for when rum or whisky is switched on.
export const SPIRIT_ORIGINS: Partial<Record<ProductType, string>> = {
  [ProductType.Rum]: 'https://rumx.com/*',
  [ProductType.Whisky]: 'https://www.connosr.com/*'
}

const INDEX_DAYS = 7
const PAGE_TIMEOUT_MS = 10_000
// Two products of one name (RumX lists some rums twice, once per producer
// record): both pages are read and the one more people rated wins. More than
// two is no longer one product.
const MAX_SAME_NAME = 2

// Words that say what kind of drink it is, or how it is sold, but not which
// one — Systembolaget writes "Single Malt 16 Years Old" where Connosr writes
// "16-year-old", and RumX keeps "rum" or "ron" in some names and not others.
const FILLER = new Set([
  'and',
  'blended',
  'de',
  'malt',
  'of',
  'old',
  'reviews',
  'rhum',
  'rom',
  'ron',
  'rum',
  'scotch',
  'single',
  'the',
  'whiskey',
  'whisky'
])
// "12 Years", "12-year-old", "3 Años", "15 yo" — written one way, "12yo", so
// that an age can be required to be the same.
const AGE = /\b(\d{1,2})[ -]?(?:years?|yrs?|yo|anos|ans|jahre)(?:[ -]old)?\b/g
// What marks a special edition in a name: a bottling decade or year, a size.
// A standard bottle on the shelf must not match one.
const EDITION = /^(?:\d{4}s?|bottled|\d+cl|\d+(?:\.\d+)?l|\d+ml|batch)$/

type Match =
  | { status: 'found'; urls: string[] }
  | { status: 'notFound' }
  | { status: 'uncertain' }

// Looks a product up: matches its name against the site's sitemap, then reads
// the matched page's rating. `fetchText` is the background's fetch.
export async function fetchSpiritRating(
  type: ProductType,
  productName: string,
  brand: string | undefined,
  fetchText: (url: string) => Promise<null | string> = fetchPage
): Promise<RatingResponse> {
  const site = SPIRIT_SITES[type]
  const notFound = {
    link: null,
    name: null,
    rating: 0,
    status: RatingResultStatus.NotFound,
    votes: 0
  }
  if (!site) return notFound
  const searchLink = site.search(productName)
  const uncertain: RatingResponse = {
    link: searchLink,
    name: null,
    rating: 0,
    status: RatingResultStatus.Uncertain,
    votes: 0
  }

  const index = await loadIndex(type, site, fetchText)
  if (!index) return { ...uncertain, transient: true }
  const match = matchSpirit(brand ?? productName, productName, index)
  if (match.status === 'notFound') return { ...notFound, link: searchLink }
  if (match.status === 'uncertain') return uncertain

  const pages = await Promise.all(match.urls.map((url) => fetchText(url)))
  const ratings = pages.flatMap((html, i) => {
    const rating = html ? parseRating(html) : null
    return rating ? [{ ...rating, url: match.urls[i] }] : []
  })
  // Every page failed: a network problem, not an answer.
  if (ratings.length === 0) return { ...uncertain, transient: true }
  const best = ratings.reduce((a, b) => (b.votes > a.votes ? b : a))
  return {
    link: best.url,
    name: best.name,
    rating: best.rating,
    scale: best.scale,
    status: RatingResultStatus.Found,
    votes: best.votes
  }
}

// The sitemap's products whose name answers to the product's. Strict on
// purpose — a wrong rating is worse than none:
//  - every word of the brand is in the hit, and its age is the same;
//  - every word of Systembolaget's title is in it, and it adds at most one —
//    words before the brand are a producer's name and do not count ("afd ron
//    barcelo gran anejo" for "Barceló Gran Añejo");
//  - it is not a special edition the title does not name ("bottled 1970s").
// Hits that tie and differ in more than a producer prefix are not one product:
// uncertain.
export function matchSpirit(
  brand: string,
  title: string,
  entries: SpiritEntry[]
): Match {
  const brandWords = words(brand)
  const titleWords = new Set(words(title))
  if (brandWords.length === 0) return { status: 'notFound' }
  const ages = ageWords(titleWords)

  let sawBrand = false
  const fits: { extra: number; key: string; url: string }[] = []
  for (const entry of entries) {
    const hit = words(entry.name)
    if (!brandWords.every((word) => hit.includes(word))) continue
    sawBrand = true
    if (!sameSet(ageWords(hit), ages)) continue
    if (hit.some((word) => EDITION.test(word) && !titleWords.has(word))) {
      continue
    }
    const fromBrand = hit.slice(hit.indexOf(brandWords[0]))
    if ([...titleWords].some((word) => !hit.includes(word))) continue
    const extra = fromBrand.filter((word) => !titleWords.has(word))
    if (extra.length > 1) continue
    fits.push({ extra: extra.length, key: fromBrand.join(' '), url: entry.url })
  }
  if (fits.length === 0) {
    return { status: sawBrand ? 'uncertain' : 'notFound' }
  }
  const fewest = Math.min(...fits.map((fit) => fit.extra))
  const best = fits.filter((fit) => fit.extra === fewest)
  const keys = new Set(best.map((fit) => fit.key))
  if (keys.size > 1 || best.length > MAX_SAME_NAME) {
    return { status: 'uncertain' }
  }
  return { status: 'found', urls: best.map((fit) => fit.url) }
}

// Connosr: https://www.connosr.com/lagavulin-16-year-old-whisky-reviews-147
export function parseConnosrSitemap(xml: string): SpiritEntry[] {
  return locations(xml).flatMap((url) => {
    const slug =
      /^https:\/\/www\.connosr\.com\/(.+)-whiske?y-reviews-\d+$/.exec(url)?.[1]
    return slug ? [{ name: slug.replace(/-/g, ' '), url }] : []
  })
}

// The name, rating and vote count a product page states in its schema.org
// Product JSON-LD; null when it states none.
export function parseRating(html: string): null | {
  name: string
  rating: number
  scale: number
  votes: number
} {
  for (const [, json] of html.matchAll(
    /<script[^>]*type="?application\/ld\+json"?[^>]*>([\s\S]*?)<\/script>/g
  )) {
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      continue
    }
    for (const item of jsonLdItems(data)) {
      const product = item as {
        '@type'?: unknown
        aggregateRating?: {
          bestRating?: unknown
          ratingCount?: unknown
          ratingValue?: unknown
          reviewCount?: unknown
        }
        name?: unknown
      }
      const aggregate = product.aggregateRating
      const types = [product['@type']].flat()
      if (!types.includes('Product') || !aggregate) continue
      const rating = Number(aggregate.ratingValue)
      const votes = Number(aggregate.ratingCount ?? aggregate.reviewCount)
      const scale = Number(aggregate.bestRating)
      if (!Number.isFinite(rating) || !Number.isFinite(votes)) continue
      return {
        name: typeof product.name === 'string' ? product.name : '',
        rating,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 5,
        votes
      }
    }
  }
  return null
}

// RumX: https://rumx.com/en/rums/3/diplomatico-reserva-exclusiva/
export function parseRumxSitemap(xml: string): SpiritEntry[] {
  return locations(xml).flatMap((url) => {
    const slug = /^https:\/\/rumx\.com\/en\/rums\/\d+\/([^/]+)\/?$/.exec(
      url
    )?.[1]
    return slug ? [{ name: slug.replace(/-/g, ' '), url }] : []
  })
}

// A name as the words it is matched on: lower case, accents and filler gone,
// ages written as "12yo".
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(AGE, (_, age: string) => ` ${String(Number(age))}yo `)
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !FILLER.has(word))
}

function ageWords(words: Iterable<string>): Set<string> {
  return new Set([...words].filter((word) => /^\d+yo$/.test(word)))
}

async function fetchPage(url: string): Promise<null | string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

// The site's products, from its sitemap: kept for a week, and read once for
// lookups made at the same time.
const loading = new Map<ProductType, Promise<null | SpiritEntry[]>>()
// The objects a JSON-LD block holds: one, a list, or — as RumX writes it —
// a "@graph" of them.
function jsonLdItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data.flatMap(jsonLdItems)
  if (typeof data !== 'object' || data === null) return []
  const graph = (data as { '@graph'?: unknown })['@graph']
  return graph === undefined ? [data] : jsonLdItems(graph)
}

async function loadIndex(
  type: ProductType,
  site: SpiritSite,
  fetchText: (url: string) => Promise<null | string>
): Promise<null | SpiritEntry[]> {
  const key = `local:spiritIndex:${type}` as const
  const [cached, meta] = await Promise.all([
    storage.getItem<SpiritEntry[]>(key),
    storage.getMeta<{ datetime?: string }>(key)
  ])
  const ageDays = meta.datetime
    ? (Date.now() - new Date(meta.datetime).getTime()) / 86_400_000
    : Infinity
  if (cached && ageDays < INDEX_DAYS) return cached

  let pending = loading.get(type)
  if (!pending) {
    pending = (async () => {
      try {
        const xml = await fetchText(site.sitemap)
        const entries = xml ? site.parse(xml) : []
        if (entries.length === 0) return cached
        await Promise.all([
          storage.setItem(key, entries),
          storage.setMeta(key, { datetime: new Date().toISOString() })
        ])
        return entries
      } finally {
        loading.delete(type)
      }
    })()
    loading.set(type, pending)
  }
  return await pending
}

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(([, url]) =>
    url.replace(/&amp;/g, '&')
  )
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item))
}
