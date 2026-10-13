import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing'

import * as api from './api'
import { getSearchConfig, refreshSearchConfig } from './searchConfigCache'

const live = { appId: 'LIVEAPP', searchKey: 'live-key' }

describe('the cached Untappd credentials', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('are read once and then served from the cache', async () => {
    const read = vi
      .spyOn(api, 'readUntappdSearchConfig')
      .mockResolvedValue(live)

    await expect(getSearchConfig()).resolves.toEqual(live)
    await expect(getSearchConfig()).resolves.toEqual(live)
    expect(read).toHaveBeenCalledOnce()
  })

  it('are read again on a refresh', async () => {
    const read = vi
      .spyOn(api, 'readUntappdSearchConfig')
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({ ...live, searchKey: 'rotated' })

    await getSearchConfig()
    await expect(refreshSearchConfig()).resolves.toMatchObject({
      searchKey: 'rotated'
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  // A failed read used to cache the shipped fallback for a week.
  it('hold a fallback for an hour only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    const read = vi
      .spyOn(api, 'readUntappdSearchConfig')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(live)

    await expect(getSearchConfig()).resolves.toEqual(
      api.UNTAPPD_FALLBACK_CONFIG
    )
    vi.setSystemTime(new Date('2026-10-13T12:30:00Z'))
    await expect(getSearchConfig()).resolves.toEqual(
      api.UNTAPPD_FALLBACK_CONFIG
    )
    vi.setSystemTime(new Date('2026-10-13T13:01:00Z'))
    await expect(getSearchConfig()).resolves.toEqual(live)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
