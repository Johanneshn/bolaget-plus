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

// What Systembolaget tells us about a product beyond its name. Neither field
// is always readable — a list card and a product page expose different things
// — so every rule that uses one must treat it as absent without complaint.
export interface ProductFacts {
  // ISO alpha-2, folded from the Swedish country name Systembolaget prints
  // ("Spanien" → "es"). Rules out a same-named wine from another country.
  country?: string
  // Vivino's index keys the producer separately from the wine name, so this
  // confirms a match the title alone cannot.
  producer?: string
}

export interface RatingAlternative {
  imageDataUrl?: string
  link: string
  name: string
  rating: number
  votes: number
}

export type RatingRequest = ProductFacts & {
  // List-page badges never render images, so they skip the thumbnail
  // download; product pages opt in.
  includeImage?: boolean
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
  // Vivino's per-vintage ratings for the matched wine, so the product page can
  // show the one on the shelf next to the pooled rating. Only sent with images
  // (product pages); a list badge shows the pooled rating alone.
  vintages?: VintageRating[]
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

// One vintage's Vivino rating. A rating of 0 means Vivino has too few ratings
// for that vintage to publish an average ("BelowThreshold").
export interface VintageRating {
  id: number
  rating: number
  votes: number
  year: string
}

// Vivino writes a hit's country in more than one shape depending on the index
// build — a nested object, a bare code, or a name — so it is read defensively.
export type VivinoCountry =
  | null
  | string
  | { code?: null | string; name?: null | string }

export interface VivinoHit {
  country?: VivinoCountry
  hidden?: boolean
  id: number
  image?: {
    location?: null | string
    variations?: {
      label_medium?: string
    }
  }
  name: string
  region?: null | {
    country?: VivinoCountry
    country_code?: null | string
    name?: null | string
  }
  statistics?: {
    ratings_average: null | number
    ratings_count: null | number
  }
  vintages?: {
    id: number
    statistics?: {
      ratings_average?: null | number
      ratings_count: null | number
    }
    year?: null | number | string
  }[]
  winery?: null | { name: null | string }
}

export interface VivinoSearchJSON {
  hits?: VivinoHit[]
  nbHits?: number
}
