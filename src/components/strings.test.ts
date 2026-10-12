import { describe, expect, it } from 'vitest'

import { tf, tn } from './strings'

describe('filled-in messages', () => {
  it('writes numbers the way the page does', () => {
    expect(tf('topListLoading', { done: 1500, total: 2000 })).toBe(
      'Hämtar varorna i urvalet – 1\u00a0500 av 2\u00a0000'
    )
  })

  it('picks the singular for one', () => {
    expect(tn('products', 1)).toBe('1 vara')
    expect(tn('products', 3)).toBe('3 varor')
    expect(tn('topListFootTasted', 1)).toBe('1 provad vara är dold.')
  })
})

describe('the message files', () => {
  const parse = (raw: string) =>
    new Map(
      raw.split('\n').flatMap((line) => {
        const separator = line.indexOf(':')
        return separator > 0
          ? [[line.slice(0, separator).trim(), line.slice(separator + 1)]]
          : []
      })
    )
  const placeholders = (message = '') =>
    [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

  // A placeholder missing in one language prints "{count}" on the page.
  it('use the same placeholders in Swedish and English', async () => {
    const sv = parse((await import('@/locales/sv.yml?raw')).default)
    const en = parse((await import('@/locales/en.yml?raw')).default)
    expect([...en.keys()].sort()).toEqual([...sv.keys()].sort())
    for (const [key, message] of sv) {
      expect(placeholders(en.get(key)), key).toEqual(placeholders(message))
      expect((en.get(key) ?? '').includes(' | '), key).toBe(
        message.includes(' | ')
      )
    }
  })
})
