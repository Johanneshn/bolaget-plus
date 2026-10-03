import { describe, expect, it } from 'vitest'

import { compareTwoStrings } from '@/components/similarity'

// Expected scores recorded from string-similarity 4.0.4, which this replaces:
// the matching thresholds in api.ts were tuned against them.
describe('compareTwoStrings', () => {
  it.each([
    ['', '', 1],
    ['a', 'a', 1],
    ['a', 'b', 0],
    ['El Coto Crianza', 'El Coto Crianza', 1],
    ['El Coto Crianza', 'Crianza', 0.6666666666666666],
    ['Riesling Organic', 'R Riesling Organic', 0.9655172413793104],
    ['Prosecco Extra Dry', 'Mionetto Prosecco Extra Dry', 0.7894736842105263],
    ['Bread & Butter Pinot Noir', 'Pinot Noir', 0.5714285714285714],
    ['aaaa', 'aa', 0.5],
    ['Omnipollo Fatamorgana', 'Fatamorgana', 0.6896551724137931]
  ])('scores %j against %j as string-similarity did', (a, b, expected) => {
    expect(compareTwoStrings(a, b)).toBe(expected)
  })
})
