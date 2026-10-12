import type { GeneratedI18nStructure } from '#i18n'

import sv from '@/locales/sv.yml?raw'

// What the extension prints on systembolaget.se. The page is Swedish whatever
// the browser's language, so text injected into it is too: an English browser
// used to get "98172 votes" and "Link to Vivino" in the middle of a Swedish
// page. The popup is the extension's own UI and keeps following the browser
// through i18n.t.
//
// Read from the same sv.yml the extension's _locales are built from, so there
// is one copy of every string. The file is flat "key: value" lines.
export type MessageKey = keyof GeneratedI18nStructure

const messages = new Map(
  sv.split('\n').flatMap((line) => {
    const separator = line.indexOf(':')
    return separator > 0
      ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
      : []
  })
)

export function t(key: MessageKey): string {
  return messages.get(key) ?? key
}

const countFormat = new Intl.NumberFormat('sv-SE')

// A message with its {placeholders} filled in. Numbers are written the way the
// page around them writes them ("1 500").
export function tf(
  key: MessageKey,
  values: Partial<Record<string, number | string>>
): string {
  return fill(t(key), values)
}

// A message in the form for `count` — "1 vara | {count} varor" — filled in.
export function tn(
  key: MessageKey,
  count: number,
  values: Partial<Record<string, number | string>> = {}
): string {
  const forms = t(key).split(' | ')
  return fill(count === 1 ? forms[0] : forms[forms.length - 1], {
    ...values,
    count
  })
}

function fill(
  message: string,
  values: Partial<Record<string, number | string>>
): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name]
    if (value === undefined) return placeholder
    return typeof value === 'number' ? countFormat.format(value) : value
  })
}
