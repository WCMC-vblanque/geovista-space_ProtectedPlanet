// Default styles: UN-approved boundaries/labels from UNEP-WCMC ArcGIS on
// top of OSM (terrain) or Esri World Imagery (satellite).
// Regenerate with `node lib/maps/build-basemap-styles.mjs`.
import TERRAIN_STYLE from './styles/terrain.json'
import SATELLITE_STYLE from './styles/satellite.json'

// Fallback without UN boundaries (OSM boundaries and names, not UN-compliant):
// const TERRAIN_STYLE = 'https://tiles.openfreemap.org/styles/positron'

// Either style can be replaced at build time via .env, e.g. by the
// self-hosted PMTiles style.
export const BASELAYERS_DEFAULT = [
  {
    id: 'terrain',
    name: 'Terrain',
    style: process.env.BASEMAP_TERRAIN_STYLE_URL || TERRAIN_STYLE
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