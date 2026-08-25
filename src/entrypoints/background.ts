import browser from 'webextension-polyfill'

import {
  type ImageRequest,
  ProductType,
  type RatingRequest,
  type SearchConfigRequest
} from '@/@types/types'
import {
  fetchImageAsDataUrl,
  fetchRatingFromUntappd,
  fetchRatingFromVivino
} from '@/components/api'
import { removeExpiredRatings } from '@/components/ratingsCache'
import { getSearchConfig } from '@/components/searchConfigCache'

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

browser.runtime.onMessage.addListener(async (message: unknown) => {
  // On Chrome the content script queries Algolia itself, so the only thing it
  // needs from here is the credentials; beer and cider never reach the switch
  // below. Firefox blocks content-script requests to hosts outside
  // `permissions`, so that build routes the whole lookup through here instead.
  if (isSearchConfigMessage(message)) {
    return await getSearchConfig()
  }
  if (isImageMessage(message)) {
    return await fetchImageAsDataUrl(message.url)
  }
  if (!isGetRatingMessage(message)) {
    return
  }
  const { includeImage, producer, productName, query } = message
  switch (query) {
    case ProductType.Beer:
    case ProductType.Cider:
      return await fetchRatingFromUntappd(productName, await getSearchConfig())
    case ProductType.Wine:
      return await fetchRatingFromVivino(
        productName,
        includeImage ?? true,
        producer
      )
  }
})
