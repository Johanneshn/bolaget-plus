import { expect, test } from '@playwright/test'
import path from 'path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

import { geoBlockedLanding, RATING_TIMEOUT } from './systembolaget'

// The Firefox build, driven in a real Firefox. Playwright's own Firefox cannot
// load an extension, so this one goes through WebDriver BiDi (puppeteer-core),
// which installs the unpacked MV2 build as a temporary add-on. Worth having
// beside the Chromium smoke tests because the two builds differ where it
// matters: on Firefox every rating lookup goes through the background script,
// and page-context requests behave differently — bugs that a Chromium run
// cannot see.
//
// Needs a Firefox install: set FIREFOX_PATH, or the test is skipped saying so.
// Behind a proxy that re-terminates TLS, point FIREFOX_PROFILE at a profile
// directory whose cert9.db trusts its CA; HTTPS_PROXY is passed to Firefox.

const pathToExtension = path.resolve('.output/firefox-mv2')

let browser: Browser | undefined

test.beforeAll(async () => {
  const executablePath = process.env.FIREFOX_PATH
  test.skip(!executablePath, 'FIREFOX_PATH is not set: no Firefox to run.')
  browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath,
    extraPrefsFirefox: proxyPrefs(process.env.HTTPS_PROXY),
    headless: true,
    userDataDir: process.env.FIREFOX_PROFILE
  })
  await browser.installExtension(pathToExtension)
})

test.afterAll(async () => {
  await browser?.close()
})

test('Firefox: a wine page shows its Vivino rating', async () => {
  const page = await openPage(
    'https://www.systembolaget.se/produkt/vin/bread-butter-7667101/'
  )
  await page.waitForSelector('#rating-container-body', {
    timeout: RATING_TIMEOUT
  })
  const score = await page.$eval(
    '#rating-container-body',
    (element) => element.textContent
  )
  expect(score).toMatch(/\d,\d/)
})

test('Firefox: list cards get rating badges', async () => {
  const page = await openPage(
    'https://www.systembolaget.se/sortiment/ol/?land=Belgien&pris-till=30'
  )
  await page.waitForSelector('.bp-card-rating', { timeout: RATING_TIMEOUT })
})

// Opens a page with the age gate and cookie banner cleared, as
// systembolaget.ts does for Chromium; either gate may be missing.
async function openPage(url: string): Promise<Page> {
  if (!browser) throw new Error('Firefox did not start')
  const page = await browser.newPage()
  await page.setViewport({ height: 1000, width: 1280 })
  await page.goto(url, { waitUntil: 'load' })
  skipIfBlocked(page, url)
  for (const [selector, text] of [
    ['a', 'Jag har fyllt 20 år'],
    ['button', 'Acceptera alla kakor']
  ]) {
    await page
      .waitForFunction(
        (s, t) =>
          [...document.querySelectorAll(s)].some((e) =>
            e.textContent.includes(t)
          ),
        { timeout: 8_000 },
        selector,
        text
      )
      .catch(() => undefined)
    await page.evaluate(
      (s, t) => {
        const gate = [...document.querySelectorAll<HTMLElement>(s)].find((e) =>
          e.textContent.includes(t)
        )
        gate?.click()
      },
      selector,
      text
    )
  }
  await page.reload({ waitUntil: 'load' })
  skipIfBlocked(page, url)
  return page
}

function proxyPrefs(proxy: string | undefined): Record<string, unknown> {
  if (!proxy) return {}
  const { hostname, port } = new URL(proxy)
  return {
    'network.proxy.http': hostname,
    'network.proxy.http_port': Number(port),
    'network.proxy.ssl': hostname,
    'network.proxy.ssl_port': Number(port),
    'network.proxy.type': 1
  }
}

function skipIfBlocked(page: Page, requested: string) {
  const landed = geoBlockedLanding(page.url())
  test.skip(
    landed !== null,
    `Systembolaget redirected ${requested} to its geo-block page (${String(landed)}).`
  )
}
