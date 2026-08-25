// Systembolaget names a product's country in Swedish ("Spanien"), Vivino in
// English or as an ISO code ("Spain", "ES"). Both are folded to the same
// lower-case ISO alpha-2 code here so the two catalogues can be compared at
// all — an unknown spelling resolves to undefined, which the matching rules
// read as "country unknown" and never as a mismatch.
//
// Every wine-producing country Systembolaget lists, with the spellings each
// side uses. Extra English aliases cover the ones that are written more than
// one way ("Czechia"/"Czech Republic", "USA"/"United States").
const COUNTRY_NAMES: Record<string, string[]> = {
  am: ['armenien', 'armenia'],
  ar: ['argentina'],
  at: ['osterrike', 'austria'],
  au: ['australien', 'australia'],
  ba: ['bosnien hercegovina', 'bosnia and herzegovina', 'bosnia herzegovina'],
  be: ['belgien', 'belgium'],
  bg: ['bulgarien', 'bulgaria'],
  br: ['brasilien', 'brazil'],
  ca: ['kanada', 'canada'],
  ch: ['schweiz', 'switzerland'],
  cl: ['chile'],
  cn: ['kina', 'china'],
  cy: ['cypern', 'cyprus'],
  cz: ['tjeckien', 'czechia', 'czech republic'],
  de: ['tyskland', 'germany'],
  dk: ['danmark', 'denmark'],
  ee: ['estland', 'estonia'],
  eg: ['egypten', 'egypt'],
  es: ['spanien', 'spain'],
  fi: ['finland'],
  fr: ['frankrike', 'france'],
  gb: ['storbritannien', 'united kingdom', 'england', 'great britain'],
  ge: ['georgien', 'georgia'],
  gr: ['grekland', 'greece'],
  hr: ['kroatien', 'croatia'],
  hu: ['ungern', 'hungary'],
  ie: ['irland', 'ireland'],
  il: ['israel'],
  in: ['indien', 'india'],
  it: ['italien', 'italy'],
  jp: ['japan'],
  lb: ['libanon', 'lebanon'],
  lt: ['litauen', 'lithuania'],
  lu: ['luxemburg', 'luxembourg'],
  ma: ['marocko', 'morocco'],
  md: ['moldavien', 'moldova'],
  me: ['montenegro'],
  mk: ['makedonien', 'north macedonia', 'macedonia'],
  mx: ['mexiko', 'mexico'],
  nl: ['nederlanderna', 'netherlands', 'holland'],
  no: ['norge', 'norway'],
  nz: ['nya zeeland', 'new zealand'],
  pt: ['portugal'],
  ro: ['rumanien', 'romania'],
  rs: ['serbien', 'serbia'],
  ru: ['ryssland', 'russia'],
  se: ['sverige', 'sweden'],
  si: ['slovenien', 'slovenia'],
  sk: ['slovakien', 'slovakia'],
  tr: ['turkiet', 'turkey', 'turkiye'],
  ua: ['ukraina', 'ukraine'],
  us: ['usa', 'united states', 'united states of america', 'amerika'],
  uy: ['uruguay'],
  za: ['sydafrika', 'south africa']
}

const CODE_BY_NAME = new Map(
  Object.entries(COUNTRY_NAMES).flatMap(([code, names]) =>
    names.map((name) => [name, code] as const)
  )
)

// Resolves whatever a catalogue calls a country — a Swedish or English name,
// or an ISO alpha-2 code — to that code.
export function countryCode(
  value: null | string | undefined
): string | undefined {
  const normalized = normalizeName(value)
  if (!normalized) {
    return undefined
  }
  if (Object.hasOwn(COUNTRY_NAMES, normalized)) {
    return normalized
  }
  return CODE_BY_NAME.get(normalized)
}

// Names only. A list card's detail lines are free-form text, so a bare
// two-letter token there ("PET"-style abbreviations, units) must not be read
// as a country code.
export function countryCodeFromName(
  value: null | string | undefined
): string | undefined {
  const normalized = normalizeName(value)
  return normalized ? CODE_BY_NAME.get(normalized) : undefined
}

// Folds case, diacritics and punctuation so "Österrike", "Bosnien-Hercegovina"
// and "New Zealand" all reach the table in the shape it stores them.
function normalizeName(value: null | string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
