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
import {
  fetchAllProducts,
  findListSearch,
  isRated,
  MAX_PRODUCTS,
  rankTopList,
  type TopListEntry,
  WARN_ABOVE_PRODUCTS,
  watchSiteSearches
} from '@/components/topList'

export default defineContentScript({
  main() {
    watchSiteSearches()
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
  domUtils.clearStaleCard(card, productId)
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
  // A lookup can finish after the tile has moved on to another product.
  if (productUtils.getCardProductId(card) !== productId) return
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
  sortBy: 'none'
}

function addListControls(card: Element) {
  const list = card.closest('ul')
  if (!list) return
  const isNewList = !list.previousElementSibling?.classList.contains('bp-sort')
  domUtils.ensureListControls(
    list,
    listView,
    (view, current) => {
      listView = view
      domUtils.ensureListControls(current, view, () => undefined)
      domUtils.applyListView(current, view)
      lookUpWholeList(current)
      // "Dölj provade" applies to the Topp 10 shown too.
      if (shownTopList) void showTopList(shownTopList.panel, shownTopList.saved)
    },
    (current) => {
      void runTopList(current)
    }
  )
  domUtils.applyListView(list, listView)
  // The view outlives the list it was chosen on: on the next page or a new
  // search, cards arrive with sorting or "Dölj provade" already on, so they
  // are looked up straight away rather than only once scrolled into view.
  if (listView.sortBy !== 'none' || listView.hideTasted) {
    if (isNewList) lookUpWholeList(list)
    else void handleListCard(card)
  }
  domUtils.setTopListButtonCount(list, productUtils.getListCount())
  if (isNewList) restoreTopList(list)
}

// The "Topp 10" run in progress, cancelled when the panel is closed or a new
// run starts.
let topListRun: AbortController | null = null

// A finished Topp 10, kept in the tab's sessionStorage. The list links to the
// product pages with full page loads, and the user should find the list where
// they left it on coming back — not run it all again.
interface SavedTopList {
  entries: TopListEntry[]
  listCount: null | number
  looked: number
  pathname: string
  skipped: number
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

// Cards are only looked up once scrolled into view; sorting or hiding tasted
// ones needs them all. The fetch queue paces the lookups as usual, and a card
// already badged returns at once.
function lookUpWholeList(list: Element) {
  if (listView.sortBy === 'none' && !listView.hideTasted) return
  for (const link of list.querySelectorAll(productUtils.CARD_LINK_SELECTOR)) {
    void handleListCard(productUtils.getCard(link))
  }
}

// Ranks every product of the search behind the list, across all its pages:
// fetches the products, looks each one up through the same throttled queue
// the cards use (cached ones answer at once), and shows the best ten.
async function runTopList(list: Element) {
  topListRun?.abort()
  const run = new AbortController()
  topListRun = run
  const panel = openTopListPanel(list, () => {
    run.abort()
  })
  // A closed panel or a newer run makes this one's late updates meaningless.
  const live = () => !run.signal.aborted

  domUtils.setTopListProgress(panel, `${t('topListFetching')}…`)
  const listCount = productUtils.getListCount()
  let found
  try {
    const searchUrl = await findListSearch(listCount, run.signal)
    if (!searchUrl) {
      if (live()) domUtils.setTopListStatus(panel, t('topListNoSearch'))
      return
    }
    found = await fetchAllProducts(searchUrl, {
      confirmTotal: (total) =>
        total <= WARN_ABOVE_PRODUCTS
          ? Promise.resolve(true)
          : new Promise((resolve) => {
              domUtils.setTopListConfirm(
                panel,
                `${String(total)} ${t('topListSlow')}`,
                () => {
                  resolve(true)
                }
              )
              // Closing the panel instead ends the run here.
              run.signal.addEventListener('abort', () => {
                resolve(false)
              })
            }),
      onProgress: (loaded, total) => {
        // The bar only counts the rating lookups, which are the slow part: it
        // used to fill up for these few page requests too and then start over
        // from nothing.
        if (!live()) return
        domUtils.setTopListProgress(
          panel,
          `${t('topListFetching')} ${String(loaded)} ${t('of')} ${String(total)}`
        )
      },
      signal: run.signal
    })
  } catch {
    if (live()) domUtils.setTopListStatus(panel, t('topListFailed'))
    return
  }
  if (!found || !live()) return
  if ('tooMany' in found) {
    domUtils.setTopListStatus(
      panel,
      `${String(found.tooMany)} ${t('topListTooMany')} ${String(MAX_PRODUCTS)}.`
    )
    return
  }

  const rateable = []
  for (const product of found.products) {
    // Same rules as a card: Vivino rates bottles only, and a product type
    // switched off in the popup is left alone.
    if (product.type === ProductType.Wine && !product.isBottle) continue
    if (!(await featureEnabled(product.type))) continue
    rateable.push(product)
  }

  let done = 0
  const entries: TopListEntry[] = await Promise.all(
    rateable.map(async (product) => {
      const rating = await enqueueListFetch(
        product.productId,
        product.name,
        product.type,
        product.facts,
        run.signal
      )
      done++
      if (live()) {
        domUtils.setTopListProgress(
          panel,
          `${t('topListRating')} ${String(done)} ${t('of')} ${String(rateable.length)}`,
          done,
          rateable.length
        )
      }
      return { product, rating }
    })
  )
  if (!live()) return
  const saved: SavedTopList = {
    // Only what the list can show is kept: it is stored for the tab.
    entries: entries.filter(({ rating }) => isRated(rating)),
    listCount,
    looked: rateable.length,
    pathname: location.pathname,
    skipped: found.products.filter(
      (product) => product.type === ProductType.Wine && !product.isBottle
    ).length
  }
  saveTopList(saved)
  shownTopList = { panel, saved }
  await showTopList(panel, saved)
}

const TOP_LIST_KEY = 'bolaget-plus:top-list'

// The Topp 10 on screen, for "Dölj provade" to re-rank.
let shownTopList: null | { panel: HTMLElement; saved: SavedTopList } = null

function loadTopList(): null | SavedTopList {
  try {
    const raw = sessionStorage.getItem(TOP_LIST_KEY)
    return raw ? (JSON.parse(raw) as SavedTopList) : null
  } catch {
    return null
  }
}

function openTopListPanel(list: Element, onClose?: () => void): HTMLElement {
  const panel = domUtils.openTopListPanel(list, () => {
    // Closed on purpose: it should not come back with the list either.
    saveTopList(null)
    shownTopList = null
    onClose?.()
  })
  return panel
}

// Brings a saved Topp 10 back when its list is shown again: same page, and
// the same number of results — another filter would almost always change it.
function restoreTopList(list: Element) {
  const saved = loadTopList()
  if (
    saved?.pathname !== location.pathname ||
    saved.listCount !== productUtils.getListCount() ||
    document.querySelector('.bp-top')
  ) {
    return
  }
  const panel = openTopListPanel(list)
  shownTopList = { panel, saved }
  void showTopList(panel, saved)
}

function saveTopList(saved: null | SavedTopList) {
  try {
    if (saved) sessionStorage.setItem(TOP_LIST_KEY, JSON.stringify(saved))
    else sessionStorage.removeItem(TOP_LIST_KEY)
  } catch {
    // Storage full or blocked: the list just won't survive leaving the page.
  }
}

// Ranks a finished run for display, with what the user has tasted read fresh.
async function showTopList(panel: HTMLElement, saved: SavedTopList) {
  const entries = await Promise.all(
    saved.entries.map(async (entry) => ({
      ...entry,
      tasted:
        (await getTastedSource(entry.product.productId, entry.rating.link)) !==
        null
    }))
  )
  const hidden = listView.hideTasted
    ? entries.filter((entry) => entry.tasted).length
    : 0
  const footnote = [
    `${String(entries.length)} ${t('of')} ${String(saved.looked)} ${t('topListFootRated')}`,
    saved.skipped > 0
      ? `${String(saved.skipped)} ${t('topListFootSkipped')}`
      : null,
    hidden > 0 ? `${String(hidden)} ${t('topListFootTasted')}` : null
  ]
    .filter(Boolean)
    .join(' ')
  domUtils.setTopListResults(
    panel,
    rankTopList(entries, { hideTasted: listView.hideTasted }),
    footnote
  )
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
