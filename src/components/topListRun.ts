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
  // The rating sites that paused the run, and until when.
  paused: Partial<Record<string, number>>
  savedAt: number
  // The search replayed, which carries the store the URL does not.
  searchUrl: string
  skipped: number
  sources: string[]
  // Products of a kind the popup has switched off.
  switchedOff: number
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

const SECTION_TYPES: Partial<Record<string, ProductType>> = {
  'cider-blanddrycker': ProductType.Cider,
  ol: ProductType.Beer,
  vin: ProductType.Wine
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
  if (!shown.panel.isConnected && list) {
    domUtils.placeTopListPanel(shown.panel, list)
  }
  const count = productUtils.getListCount()
  // The count goes missing while the site loads new results; that is not a
  // change yet.
  const changed =
    currentHref() !== shown.href ||
    (count !== null && count !== shown.listCount)
  if (changed && !shown.changed) {
    // Nothing was made for the old list (it failed, or found no search):
    // there is nothing to keep, and its message is about another list.
    if (!shown.saved && !activeRun) {
      shown.panel.remove()
      shown = null
      return
    }
    shown.changed = true
    endRun()
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
  } else if (!changed && shown.changed) {
    // Back on the list it was made for: show it again, or — when the change
    // cut the run short — nothing that talks of a new selection.
    shown.changed = false
    if (shown.saved) {
      void showSaved(shown, hooks)
    } else {
      shown.panel.remove()
      shown = null
    }
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
  if (activeRun) return
  // Claimed before the first await, so a double click starts one run.
  const run = new AbortController()
  activeRun = run
  domUtils.setTopListButtonBusy(true)
  if (!(await featuresEnabled.getValue())) {
    endRun()
    return
  }
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
    if (activeRun === run) endRun()
  }
}

// Whether Topp 10 is offered on this list page: not where nothing can be
// rated (spirits, alcohol-free, gift items), which would only fetch pages to
// say so.
export async function topListOffered(hooks: TopListHooks): Promise<boolean> {
  const section = /^\/sortiment\/([^/]+)/.exec(location.pathname)?.[1]
  if (
    section &&
    ['alkoholfritt', 'presentartiklar', 'sprit', 'tobak'].includes(section)
  ) {
    return false
  }
  // A section whose ratings are switched off in the popup: there would be
  // nothing to rank.
  const type = SECTION_TYPES[section ?? '']
  return type === undefined || (await hooks.featureEnabled(type))
}

// Whether a run is going: a Topp 10 button the site renders afresh mid-run is
// marked busy from the start.
export function topListRunning(): boolean {
  return activeRun !== null
}

// The page and its filters — not which page of results is shown ("&p=2") or
// how the site orders them: paging or re-sorting the list keeps the selection
// Topp 10 was made for.
function currentHref(): string {
  const params = new URLSearchParams(location.search)
  // The parameters the site itself treats as not filtering: paging and the
  // order of the list (its own sort, "sortera-pa" / "i-riktning").
  for (const param of [
    'p',
    'page',
    'size',
    'sortBy',
    'sortDirection',
    'sortera-pa',
    'i-riktning'
  ]) {
    params.delete(param)
  }
  const search = params.toString()
  return location.pathname + (search ? `?${search}` : '')
}

// Ends the run in progress, if any, and frees the button at once: a run whose
// last request hangs must not keep it disabled.
function endRun() {
  activeRun?.abort()
  activeRun = null
  domUtils.setTopListButtonBusy(false)
}

// The list the panel goes with: the one after the list controls.
function findList(): Element | null {
  return document.querySelector('.bp-sort')?.nextElementSibling ?? null
}

// A time of day: "14:30".
function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit'
  })
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
  return sources.join(` ${t('and')} `)
}

// The saved list, parsed once per change: it is checked on every update of
// the page while no panel is shown, and may hold a thousand products.
let loaded: { parsed: null | SavedTopList; raw: null | string } = {
  parsed: null,
  raw: null
}
function loadTopList(): null | SavedTopList {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === loaded.raw) return loaded.parsed
    // Read as unknown values: the tab may hold a list an older version saved.
    const saved = raw
      ? (JSON.parse(raw) as Partial<Record<keyof SavedTopList, unknown>>)
      : null
    const parsed =
      Array.isArray(saved?.entries) &&
      typeof saved.href === 'string' &&
      typeof saved.searchUrl === 'string' &&
      typeof saved.savedAt === 'number' &&
      typeof saved.paused === 'object' &&
      saved.paused !== null
        ? (saved as unknown as SavedTopList)
        : null
    loaded = { parsed, raw }
    return parsed
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
      endRun()
      saveTopList(null)
      shown = null
    },
    onToggleHideTasted: hooks.toggleHideTasted
  })
  return panel
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
    if (!searchUrl && live()) {
      // A click right after a filter change can come before the browser has
      // reported the site's new search; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      searchUrl = await findListSearch(current.listCount, run.signal)
    }
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

  // Same rules as a card: Vivino rates bottles only, and a product type
  // switched off in the popup is left alone.
  const enabled = new Map<ProductType, boolean>()
  for (const type of new Set(found.products.map((product) => product.type))) {
    enabled.set(type, await hooks.featureEnabled(type))
  }
  if (!live()) return
  // Products of a kind with ratings, whatever the popup says about them.
  const rateableKinds = found.products.filter(
    (product) => !(product.type === ProductType.Wine && !product.isBottle)
  )
  const rateable = found.products.filter(
    (product) =>
      enabled.get(product.type) &&
      !(product.type === ProductType.Wine && !product.isBottle)
  )
  const sources = [
    ...new Set(rateable.map((product) => sourceName(product.type)))
  ]

  const scope =
    sources.length > 0
      ? tf('topListScope', {
          count: tn('products', current.listCount),
          source: joinSources(sources)
        })
      : undefined

  // A signal per rating site, so a paused one stops its own lookups — not
  // the other site's, and without the run counting as closed. (The run is
  // live here, so the listener is not added to a signal already aborted.)
  const lookups = new Map(
    sources.map((source) => [source, new AbortController()])
  )
  run.signal.addEventListener(
    'abort',
    () => {
      for (const controller of lookups.values()) controller.abort()
    },
    { once: true }
  )
  let done = 0
  let failed = 0
  const paused: Partial<Record<string, number>> = {}
  let renderedAt = 0
  const entries: TopListEntry[] = await Promise.all(
    rateable.map(async (product) => {
      const source = sourceName(product.type)
      const rating = await enqueueListFetch(
        product.productId,
        product.name,
        product.type,
        lookupFacts(product),
        { bulk: true, signal: lookups.get(source)?.signal }
      )
      done++
      if (rating.transient) {
        failed++
        // The site is rate limiting us: every lookup still queued would only
        // be turned away, and the attempt would prolong the ban.
        const until = sourcePausedUntil(product.type)
        if (until > 0) {
          paused[source] = until
          lookups.get(source)?.abort()
        }
      }
      // Cached ratings answer all at once; one render a frame is plenty.
      const now = performance.now()
      if (live() && (now - renderedAt > 100 || done === rateable.length)) {
        renderedAt = now
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
    paused,
    savedAt: Date.now(),
    searchUrl,
    skipped: found.products.filter(
      (product) => product.type === ProductType.Wine && !product.isBottle
    ).length,
    sources,
    switchedOff: rateableKinds.length - rateable.length,
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
  // The list may have changed, or another run started, while the marks were
  // read; this list is not the one to show then.
  if (shown !== current || current.changed) return
  const hideTasted = hooks.hideTasted()
  const ranked = rankTopList(entries, { hideTasted })
  const hidden = hideTasted ? tastedWinesOf(entries).size : 0
  const source = joinSources(saved.sources)

  const footnote = [
    entries.length > 0
      ? tf('topListFootRated', {
          rated: entries.length,
          total: tn('products', saved.looked)
        })
      : null,
    saved.uncertain > 0
      ? tf('topListFootUncertain', { count: tn('products', saved.uncertain) })
      : null,
    saved.skipped > 0 ? tn('topListFootSkipped', saved.skipped) : null,
    hidden > 0 ? tn('topListFootTasted', hidden) : null,
    tf('topListFootTime', { time: formatTime(saved.savedAt) })
  ]
    .filter(Boolean)
    .join(' ')
  // Nothing fetched at all is not "no ratings": the list is not there.
  const noneFetched = saved.failed > 0 && saved.failed >= saved.looked
  // A pause long over (the list restored later) is not news any more.
  const stillPaused = Object.entries(saved.paused).filter(
    ([, until]) => until !== undefined && until > Date.now()
  )
  const warning =
    saved.failed > 0
      ? [
          ...stillPaused.map(([pausedSource, until = 0]) =>
            tf('topListPaused', {
              source: pausedSource,
              time: formatClock(until)
            })
          ),
          noneFetched
            ? t('topListNoneFetched')
            : tf('topListIncomplete', { count: tn('products', saved.failed) })
        ]
          .filter(Boolean)
          .join(' ')
      : undefined
  const status =
    saved.looked === 0
      ? t(saved.switchedOff > 0 ? 'topListSwitchedOff' : 'topListNothingToRank')
      : ranked.length > 0 || saved.failed > 0
        ? // With lookups missing, the warning says why the list is short.
          undefined
        : entries.length === 0
          ? tf('topListEmpty', { source })
          : t('topListAllTasted')
  // Asking again during a pause would only be turned away.
  const pausedTill = Math.max(0, ...stillPaused.map(([, until = 0]) => until))
  if (pausedTill > 0) {
    // Offered again, and the pause notice dropped, once the pause is over.
    setTimeout(
      () => {
        refreshTopList(hooks)
      },
      pausedTill - Date.now() + 1000
    )
  }
  const nothing = noneFetched || saved.looked === 0

  render(current, hooks, {
    actions: [
      {
        disabled: pausedTill > 0,
        // Ratings found are cached, so a second run only asks again for the
        // ones that failed.
        label:
          pausedTill > 0
            ? tf('topListRetryAt', { time: formatClock(pausedTill) })
            : t(saved.failed > 0 ? 'topListRetry' : 'topListRefresh'),
        onClick: () => {
          const list = findList()
          if (list) void runTopList(list, hooks)
        }
      }
    ],
    entries: nothing ? undefined : ranked,
    footnote: nothing ? undefined : footnote,
    running: false,
    scope: source
      ? tf('topListScope', { count: tn('products', saved.listCount), source })
      : undefined,
    status,
    warning
  })
}

function sourceName(type: ProductType): string {
  return type === ProductType.Wine ? 'Vivino' : 'Untappd'
}
