import { defineConfig } from 'wxt'
const isProduction = process.env.NODE_ENV === 'production'
// See https://wxt.dev/api/config.html
export default defineConfig({
  dev: {
    server: {
      port: 3000
    }
  },
  manifest: ({ browser }) => ({
    browser_specific_settings: {
      gecko: {
        id: 'broadcastdivers@test.com'
      },
      gecko_android: {
        strict_min_version: '120.0'
      }
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' https://images.vivino.com https://thumbs.vivino.com https://untappd.com${browser === 'firefox' ? ' https://*.algolia.net' : ''}${isProduction ? '' : ' ws://localhost:3000/'};`
    },
    default_locale: 'sv',
    // The stores show these as the listing's name and summary (the Chrome Web
    // Store takes its summary from nowhere else), in the visitor's language.
    description: '__MSG_extDescription__',

    host_permissions: [
      'https://www.systembolaget.se/*',
      // Vivino serves label/bottle thumbnails from separate image hosts
      'https://images.vivino.com/*',
      'https://thumbs.vivino.com/*',
      // Read by the background script for Untappd's current Algolia
      // credentials (the search page ships them in its own HTML).
      'https://untappd.com/*',
      // Both wine and beer/cider ratings come from Algolia indexes (Vivino's
      // WINES_prod, Untappd's beer). Chrome lets the content script query
      // those as plain CORS requests, so that build declares nothing here and
      // users never see the hostnames. Firefox routes content-script requests
      // through the extension's principal and blocks undeclared hosts whatever
      // CORS allows, so only that build has to ask.
      ...(browser === 'firefox' ? ['https://*.algolia.net/*'] : [])
    ],
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png'
    },
    name: '__MSG_extName__',
    permissions: [
      'storage',
      // The popup's share button copies the store link.
      'clipboardWrite',
      // Conditionally include permissions based on the build environment
      ...(isProduction ? [] : ['ws://localhost:3000/'])
    ]
  }),
  modules: ['@wxt-dev/auto-icons', '@wxt-dev/i18n/module'],
  srcDir: 'src',
  webExt: {
    startUrls: [
      'about:debugging#/runtime/this-firefox',
      'https://www.systembolaget.se/produkt/vin/onbrina-796501/',
      'chrome://extensions/'
    ]
  }
})
