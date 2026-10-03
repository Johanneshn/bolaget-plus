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

// Sourced from the manifest, which WXT generates from package.json's version.
const version = browser.runtime.getManifest().version

async function bindCount(
  labelId: string,
  buttonId: string,
  count: () => Promise<number>,
  clear: () => Promise<void>,
  describe: (count: number) => string
): Promise<void> {
  const label = document.getElementById(labelId)
  const button = document.getElementById(buttonId) as HTMLButtonElement | null
  if (!label || !button) return

  const render = async () => {
    const value = await count()
    label.textContent = describe(value)
    button.disabled = value === 0
  }
  button.addEventListener('click', () => {
    void clear().then(render)
  })
  await render()
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
