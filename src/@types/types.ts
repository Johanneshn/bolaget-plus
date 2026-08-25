export enum ProductType {
  Beer = 'beer',
  Cider = 'cider',
  Uncertain = 'uncertain',
  Wine = 'wine'
}

export enum RatingResultStatus {
  Found = 'found',
  NotFound = 'not_found',
  Uncertain = 'uncertain'
}

export type BeerResponse = RatingResponse & {
  brewery: null | string
}

// Asks the background script to download a Vivino label thumbnail as a data
// URL. images.vivino.com sends no CORS headers and the page CSP blocks
// hotlinking it, so the content script cannot do this itself.
export interface ImageRequest {
  type: 'vivinoImage'
  url: string
}

export interface RatingAlternative {
  imageDataUrl?: string
  link: string
  name: string
  rating: number
  votes: number
}

export interface RatingRequest {
  // List-page badges never render images, so they skip the thumbnail
  // download; product pages opt in.
  includeImage?: boolean
  // The producer Systembolaget names for the product, when its embedded page
  // data carries one. Vivino's index keys the producer separately from the
  // wine name, so this confirms a match the title alone cannot.
  producer?: string
  productId: string
  productName: string
  query: ProductType
}

export interface RatingResponse {
  alternatives?: RatingAlternative[]
  imageDataUrl?: string
  link: null | string
  name: null | string
  rating: number
  status: RatingResultStatus
  // Set when the result reflects a transient failure (rate limit, network
  // error) rather than a definitive lookup miss — never cached, so the next
  // visit retries instead of pinning a wrong answer for a day.
  transient?: boolean
  votes: number
}

// Asks the background script for Untappd's current Algolia credentials; the
// content script cannot read untappd.com itself (no CORS there).
export interface SearchConfigRequest {
  type: 'untappdSearchConfig'
}

export interface UntappdHit {
  beer_name: string
  beer_slug: string
  bid: number
  brewery_beer_name: string
  brewery_name: null | string
  rating_count: null | number
  rating_score: null | number
}

// The Algolia app/key pair Untappd's own search page uses. The app id also
// determines the search host (`{appId}-dsn.algolia.net`), so reading it at
// runtime keeps us working across a key rotation *and* an app migration.
export interface UntappdSearchConfig {
  appId: string
  searchKey: string
}

export interface UntappdSearchJSON {
  hits?: UntappdHit[]
}

export interface VivinoHit {
  hidden?: boolean
  id: number
  image?: {
    location?: null | string
    variations?: {
      label_medium?: string
    }
  }
  name: string
  statistics?: {
    ratings_average: null | number
    ratings_count: null | number
  }
  vintages?: {
    id: number
    statistics?: { ratings_count: null | number }
  }[]
  winery?: null | { name: null | string }
}

export interface VivinoSearchJSON {
  hits?: VivinoHit[]
  nbHits?: number
}
