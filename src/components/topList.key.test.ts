// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchAllProducts } from './topList'

const SHIPPED_KEY = '8d39a7340ee7439f8b4c1e995c8f3e4a'
const ROTATED_KEY = '0123456789abcdef0123456789abcdef'
const searchUrl =
  'https://api-extern.systembolaget.se/sb-api-ecommerce/v2/productsearch/search?categoryLevel1=Vin'

describe('a rotated site API key', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.head.replaceChildren()
  })

  // The key ships with the extension; when Systembolaget rotates it, the
  // search would fail for every user until the next release.
  it("is read out of the site's own bundle and the search retried", async () => {
    // Not a script to run: the test only needs its src in the page.
    const script = document.createElement('script')
    script.type = 'text/plain'
    script.src = 'https://www.systembolaget.se/_next/static/chunks/env.js'
    document.head.append(script)

    const keysSent: (null | string)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input, init) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.includes('/_next/static/')) {
          return Promise.resolve(
            new Response(
              `x={NEXT_PUBLIC_API_KEY_APIM:"${ROTATED_KEY}",NEXT_PUBLIC_OTHER:"y"}`
            )
          )
        }
        const key = new Headers(init?.headers).get('Ocp-Apim-Subscription-Key')
        keysSent.push(key)
        return Promise.resolve(
          key === ROTATED_KEY
            ? new Response(
                JSON.stringify({ metadata: { docCount: 0 }, products: [] })
              )
            : new Response('', { status: 401 })
        )
      })
    )

    await expect(
      fetchAllProducts(searchUrl, { onProgress: vi.fn() })
    ).resolves.toEqual({ products: [] })
    expect(keysSent).toEqual([SHIPPED_KEY, ROTATED_KEY])
  })
})

describe('a search request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // On Firefox the page's fetch never sees the run's signal; a request that
  // hangs must still let a cancelled run end, or the button stays disabled.
  it('gives up as soon as the run is cancelled, even if the fetch hangs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
    )
    const run = new AbortController()
    const fetching = fetchAllProducts(searchUrl, {
      onProgress: vi.fn(),
      signal: run.signal
    })
    run.abort()
    await expect(fetching).rejects.toThrow()
  })

  // Firefox sends a content script's own fetch as the extension, which the
  // API host is not declared for; the page's fetch goes out as the page.
  it("goes through the page's own fetch where Firefox offers it", async () => {
    const pageFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ metadata: { docCount: 0 }, products: [] })
        )
      )
    )
    const ownFetch = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', ownFetch)
    vi.stubGlobal('cloneInto', <T>(value: T) => value)
    Object.assign(window, { wrappedJSObject: { fetch: pageFetch } })
    try {
      await fetchAllProducts(searchUrl, { onProgress: vi.fn() })
      expect(pageFetch).toHaveBeenCalledTimes(1)
      expect(ownFetch).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(window, 'wrappedJSObject')
    }
  })
})
