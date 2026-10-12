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
