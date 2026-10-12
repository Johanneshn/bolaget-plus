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
