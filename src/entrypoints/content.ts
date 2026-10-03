import sentinel from 'sentinel-js'

import {
  ProductType,
  type RatingAlternative,
  type RatingResponse,
  RatingResultStatus
} from '@/@types/types'
import * as domUtils from '@/components/domUtils'
import {
  getPinnedRating,
  pinMatch,
  unpinMatch
} from '@/components/pinnedMatches'
import * as productUtils from '@/components/productUtils'
import { enqueueListFetch, fetchRating } from '@/components/ratingService'
import {
  beerFeatureEnabled,
  ciderFeatureEnabled,
  wineFeatureEnabled
} from '@/components/settings'
import { t } from '@/components/strings'
import { getTastedSource, setTasted } from '@/components/tasted'

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

    sentinel.on('h1', () => {
      void tryInsertOnProductPage()
    })
    void tryInsertOnProductPage()
    // Watched by its link rather than the tile itself: a tile renders as an
    // empty placeholder first and gains its link once the product has loaded.
    sentinel.on(productUtils.CARD_LINK_SELECTOR, (link) => {
      const card = productUtils.getCard(link)
      listCardObserver.observe(card)
      addListControls(card)
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
  await markCardTasted(card, productId)

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

  const rating = await enqueueListFetch(productId, name, productType, {
    // A card is on its own: the list page's embedded data holds no products,
    // so the card's own text is all there is — and the country is the part of
    // it the product page can be relied on to agree with.
    country: productUtils.getCardCountry(card) ?? undefined,
    producer: productUtils.getProducer(productId) ?? undefined
  })
  domUtils.replaceCardSpinner(card, spinner, productId, productType, rating)
  // A beer can count as tasted through the Untappd history, which needs the
  // matched beer's link.
  await markCardTasted(card, productId, rating.link)
  const list = card.closest('ul')
  if (list) domUtils.applyListView(list, listView)
}

async function markCardTasted(
  card: Element,
  productId: string,
  untappdLink?: null | string
) {
  const source = await getTastedSource(productId, untappdLink)
  domUtils.markCardTasted(card, source !== null)
  const list = card.closest('ul')
  if (list && listView.hideTasted) domUtils.applyListView(list, listView)
}

// The "Provad" toggle on a product page. Re-rendered after the rating
// arrives, since a beer may count as tasted through its Untappd match.
async function showTastedState(productId: string, untappdLink?: null | string) {
  const source = await getTastedSource(productId, untappdLink)
  domUtils.setTastedState(source, (tasted) => {
    void setTasted(productId, tasted).then(() =>
      showTastedState(productId, untappdLink)
    )
  })
}

// How result lists are shown (sorted, filtered). Kept for the tab's lifetime,
// so it carries over to the next page of results.
let listView: domUtils.ListView = {
  hideTasted: false,
  minRating: 0,
  sortByRating: false
}

function addListControls(card: Element) {
  const list = card.closest('ul')
  if (!list) return
  domUtils.ensureListControls(list, listView, (view) => {
    listView = view
    domUtils.ensureListControls(list, view, () => undefined)
    domUtils.applyListView(list, view)
    // Cards are only looked up once scrolled into view; sorting or filtering
    // needs them all. The fetch queue paces the lookups as usual.
    if (view.sortByRating || view.minRating > 0 || view.hideTasted) {
      for (const link of list.querySelectorAll(
        productUtils.CARD_LINK_SELECTOR
      )) {
        void handleListCard(productUtils.getCard(link))
      }
    }
  })
  domUtils.applyListView(list, listView)
}

function handleRating(
  productId: string,
  productType: ProductType,
  rating: RatingResponse
) {
  // The user can override the match by hand (pinnedMatches.ts) and undo that
  // again; both re-render in place, and list cards pick the choice up from
  // storage the next time they load.
  const onChoose = (pick: RatingAlternative) => {
    void pinMatch(productId, pick).then(async () => {
      const pinned = await getPinnedRating(productId)
      if (pinned) handleRating(productId, productType, pinned)
    })
  }
  const onUndo = () => {
    void unpinMatch(productId).then(() => tryInsertOnProductPage(true))
  }

  switch (rating.status) {
    case RatingResultStatus.Found:
      domUtils.setRating(
        productType,
        rating,
        rating.link,
        productUtils.getProductVintage(),
        { onChoose, onUndo }
      )
      return
    case RatingResultStatus.Uncertain:
      domUtils.setUncertain(productType, rating, onChoose)
      return
    default:
      domUtils.setMessage(t('noMatch'))
      return
  }
}

async function tryInsertOnProductPage(force = false) {
  if (!(await featuresEnabled.getValue())) return

  const productType = productUtils.getProductType()
  if (
    productType === ProductType.Uncertain ||
    !(await featureEnabled(productType))
  ) {
    return
  }

  domUtils.injectRatingContainer()
  const pageProductId = productUtils.getProductId()
  if (pageProductId) void showTastedState(pageProductId)
  if (productType == ProductType.Wine && !productUtils.isBottle()) {
    domUtils.setMessage(t('notOnBottle'))
    return
  }

  const productId = productUtils.getProductId()
  const productName = productUtils.getProductName()
  if (
    !productId ||
    !productName ||
    (!force && activeRequest?.productName === productName)
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
      {
        country: productUtils.getProductCountry(productId) ?? undefined,
        producer: productUtils.getProducer(productId) ?? undefined
      }
    )
    if (activeRequest !== request) return
    handleRating(productId, productType, rating)
    if (productType !== ProductType.Wine) {
      void showTastedState(productId, rating.link)
    }
  } catch {
    if (activeRequest === request) {
      domUtils.setMessage(t('noMatch'))
    }
  } finally {
    if (activeRequest === request) {
      activeRequest = null
    }
  }
}
