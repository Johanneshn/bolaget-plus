import { ProductType } from '@/@types/types'
import { type MessageKey } from '@/components/strings'

// Where each kind of product gets its rating, and how that rating is shown.
// One place for what used to be "wine → Vivino, everything else → Untappd"
// in a dozen spots.
export interface RatingSource {
  // Stars for wine and spirits, bottle caps for beer and cider.
  icons: 'caps' | 'stars'
  id: 'connosr' | 'rumx' | 'untappd' | 'vivino'
  linkLabel: MessageKey
  name: string
  // The top of the source's scale.
  scale: number
  searchLabel: MessageKey
}

const VIVINO: RatingSource = {
  icons: 'stars',
  id: 'vivino',
  linkLabel: 'linkToVivino',
  name: 'Vivino',
  scale: 5,
  searchLabel: 'searchAtVivino'
}

const UNTAPPD: RatingSource = {
  icons: 'caps',
  id: 'untappd',
  linkLabel: 'linkToUntappd',
  name: 'Untappd',
  scale: 5,
  searchLabel: 'searchAtUntappd'
}

const RUMX: RatingSource = {
  icons: 'stars',
  id: 'rumx',
  linkLabel: 'linkToRumx',
  name: 'RumX',
  scale: 10,
  searchLabel: 'searchAtRumx'
}

const CONNOSR: RatingSource = {
  icons: 'stars',
  id: 'connosr',
  linkLabel: 'linkToConnosr',
  name: 'Connosr',
  scale: 100,
  searchLabel: 'searchAtConnosr'
}

// A rating as a share of a 5-point scale: what the stars show, and what a list
// sorts on, so a 7,4/10 rum and a 3,9/5 wine are compared like for like.
export function onFivePointScale(rating: number, scale = 5): number {
  return (rating / scale) * 5
}

export function sourceFor(type: ProductType): RatingSource {
  switch (type) {
    case ProductType.Rum:
      return RUMX
    case ProductType.Whisky:
      return CONNOSR
    case ProductType.Wine:
      return VIVINO
    default:
      return UNTAPPD
  }
}
