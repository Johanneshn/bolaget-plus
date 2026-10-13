import { storage } from '@wxt-dev/storage'

import { UntappdSearchConfig } from '@/@types/types'

import { readUntappdSearchConfig, UNTAPPD_FALLBACK_CONFIG } from './api'

// Untappd rotates these rarely, so a week between reads is plenty; a key that
// is rejected before then invalidates the entry on the spot (see
// refreshSearchConfig).
const CACHE_EXPIRATION_DAYS = 7
// The shipped fallback stands in for a failed read: untappd.com is asked again
// within the hour rather than a week of beer lookups going out with a key that
// may be long dead.
const FALLBACK_EXPIRATION_DAYS = 1 / 24

const CACHE_KEY = 'local:untappdSearchConfig'

// A type alias rather than an interface: the storage meta API wants an
// index-signature-compatible record.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type SearchConfigMeta = {
  datetime?: string
  fallback?: boolean
}

export async function getSearchConfig(): Promise<UntappdSearchConfig> {
  const cached = await tryGetSearchConfig()
  if (cached) {
    return cached
  }

  const read = await readUntappdSearchConfig()
  const config = read ?? UNTAPPD_FALLBACK_CONFIG
  await Promise.all([
    storage.setItem(CACHE_KEY, config),
    storage.setMeta<SearchConfigMeta>(CACHE_KEY, {
      datetime: new Date().toISOString(),
      fallback: read === null
    })
  ])
  return config
}

// Called when a lookup comes back unauthorized, so the search is retried with
// what untappd.com ships now instead of a key that has since been rotated out.
export async function refreshSearchConfig(): Promise<UntappdSearchConfig> {
  await invalidateSearchConfig()
  return await getSearchConfig()
}

async function invalidateSearchConfig(): Promise<void> {
  await storage.removeItem(CACHE_KEY, { removeMeta: true })
}

async function tryGetSearchConfig(): Promise<null | UntappdSearchConfig> {
  const [config, metadata] = await Promise.all([
    storage.getItem<UntappdSearchConfig>(CACHE_KEY),
    storage.getMeta<SearchConfigMeta>(CACHE_KEY)
  ])
  if (!config || !metadata.datetime) {
    return null
  }

  const ageDays =
    (Date.now() - new Date(metadata.datetime).getTime()) / (1000 * 3600 * 24)
  const maxAge = metadata.fallback
    ? FALLBACK_EXPIRATION_DAYS
    : CACHE_EXPIRATION_DAYS
  if (ageDays > maxAge) {
    await invalidateSearchConfig()
    return null
  }

  return config
}
