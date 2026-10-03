# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: end-to-end.spec.ts >> visiting wine list page shows rating badges on product cards
- Location: e2e/end-to-end.spec.ts:146:1

# Error details

```
Error: browserType.launchPersistentContext: Executable doesn't exist at /opt/pw-browsers/chromium-1228/chrome-linux64/chrome
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     pnpm exec playwright install                           ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```

# Test source

```ts
  1  | import { test as base, type BrowserContext, chromium } from '@playwright/test'
  2  | import path from 'path'
  3  | 
  4  | const pathToExtension = path.resolve('.output/chrome-mv3')
  5  | 
  6  | export const test = base.extend<{
  7  |   context: BrowserContext
  8  |   extensionId: string
  9  | }>({
  10 |   // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure
  11 |   context: async ({}, use) => {
> 12 |     const context = await chromium.launchPersistentContext('', {
     |                     ^ Error: browserType.launchPersistentContext: Executable doesn't exist at /opt/pw-browsers/chromium-1228/chrome-linux64/chrome
  13 |       args: [
  14 |         `--disable-extensions-except=${pathToExtension}`,
  15 |         `--load-extension=${pathToExtension}`
  16 |       ],
  17 |       channel: 'chromium',
  18 |       headless: false
  19 |     })
  20 |     await use(context)
  21 |     await context.close()
  22 |   },
  23 |   extensionId: async ({ context }, use) => {
  24 |     // The tests always load the MV3 build, whose background is a service
  25 |     // worker; it may not have started yet when the fixture runs.
  26 |     const workers = context.serviceWorkers()
  27 |     const background =
  28 |       workers.length > 0
  29 |         ? workers[0]
  30 |         : await context.waitForEvent('serviceworker')
  31 | 
  32 |     const extensionId = background.url().split('/')[2]
  33 |     await use(extensionId)
  34 |   }
  35 | })
  36 | export const expect = test.expect
  37 | 
```