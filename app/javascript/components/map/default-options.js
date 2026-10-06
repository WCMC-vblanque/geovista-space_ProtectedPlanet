const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services'

// Imagery with Esri boundaries/places labels on top. The label layer id
// contains 'boundary' so overlays are inserted beneath it (see mixin-layers).
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [`${ESRI_TILES}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION
    },
    'esri-reference': {
      type: 'raster',
      tiles: [`${ESRI_TILES}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19
    }
  },
  layers: [
    { id: 'satellite-imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'reference-boundary-places', type: 'raster', source: 'esri-reference' }
  ]
}

// Self-hosted style (PMTiles basemap) set at build time via .env.
// Falls back to OpenFreeMap (free, no key) until it is published.
export const BASELAYERS_DEFAULT = [
  {
    id: 'terrain',
    name: 'Terrain',
    style: process.env.BASEMAP_TERRAIN_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
  },
  {
    id: 'satellite',
    name: 'Satellite',
    style: process.env.BASEMAP_SATELLITE_STYLE_URL || SATELLITE_STYLE
  }
]
export const RTL_TEXT_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js'
export const MAP_OPTIONS_DEFAULT = {
  container: 'map-target',
  scrollZoom: false,
  attributionControl: false,
  canvasContextAttributes: { preserveDrawingBuffer: true }, // needed for PDF rendering
  zoom: 1.3,
  maxZoom: 10 // Maximum zoom where tiles are cached for the web-map service
  //bounds: [[-180, -90], [180, 90]],
  //boundingISO: ISO3,
  //boundingRegion; Name e.g. Europe,
}
export const CONTROLS_OPTIONS_DEFAULT = {
  showZoom: true,
  showCompass: false,
  showBaselayerControls: true,
  attributionLocation: 'bottom-left'
}
export const EMPTY_OPTIONS = {
  map: null,
  controls: null,
  baselayers: null
}