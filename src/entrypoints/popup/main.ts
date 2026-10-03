import '@fontsource/young-serif/latin-400.css'
import browser from 'webextension-polyfill'

import {
  clearPinnedMatches,
  countPinnedMatches
} from '@/components/pinnedMatches'
import { clearRatings, countCachedRatings } from '@/components/ratingsCache'
import {
  beerFeatureEnabled,
  ciderFeatureEnabled,
  featuresEnabled,
  wineFeatureEnabled
} from '@/components/settings'
import {
  clearTasted,
  clearUntappdBeers,
  countTasted,
  countUntappdBeers,
  exportTasted,
  importTasted,
  importUntappdExport
} from '@/components/tasted'

// Sourced from the manifest, which WXT generates from package.json's version.
const version = browser.runtime.getManifest().version

async function bindCount(
  labelId: string,
  buttonId: string,
  count: () => Promise<number>,
  clear: () => Promise<void>,
  describe: (count: number) => string
): Promise<() => Promise<void>> {
  const label = document.getElementById(labelId)
  const button = document.getElementById(buttonId) as HTMLButtonElement | null
  if (!label || !button) return () => Promise.resolve()

  const render = async () => {
    const value = await count()
    label.textContent = describe(value)
    button.disabled = value === 0
  }
  button.addEventListener('click', () => {
    void clear().then(render)
  })
  await render()
  return render
}

// A file import behind one of the popup's "Importera" labels: Untappd's
// check-in history (JSON or CSV), or a list of tasted products exported from
// Bolaget+ on another browser.
function bindFileImport(
  inputId: string,
  importFile: (text: string) => Promise<number>,
  describe: (count: number) => string,
  render: () => Promise<void>
): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null
  const status = document.getElementById('shareStatus')
  // Firefox closes a popup as soon as a file picker opens, taking the import
  // with it. There, "Importera" opens this page in a tab instead, where the
  // picker works; the ?tab marker says which of the two this is.
  if (import.meta.env.FIREFOX && !location.search.includes('tab')) {
    input?.addEventListener('click', (event) => {
      event.preventDefault()
      void browser.tabs.create({
        url: browser.runtime.getURL('/popup.html?tab')
      })
      window.close()
    })
    return
  }
  input?.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    void file
      .text()
      .then(importFile)
      .then(async (count) => {
        if (status) status.textContent = describe(count)
        input.value = ''
        await render()
      })
  })
}

// Downloads the tasted list as a file to keep or import elsewhere.
function bindTastedExport(): void {
  document.getElementById('exportTasted')?.addEventListener('click', () => {
    void exportTasted().then((json) => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      )
      link.download = `bolaget-plus-provade-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      // Firefox can still be reading the blob when click() returns; revoking
      // it at once can fail the download.
      setTimeout(() => {
        URL.revokeObjectURL(link.href)
      }, 10_000)
    })
  })
}

async function initialize(): Promise<void> {
  showVersion()
  await setupToggles()
  await setupStoredData()

  const shareButton = document.getElementById('shareButton')
  if (shareButton) {
    shareButton.addEventListener('click', () => {
      void shareExtension()
    })
  }
}

// What the extension keeps on this device: the day-long rating cache, and the
// matches the user picked by hand. Either can be cleared from here — the cache
// to force fresh lookups, the picks to hand every product back to automatic
// matching.
async function setupStoredData(): Promise<void> {
  await bindCount(
    'ratingsCount',
    'clearRatings',
    countCachedRatings,
    clearRatings,
    (count) =>
      `${count.toLocaleString('sv-SE')} ${count === 1 ? 'sparat betyg' : 'sparade betyg'}`
  )
  await bindCount(
    'pinsCount',
    'clearPins',
    countPinnedMatches,
    clearPinnedMatches,
    (count) =>
      `${count.toLocaleString('sv-SE')} ${count === 1 ? 'eget val' : 'egna val'}`
  )
  const renderTasted = await bindCount(
    'tastedCount',
    'clearTasted',
    countTasted,
    clearTasted,
    (count) => `${count.toLocaleString('sv-SE')} provade`
  )
  const renderUntappd = await bindCount(
    'untappdCount',
    'clearUntappd',
    countUntappdBeers,
    clearUntappdBeers,
    (count) => `${count.toLocaleString('sv-SE')} öl från Untappd`
  )
  bindFileImport(
    'untappdFile',
    importUntappdExport,
    (count) =>
      count > 0
        ? `${count.toLocaleString('sv-SE')} öl importerade`
        : 'Filen är ingen export från Untappd',
    renderUntappd
  )
  bindFileImport(
    'tastedFile',
    importTasted,
    (count) =>
      count > 0
        ? `${count.toLocaleString('sv-SE')} provade produkter importerade`
        : 'Filen är ingen lista från Bolaget+',
    renderTasted
  )
  bindTastedExport()
}

async function setupToggles(): Promise<void> {
  const enabledToggle = document.getElementById('enabled') as HTMLInputElement
  enabledToggle.checked = await featuresEnabled.getValue()
  enabledToggle.addEventListener('change', () => {
    void featuresEnabled.setValue(enabledToggle.checked)
    syncCategoryToggles(enabledToggle.checked)
  })

  const wineToggle = document.getElementById('wine') as HTMLInputElement
  wineToggle.checked = await wineFeatureEnabled.getValue()
  wineToggle.addEventListener('change', () => {
    void wineFeatureEnabled.setValue(wineToggle.checked)
  })

  const beerToggle = document.getElementById('beer') as HTMLInputElement
  beerToggle.checked = await beerFeatureEnabled.getValue()
  beerToggle.addEventListener('change', () => {
    void beerFeatureEnabled.setValue(beerToggle.checked)
  })

  syncCategoryToggles(enabledToggle.checked)

  const ciderToggle = document.getElementById('cider') as HTMLInputElement
  ciderToggle.checked = await ciderFeatureEnabled.getValue()
  ciderToggle.addEventListener('change', () => {
    void ciderFeatureEnabled.setValue(ciderToggle.checked)
  })
}

async function shareExtension(): Promise<void> {
  const status = document.getElementById('shareStatus')
  const extensionUrl = 'https://addons.mozilla.org/firefox/addon/bolaget-plus/'
  try {
    await navigator.clipboard.writeText(extensionUrl)
    if (status) status.textContent = 'Länken är kopierad'
  } catch {
    if (status) status.textContent = 'Kunde inte kopiera länken'
  }
  setTimeout(() => {
    if (status) status.textContent = ''
  }, 2500)
}

function showVersion(): void {
  const versionLabel = document.querySelector('.version')
  if (versionLabel) {
    versionLabel.textContent = `v${version}`
  }
}

// The category switches do nothing while everything is off; say so instead of
// leaving them looking live.
function syncCategoryToggles(enabled: boolean): void {
  for (const id of ['wine', 'beer', 'cider']) {
    const toggle = document.getElementById(id) as HTMLInputElement | null
    if (toggle) toggle.disabled = !enabled
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void initialize()
})
