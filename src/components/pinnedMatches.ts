import { storage } from '@wxt-dev/storage'

import {
  RatingAlternative,
  RatingResponse,
  RatingResultStatus
} from '@/@types/types'

// Matches the user picked by hand, when the automatic match was unsure or
// wrong. Kept apart from the daily rating cache (and outside its "ratings:"
// prefix, so the sweep never touches them): a choice made once should hold
// until the user undoes it. Keyed on the product number, like the cache, so a
// list card and its product page show the same pick.
const PIN_KEY_PREFIX = 'local:pinned:'

export async function getPinnedRating(
  productId: string
): Promise<null | RatingResponse> {
  const pick = await storage.getItem<RatingAlternative>(pinKey(productId))
  if (!pick) return null
  return {
    imageDataUrl: pick.imageDataUrl,
    link: pick.link,
    name: pick.name,
    pinned: true,
    rating: pick.rating,
    status: RatingResultStatus.Found,
    votes: pick.votes
  }
}

export async function pinMatch(
  productId: string,
  pick: RatingAlternative
): Promise<void> {
  await storage.setItem(pinKey(productId), pick)
}

export async function unpinMatch(productId: string): Promise<void> {
  await storage.removeItem(pinKey(productId))
}

function pinKey(productId: string): `local:${string}` {
  return `${PIN_KEY_PREFIX}${productId}` as `local:${string}`
}
