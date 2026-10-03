import { storage } from '@wxt-dev/storage'
import browser from 'webextension-polyfill'

// Products the user has marked as tasted, and beers imported from their
// Untappd check-in history. Kept on this device only, apart from the rating
// cache (and outside its "ratings:" prefix, so the sweep never touches them).
const TASTED_KEY_PREFIX = 'local:tasted:'
const UNTAPPD_BEERS_KEY = 'local:untappd-beers'
const EXPORT_FORMAT = 'bolaget-plus-tasted'

// Why a product counts as tasted: the user said so, or it is a beer they have
// checked in on Untappd.
export type TastedSource = 'self' | 'untappd'

export async function clearTasted(): Promise<void> {
  const keys = await tastedKeys()
  if (keys.length > 0) {
    await browser.storage.local.remove(keys)
  }
}

export async function clearUntappdBeers(): Promise<void> {
  await storage.removeItem(UNTAPPD_BEERS_KEY)
}

export async function countTasted(): Promise<number> {
  return (await tastedKeys()).length
}

export async function countUntappdBeers(): Promise<number> {
  return (await storage.getItem<number[]>(UNTAPPD_BEERS_KEY))?.length ?? 0
}

// The user's own tasted marks as a file they can keep or move to another
// browser. Untappd's history is left out: it already lives in Untappd.
export async function exportTasted(): Promise<string> {
  const items = await browser.storage.local.get(await tastedKeys())
  const prefix = TASTED_KEY_PREFIX.slice('local:'.length)
  const tasted = Object.entries(items).map(([key, date]) => ({
    date: typeof date === 'string' ? date : null,
    productId: key.slice(prefix.length)
  }))
  return JSON.stringify({ format: EXPORT_FORMAT, tasted, version: 1 }, null, 2)
}

export async function getTastedSource(
  productId: string,
  untappdLink?: null | string
): Promise<null | TastedSource> {
  if (await storage.getItem<string>(tastedKey(productId))) return 'self'
  const bid = untappdBeerId(untappdLink)
  if (bid === null) return null
  const beers = await storage.getItem<number[]>(UNTAPPD_BEERS_KEY)
  return beers?.includes(bid) ? 'untappd' : null
}

// Reads a file written by exportTasted and adds its marks to the ones already
// here (never removes any). Returns how many products it held; 0 means the
// file was not a Bolaget+ export.
export async function importTasted(text: string): Promise<number> {
  let entries: unknown
  try {
    const parsed = JSON.parse(text) as { format?: unknown; tasted?: unknown }
    if (parsed.format !== EXPORT_FORMAT) return 0
    entries = parsed.tasted
  } catch {
    return 0
  }
  if (!Array.isArray(entries)) return 0

  const items: Record<string, string> = {}
  const prefix = TASTED_KEY_PREFIX.slice('local:'.length)
  for (const entry of entries as unknown[]) {
    const { date, productId } = (entry ?? {}) as {
      date?: unknown
      productId?: unknown
    }
    if (typeof productId !== 'string' || !/^\d+$/.test(productId)) continue
    items[`${prefix}${productId}`] =
      typeof date === 'string' ? date : new Date().toISOString()
  }
  await browser.storage.local.set(items)
  return Object.keys(items).length
}

// Reads an Untappd data export (JSON or CSV — Untappd offers both) and stores
// the ids of every beer in it. Returns how many distinct beers it found;
// 0 means the file was not one Untappd produced.
export async function importUntappdExport(text: string): Promise<number> {
  const ids = parseUntappdExport(text)
  if (ids.length > 0) {
    await storage.setItem(UNTAPPD_BEERS_KEY, ids)
  }
  return ids.length
}

export function parseUntappdExport(text: string): number[] {
  const trimmed = text.trim()
  const ids = trimmed.startsWith('[')
    ? idsFromJson(trimmed)
    : idsFromCsv(trimmed)
  return [...new Set(ids)]
}

export async function setTasted(
  productId: string,
  tasted: boolean
): Promise<void> {
  if (tasted) {
    await storage.setItem(tastedKey(productId), new Date().toISOString())
  } else {
    await storage.removeItem(tastedKey(productId))
  }
}

function idsFromCsv(text: string): number[] {
  const [header, ...rows] = text.split(/\r?\n/)
  const column = splitCsvLine(header).indexOf('bid')
  if (column < 0) return []
  return rows.flatMap((row) => {
    const id = Number(splitCsvLine(row)[column])
    return Number.isInteger(id) && id > 0 ? [id] : []
  })
}

function idsFromJson(text: string): number[] {
  try {
    const checkins = JSON.parse(text) as unknown
    if (!Array.isArray(checkins)) return []
    return checkins.flatMap((checkin: unknown) => {
      const id = Number((checkin as null | { bid?: unknown })?.bid)
      return Number.isInteger(id) && id > 0 ? [id] : []
    })
  } catch {
    return []
  }
}

// Splits one CSV line, honouring quoted fields: beer and brewery names in an
// Untappd export carry commas of their own.
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields.map((value) => value.trim())
}

function tastedKey(productId: string): `local:${string}` {
  return `${TASTED_KEY_PREFIX}${productId}` as `local:${string}`
}

async function tastedKeys(): Promise<string[]> {
  const prefix = TASTED_KEY_PREFIX.slice('local:'.length)
  return Object.keys(await browser.storage.local.get(null)).filter((key) =>
    key.startsWith(prefix)
  )
}

// The beer id at the end of an Untappd link: untappd.com/b/<slug>/<bid>.
function untappdBeerId(link?: null | string): null | number {
  const match = link ? /untappd\.com\/b\/[^/]+\/(\d+)/.exec(link) : null
  return match ? Number(match[1]) : null
}
