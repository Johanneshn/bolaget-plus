import { storage } from '@wxt-dev/storage'

export const featuresEnabled = storage.defineItem<boolean>(
  'sync:featuresEnabled',
  {
    fallback: true
  }
)

export const wineFeatureEnabled = storage.defineItem<boolean>(
  'sync:wineFeatureEnabled',
  {
    fallback: true
  }
)

export const beerFeatureEnabled = storage.defineItem<boolean>(
  'sync:beerFeatureEnabled',
  {
    fallback: true
  }
)

export const ciderFeatureEnabled = storage.defineItem<boolean>(
  'sync:ciderFeatureEnabled',
  {
    fallback: true
  }
)

// Off until switched on in the popup: their sites are only read once the
// user has granted the host permission the switch asks for.
export const rumFeatureEnabled = storage.defineItem<boolean>(
  'sync:rumFeatureEnabled',
  {
    fallback: false
  }
)

export const whiskyFeatureEnabled = storage.defineItem<boolean>(
  'sync:whiskyFeatureEnabled',
  {
    fallback: false
  }
)
