import browser from 'webextension-polyfill'

import {
  type ImageRequest,
  ProductType,
  type RatingRequest,
  type RatingResponse,
  RatingResultStatus,
  type SearchConfigRequest,
  type SpiritAccessRequest
} from '@/@types/types'
import {
  fetchImageAsDataUrl,
  fetchRatingFromUntappd,
  fetchRatingFromVivino
} from '@/components/api'
import { removeExpiredRatings } from '@/components/ratingsCache'
import {
  getSearchConfig,
  refreshSearchConfig
} from '@/components/searchConfigCache'
import { fetchSpiritRating, SPIRIT_ORIGINS } from '@/components/spirits'

export default defineBackground(() => {
  // The MV3 service worker starts on browser launch and on events, so this
  // sweep runs often enough to keep expired entries from accumulating — and it
  // throttles itself, since reading the whole cache on every restart is not
  // free.
  void removeExpiredRatings().catch(() => undefined)
})

function isGetRatingMessage(message: unknown): message is RatingRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'productName' in message &&
    'query' in message
  )
}

function isImageMessage(message: unknown): message is ImageRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'vivinoImage'
  )
}

function isSearchConfigMessage(
  message: unknown
): message is SearchConfigRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'untappdSearchConfig'
  )
}

function isSpiritAccessMessage(
  message: unknown
): message is SpiritAccessRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'spiritAccess'
  )
}

browser.runtime.onMessage.addListener(async (message: unknown) => {
  // On Chrome the content script queries Algolia itself, so the only thing it
  // needs from here is the credentials; beer and cider never reach the switch
  // below. Firefox blocks content-script requests to hosts outside
  // `permissions`, so that build routes the whole lookup through here instead.
  if (isSearchConfigMessage(message)) {
    return message.refresh
      ? await refreshSearchConfig()
      : await getSearchConfig()
  }
  if (isImageMessage(message)) {
    return await fetchImageAsDataUrl(message.url)
  }
  if (isSpiritAccessMessage(message)) {
    return await spiritAllowed(message.query)
  }
  if (!isGetRatingMessage(message)) {
    return
  }
  const { brand, country, includeImage, producer, productName, query } = message
  switch (query) {
    case ProductType.Beer:
    case ProductType.Cider:
      return await fetchRatingFromUntappd(
        productName,
        await getSearchConfig(),
        refreshSearchConfig
      )
    case ProductType.Rum:
    case ProductType.Whisky:
      return await lookUpSpirit(query, productName, brand)
    case ProductType.Wine:
      return await fetchRatingFromVivino(productName, includeImage ?? true, {
        country,
        producer
      })
  }
})

// Rum and whisky come from sites the extension may only read once the user
// has switched them on in the popup, which asks for the host permission.
// Without it — never granted, or revoked since — nothing is fetched.
async function lookUpSpirit(
  type: ProductType,
  productName: string,
  brand: string | undefined
): Promise<RatingResponse> {
  if (!(await spiritAllowed(type))) {
    return {
      link: null,
      name: null,
      rating: 0,
      status: RatingResultStatus.NotFound,
      transient: true,
      votes: 0
    }
  }
  return await fetchSpiritRating(type, productName, brand)
}

async function spiritAllowed(type: ProductType): Promise<boolean> {
  const origin = SPIRIT_ORIGINS[type]
  return (
    origin !== undefined &&
    (await browser.permissions.contains({ origins: [origin] }))
  )
}
