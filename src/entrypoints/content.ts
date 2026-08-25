import sentinel from 'sentinel-js'

import {
  ProductType,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import * as domUtils from '@/components/domUtils'
import * as productUtils from '@/components/productUtils'
import { enqueueListFetch, fetchRating } from '@/components/ratingService'
import {
  beerFeatureEnabled,
  ciderFeatureEnabled,
  wineFeatureEnabled
} from '@/components/settings'

export default defineContentScript({
  main() {
    const listCardObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          listCardObserver.unobserve(entry.target)
          void handleListCard(entry.target)
        }
      },
      { rootMargin: '200px' }
    )

    //eslint-disable-next-line @typescript-eslint/no-misused-promises
    sentinel.on('h1', tryInsertOnProductPage)
    void tryInsertOnProductPage()
    sentinel.on('a[id^="tile:"]', (card) => {
      listCardObserver.observe(card)
    })
  },
  matches: ['*://*.systembolaget.se/*']
})

// The product whose rating is currently being fetched. Used to dedupe
// repeated sentinel callbacks for the same page and to discard responses
// that resolve after the user has navigated to another product.
let activeRequest: null | { productName: string } = null

async function featureEnabled(productType: ProductType): Promise<boolean> {
  if (
    (productType === ProductType.Wine &&
      !(await wineFeatureEnabled.getValue())) ||
    (productType === ProductType.Beer &&
      !(await beerFeatureEnabled.getValue())) ||
    (productType === ProductType.Cider &&
      !(await ciderFeatureEnabled.getValue()))
  ) {
    return false
  }
  return true
}

async function handleListCard(card: Element) {
  if (!(await featuresEnabled.getValue())) return
  const productType = productUtils.getCardProductType(card)
  if (
    productType === ProductType.Uncertain ||
    !(await featureEnabled(productType))
  ) {
    return
  }

  const productId = productUtils.getCardProductId(card)
  const name = productUtils.getCardName(card)
  if (!productId || !name) return

  // Vivino only rates bottled wine, same as on the product page — leave the
  // card untouched rather than badge a box with a bottle's rating.
  if (
    productType === ProductType.Wine &&
    !productUtils.isCardBottle(card, productId)
  ) {
    return
  }

  const spinner = domUtils.injectCardSpinner(card, productId)
  if (!spinner) return

  const rating = await enqueueListFetch(
    productId,
    name,
    productType,
    productUtils.getProducer(productId) ?? undefined
  )
  domUtils.replaceCardSpinner(card, spinner, productId, productType, rating)
}

function handleRating(productType: ProductType, rating: RatingResponse) {
  switch (rating.status) {
    case RatingResultStatus.Found:
      domUtils.setRating(productType, rating, rating.link)
      return
    case RatingResultStatus.Uncertain:
      domUtils.setUncertain(productType, rating)
      return
    default:
      domUtils.setMessage(i18n.t('noMatch'))
      return
  }
}

async function tryInsertOnProductPage() {
  if (!(await featuresEnabled.getValue())) return

  const productType = productUtils.getProductType()
  if (
    productType === ProductType.Uncertain ||
    !(await featureEnabled(productType))
  ) {
    return
  }

  domUtils.injectRatingContainer()
  if (productType == ProductType.Wine && !productUtils.isBottle()) {
    domUtils.setMessage(i18n.t('notOnBottle'))
    return
  }

  const productId = productUtils.getProductId()
  const productName = productUtils.getProductName()
  if (
    !productId ||
    !productName ||
    activeRequest?.productName === productName
  ) {
    return
  }

  const request = { productName }
  activeRequest = request
  try {
    domUtils.showLoadingSpinner()

    const rating = await fetchRating(
      productId,
      productName,
      productType,
      true,
      productUtils.getProducer(productId) ?? undefined
    )
    if (activeRequest !== request) return
    handleRating(productType, rating)
  } catch {
    if (activeRequest === request) {
      domUtils.setMessage(i18n.t('noMatch'))
    }
  } finally {
    if (activeRequest === request) {
      activeRequest = null
    }
  }
}
