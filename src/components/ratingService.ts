import browser from 'webextension-polyfill'

import {
  ImageRequest,
  ProductType,
  RatingRequest,
  RatingResponse,
  RatingResultStatus,
  SearchConfigRequest,
  UntappdSearchConfig
} from '@/@types/types'

import { fetchRatingFromUntappd, fetchRatingFromVivino } from './api'
import { saveRating as cacheRating, tryGetRating } from './ratingsCache'

export async function fetchRating(
  productId: string,
  productName: string,
  type: ProductType,
  includeImage = false,
  producer?: string
): Promise<RatingResponse> {
  try {
    const ratingRequest = {
      includeImage,
      producer,
      productId,
      productName,
      query: type
    }
    const cachedRating = await tryGetRating(ratingRequest)
    // An entry cached by a list page has no thumbnails; when the product
    // page asks for images, refetch instead of serving the imageless copy.
    if (
      cachedRating &&
      !(includeImage && isMissingImages(cachedRating, type))
    ) {
      return cachedRating
    }
    const response = await fetchFromSource(ratingRequest)

    if (
      response.status !== RatingResultStatus.NotFound &&
      !response.transient
    ) {
      await cacheRating(ratingRequest, response)
    }
    return response
  } catch {
    return { status: RatingResultStatus.NotFound } as RatingResponse
  }
}

// Both lookups are Algolia queries, and Algolia serves any origin. On Chrome a
// content script's cross-origin fetch is an ordinary CORS request, so running
// them here needs no host permission at all — which is what keeps algolia.net
// out of the manifest and out of the install prompt. Firefox works
// differently: it routes content-script requests through the extension's
// principal and blocks any host missing from `permissions` whatever CORS says,
// so that build hands the whole lookup to the background instead.
async function fetchFromSource(
  ratingRequest: RatingRequest
): Promise<RatingResponse> {
  if (import.meta.env.FIREFOX) {
    return await browser.runtime.sendMessage<RatingRequest, RatingResponse>(
      ratingRequest
    )
  }

  if (ratingRequest.query === ProductType.Wine) {
    return await fetchRatingFromVivino(
      ratingRequest.productName,
      ratingRequest.includeImage ?? true,
      ratingRequest.producer,
      fetchImageViaBackground
    )
  }

  const config = await browser.runtime.sendMessage<
    SearchConfigRequest,
    UntappdSearchConfig
  >({ type: 'untappdSearchConfig' })
  return await fetchRatingFromUntappd(ratingRequest.productName, config)
}

// Label thumbnails stay a background job even on Chrome: images.vivino.com
// sends no CORS headers, and the page CSP blocks hotlinking them anyway.
async function fetchImageViaBackground(
  url: string | undefined
): Promise<string | undefined> {
  if (!url) {
    return undefined
  }
  return await browser.runtime.sendMessage<ImageRequest, string | undefined>({
    type: 'vivinoImage',
    url
  })
}

function isMissingImages(rating: RatingResponse, type: ProductType): boolean {
  if (type !== ProductType.Wine) {
    return false
  }
  if (rating.status === RatingResultStatus.Found) {
    return !rating.imageDataUrl
  }
  return rating.alternatives?.some((a) => !a.imageDataUrl) ?? false
}

const LIST_FETCH_DELAY_MS = 300

let listFetchQueue: Promise<undefined> = Promise.resolve(undefined)

export async function enqueueListFetch(
  productId: string,
  productName: string,
  type: ProductType,
  producer?: string
): Promise<RatingResponse> {
  // Cached ratings render immediately — only real network fetches go through
  // the throttled queue, so a revisited list page fills in instantly instead
  // of trickling one badge per delay tick.
  const cached = await tryGetRating({
    includeImage: false,
    producer,
    productId,
    productName,
    query: type
  }).catch(() => null)
  if (cached) {
    return cached
  }

  const task = listFetchQueue.then(
    () =>
      new Promise<RatingResponse>((resolve) => {
        setTimeout(() => {
          void fetchRating(productId, productName, type, false, producer).then(
            resolve
          )
        }, LIST_FETCH_DELAY_MS)
      })
  )
  listFetchQueue = task.then(() => undefined)
  return task
}
