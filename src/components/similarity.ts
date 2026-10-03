// Sørensen–Dice similarity of two strings over their character bigrams, 0 to
// 1, whitespace ignored. A drop-in for string-similarity's compareTwoStrings,
// which is unmaintained; the matching rules in api.ts were tuned against its
// exact scores (including its blind spot for whitespace — see the "R
// Riesling Organic" note there), so this keeps its behaviour to the letter.
export function compareTwoStrings(first: string, second: string): number {
  const a = first.replace(/\s+/g, '')
  const b = second.replace(/\s+/g, '')

  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2)
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1)
  }

  let shared = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2)
    const count = bigrams.get(bigram) ?? 0
    if (count > 0) {
      bigrams.set(bigram, count - 1)
      shared++
    }
  }

  return (2 * shared) / (a.length + b.length - 2)
}
