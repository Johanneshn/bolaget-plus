import {
  type ProductFacts,
  ProductType,
  RatingResultStatus
} from '@/@types/types'
import * as domUtils from '@/components/domUtils'
import * as productUtils from '@/components/productUtils'
import { enqueueListFetch, sourcePausedUntil } from '@/components/ratingService'
import { featuresEnabled } from '@/components/settings'
import { t, tf, tn } from '@/components/strings'
import { getTastedSource } from '@/components/tasted'
import {
  fetchAllProducts,
  findListSearch,
  isRated,
  isRecentSearch,
  MAX_PRODUCTS,
  rankTopList,
  tastedWinesOf,
  type TopListEntry,
  type TopListProduct,
  WARN_ABOVE_PRODUCTS
} from '@/components/topList'

// A "Topp 10" run from the button to the finished list: the panel's every
// state, keeping the list for the tab, bringing it back, and noticing when the
// list on screen is no longer the one it was made from. The search and the
// ranking are in topList.ts; the panel's markup in domUtils.ts.

// What the run needs from the page's list view, which content.ts owns.
export interface TopListHooks {
  featureEnabled: (type: ProductType) => Promise<boolean>
  hideTasted: () => boolean
  toggleHideTasted: () => void
}

// A finished run, kept in the tab's sessionStorage: the list's links are full
// page loads, and the user should find the list where they left it on coming
// back rather than run it all again.
interface SavedTopList {
  entries: TopListEntry[]
  // Lookups that never got an answer (rate limit, network, a paused site).
  failed: number
  // The page the list was made on, filters in the query string included.
  href: string
  listCount: number
  // Products looked up: in the range, of a type switched on, bottles if wine.
  looked: number
  // Until when the run was cut short by a paused rating site; 0 if it was not.
  pausedUntil: number
  savedAt: number
  // The search replayed, which carries the store the URL does not.
  searchUrl: string
  skipped: number
  sources: string[]
  // Products the lookup could not match for certain.
  uncertain: number
}

// The panel on screen and the list it was opened for.
interface Shown {
  // The list on screen is another one now, and the panel says so.
  changed?: boolean
  href: string
  listCount: null | number
  panel: HTMLElement
  saved?: SavedTopList
}

// Kept for a day at most: the ratings it holds are cached for as long.
const SAVED_FOR_MS = 24 * 60 * 60 * 1000
// Seconds a lookup takes on a first run: 300 ms of pacing plus the search.
const SECONDS_PER_LOOKUP = 0.45
const STORAGE_KEY = 'bolaget-plus:top-list:v2'

let shown: null | Shown = null
let activeRun: AbortController | null = null

// Brings a saved list back, follows the list on screen when it changes, and
// puts a panel the site's re-render removed back in place. Called whenever
// the list or the count above it may have changed.
export function checkTopList(hooks: TopListHooks): void {
  const list = findList()
  if (!shown) {
    if (list) restoreTopList(list, hooks)
    return
  }
  if (!shown.panel.isConnected && list) placePanel(shown.panel, list)
  const count = productUtils.getListCount()
  // The count goes missing while the site loads new results; that is not a
  // change yet.
  const changed =
    currentHref() !== shown.href ||
    (count !== null && count !== shown.listCount)
  if (changed && !shown.changed) {
    shown.changed = true
    activeRun?.abort()
    render(shown, hooks, {
      actions: [
        {
          label: t('topListRunNew'),
          onClick: () => {
            const current = findList()
            if (current) void runTopList(current, hooks)
          }
        }
      ],
      running: false,
      status: t('topListChanged')
    })
  } else if (!changed && shown.changed && shown.saved) {
    // Back on the list it was made for.
    shown.changed = false
    void showSaved(shown, hooks)
  }
}

// Shows the finished list again with "Dölj provade" switched.
export function refreshTopList(hooks: TopListHooks): void {
  if (shown?.saved && !shown.changed && !activeRun) {
    void showSaved(shown, hooks)
  }
}

// Ranks every product of the search behind the list, across all its pages:
// fetches the products, looks each one up through the same throttled queue
// the cards use (cached ones answer at once), and shows the best ten.
export async function runTopList(
  list: Element,
  hooks: TopListHooks
): Promise<void> {
  if (activeRun && !activeRun.signal.aborted) return
  if (!(await featuresEnabled.getValue())) return
  const run = new AbortController()
  activeRun = run
  domUtils.setTopListButtonBusy(true)
  saveTopList(null)
  const listCount = productUtils.getListCount()
  const current: Shown = {
    href: currentHref(),
    listCount,
    panel: openPanel(list, hooks)
  }
  shown = current
  try {
    await rankList(current, run, hooks)
  } finally {
    if (activeRun === run) {
      activeRun = null
      domUtils.setTopListButtonBusy(false)
    }
  }
}

function currentHref(): string {
  return location.pathname + location.search
}

// The list the panel goes with: the one after the list controls.
function findList(): Element | null {
  return document.querySelector('.bp-sort')?.nextElementSibling ?? null
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const time = date.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit'
  })
  if (date.toDateString() === new Date().toDateString()) return time
  const day = date.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short'
  })
  return `${day} ${time}`
}

function joinSources(sources: string[]): string {
  return sources.length > 0 ? sources.join(` ${t('and')} `) : 'Vivino'
}

function loadTopList(): null | SavedTopList {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<SavedTopList>
    return Array.isArray(saved.entries) && typeof saved.href === 'string'
      ? (saved as SavedTopList)
      : null
  } catch {
    return null
  }
}

// What a lookup is told about the product. Untappd matches on the name alone,
// so a beer or cider is asked without facts; a wine's producer and country
// confirm the Vivino match.
function lookupFacts(product: TopListProduct): ProductFacts {
  return product.type === ProductType.Wine ? product.facts : {}
}

function openPanel(list: Element, hooks: TopListHooks): HTMLElement {
  const panel = domUtils.openTopListPanel(list, {
    onClose: () => {
      // Closed on purpose: it should not come back with the list either.
      activeRun?.abort()
      saveTopList(null)
      shown = null
    },
    onToggleHideTasted: hooks.toggleHideTasted
  })
  return panel
}

function placePanel(panel: HTMLElement, list: Element) {
  const control = list.previousElementSibling
  ;(control?.classList.contains('bp-sort') ? control : list).before(panel)
}

async function rankList(
  current: Shown,
  run: AbortController,
  hooks: TopListHooks
): Promise<void> {
  // A closed panel or a changed list makes this run's late updates
  // meaningless.
  const live = () => !run.signal.aborted
  const retry = {
    label: t('topListRetry'),
    onClick: () => {
      const list = findList()
      if (list) void runTopList(list, hooks)
    }
  }
  const fail = (status: string) => {
    if (live())
      render(current, hooks, { actions: [retry], running: false, status })
  }

  render(current, hooks, {
    progress: 'unknown',
    running: true,
    status: t('topListReading')
  })
  if (current.listCount === null) {
    fail(t('topListNoSearch'))
    return
  }
  let found
  let searchUrl
  try {
    searchUrl = await findListSearch(current.listCount, run.signal)
    if (!searchUrl) {
      fail(t('topListNoSearch'))
      return
    }
    found = await fetchAllProducts(searchUrl, {
      confirmTotal: (total) => {
        if (total <= WARN_ABOVE_PRODUCTS) return Promise.resolve(true)
        if (!live()) return Promise.resolve(false)
        return new Promise<boolean>((resolve) => {
          const minutes = Math.max(
            1,
            Math.round((total * SECONDS_PER_LOOKUP) / 60)
          )
          render(current, hooks, {
            actions: [
              {
                label: t('topListRunAnyway'),
                onClick: () => {
                  resolve(true)
                }
              }
            ],
            running: false,
            status: tf('topListConfirm', {
              count: tn('products', total),
              minutes
            })
          })
          // Closing the panel instead ends the run here.
          run.signal.addEventListener(
            'abort',
            () => {
              resolve(false)
            },
            { once: true }
          )
        })
      },
      onProgress: (loaded, total) => {
        if (!live()) return
        render(current, hooks, {
          progress: 'unknown',
          running: true,
          status: tf('topListLoading', { done: loaded, total })
        })
      },
      signal: run.signal
    })
  } catch {
    fail(t('topListFailed'))
    return
  }
  if (!found || !live()) return
  if ('tooMany' in found) {
    render(current, hooks, {
      running: false,
      status: tf('topListTooMany', {
        count: tn('products', found.tooMany),
        max: MAX_PRODUCTS
      })
    })
    return
  }

  const rateable: TopListProduct[] = []
  for (const product of found.products) {
    // Same rules as a card: Vivino rates bottles only, and a product type
    // switched off in the popup is left alone.
    if (product.type === ProductType.Wine && !product.isBottle) continue
    if (!(await hooks.featureEnabled(product.type))) continue
    rateable.push(product)
  }
  const sources = [
    ...new Set(
      rateable.map((product) =>
        product.type === ProductType.Wine ? 'Vivino' : 'Untappd'
      )
    )
  ]

  const scope = tf('topListScope', {
    count: tn('products', current.listCount),
    source: joinSources(sources)
  })

  // Its own signal, so a paused rating site can stop the lookups without the
  // run counting as closed.
  const lookups = new AbortController()
  run.signal.addEventListener(
    'abort',
    () => {
      lookups.abort()
    },
    { once: true }
  )
  let done = 0
  let failed = 0
  let pausedUntil = 0
  const entries: TopListEntry[] = await Promise.all(
    rateable.map(async (product) => {
      const rating = await enqueueListFetch(
        product.productId,
        product.name,
        product.type,
        lookupFacts(product),
        { bulk: true, signal: lookups.signal }
      )
      done++
      if (rating.transient) {
        failed++
        // The site is rate limiting us: every lookup still queued would only
        // be turned away, and the attempt would prolong the ban.
        const until = sourcePausedUntil(product.type)
        if (until > 0) {
          pausedUntil = Math.max(pausedUntil, until)
          lookups.abort()
        }
      }
      if (live()) {
        render(current, hooks, {
          progress: { done, total: rateable.length },
          running: true,
          scope,
          status: tf(failed > 0 ? 'topListRatingFailed' : 'topListRating', {
            done,
            failed,
            total: rateable.length
          })
        })
      }
      return { product, rating }
    })
  )
  if (!live()) return

  const saved: SavedTopList = {
    // Only what the list can show is kept, and only the parts it shows: a
    // cached rating may carry a label image and the runners-up.
    entries: entries
      .filter(({ rating }) => isRated(rating))
      .map(({ product, rating }) => ({
        product,
        rating: {
          link: rating.link,
          name: rating.name,
          rating: rating.rating,
          status: rating.status,
          votes: rating.votes
        }
      })),
    failed,
    href: current.href,
    listCount: current.listCount,
    looked: rateable.length,
    pausedUntil,
    savedAt: Date.now(),
    searchUrl,
    skipped: found.products.filter(
      (product) => product.type === ProductType.Wine && !product.isBottle
    ).length,
    sources,
    uncertain: entries.filter(
      ({ rating }) =>
        rating.status === RatingResultStatus.Uncertain && !rating.transient
    ).length
  }
  saveTopList(saved)
  current.saved = saved
  await showSaved(current, hooks)
}

function render(
  current: Shown,
  hooks: TopListHooks,
  state: Omit<domUtils.TopListPanelState, 'hideTasted'>
) {
  // A panel replaced by a newer one is left as it is.
  if (shown !== current) return
  domUtils.renderTopList(current.panel, {
    ...state,
    hideTasted: hooks.hideTasted()
  })
}

// Brings a saved list back when its list is shown again: the same page, the
// same number of results, and the same search — which is what tells one store
// from another, as the store is not in the URL.
function restoreTopList(list: Element, hooks: TopListHooks) {
  const saved = loadTopList()
  if (
    saved?.href !== currentHref() ||
    saved.listCount !== productUtils.getListCount() ||
    !isRecentSearch(saved.searchUrl) ||
    Date.now() - saved.savedAt > SAVED_FOR_MS
  ) {
    return
  }
  shown = {
    href: saved.href,
    listCount: saved.listCount,
    panel: openPanel(list, hooks),
    saved
  }
  void showSaved(shown, hooks)
}

function saveTopList(saved: null | SavedTopList) {
  try {
    if (saved) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage full or blocked: the list just won't survive leaving the page.
  }
}

// Ranks a finished run for display, with what the user has tasted read fresh:
// a wine marked on its own page is tasted by the time the user comes back.
async function showSaved(current: Shown, hooks: TopListHooks) {
  const { saved } = current
  if (!saved) return
  const entries = await Promise.all(
    saved.entries.map(async (entry) => ({
      ...entry,
      tasted:
        (await getTastedSource(entry.product.productId, entry.rating.link)) !==
        null
    }))
  )
  const hideTasted = hooks.hideTasted()
  const ranked = rankTopList(entries, { hideTasted })
  const hidden = hideTasted ? tastedWinesOf(entries).size : 0
  const source = joinSources(saved.sources)

  const footnote = [
    tf('topListFootRated', {
      rated: entries.length,
      total: tn('products', saved.looked)
    }),
    saved.uncertain > 0
      ? tf('topListFootUncertain', { count: tn('products', saved.uncertain) })
      : null,
    saved.skipped > 0
      ? tf('topListFootSkipped', { count: saved.skipped })
      : null,
    hidden > 0 ? tn('topListFootTasted', hidden) : null,
    tf('topListFootTime', { time: formatTime(saved.savedAt) })
  ]
    .filter(Boolean)
    .join(' ')
  // Nothing fetched at all is not "no ratings": the list is not there.
  const noneFetched = saved.failed > 0 && saved.failed >= saved.looked
  const warning =
    saved.failed > 0
      ? [
          saved.pausedUntil > 0
            ? tf('topListPaused', {
                source,
                time: formatTime(saved.pausedUntil)
              })
            : null,
          noneFetched
            ? t('topListNoneFetched')
            : tf('topListIncomplete', { count: tn('products', saved.failed) })
        ]
          .filter(Boolean)
          .join(' ')
      : undefined
  const status =
    ranked.length > 0 || noneFetched
      ? undefined
      : entries.length === 0
        ? tf('topListEmpty', { source })
        : t('topListAllTasted')

  render(current, hooks, {
    actions: [
      {
        // Ratings found are cached, so a second run only asks again for the
        // ones that failed.
        label: t(saved.failed > 0 ? 'topListRetry' : 'topListRefresh'),
        onClick: () => {
          const list = findList()
          if (list) void runTopList(list, hooks)
        }
      }
    ],
    entries: noneFetched ? undefined : ranked,
    footnote: noneFetched
      ? tf('topListFootTime', { time: formatTime(saved.savedAt) })
      : footnote,
    running: false,
    scope: tf('topListScope', {
      count: tn('products', saved.listCount),
      source
    }),
    status,
    warning
  })
}
