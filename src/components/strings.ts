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
