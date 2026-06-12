export const BASELAYERS_DEFAULT = [
  {
    id: 'terrain',
    name: 'Terrain',
    style: 'https://tiles.openfreemap.org/styles/liberty'
  },
  {
    id: 'satellite',
    name: 'Satellite',
    // Requires a free MapTiler API key (maptiler.com) — replace YOUR_MAPTILER_KEY
    style: 'https://api.maptiler.com/maps/satellite/style.json?key=YOUR_MAPTILER_KEY'
  }
]
export const RTL_TEXT_PLUGIN_URL = 'https://unpkg.com/@maplibre/maplibre-gl-rtl-text@0.3.0/maplibre-gl-rtl-text.min.js'
export const MAP_OPTIONS_DEFAULT = {
  container: 'map-target',
  scrollZoom: false,
  attributionControl: false,
  preserveDrawingBuffer: true, // needed for PDF rendering
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