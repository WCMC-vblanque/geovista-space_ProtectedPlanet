const EOX_SATELLITE_STYLE = {
  version: 8,
  sources: {
    'eox-sentinel2': {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      attribution: 'Sentinel-2 cloudless by <a href="https://eox.at">EOX IT Services GmbH</a> (CC BY-SA 4.0)'
    }
  },
  layers: [{ id: 'eox-sentinel2', type: 'raster', source: 'eox-sentinel2' }]
}

export const BASELAYERS_DEFAULT = [
  {
    id: 'terrain',
    name: 'Terrain',
    style: 'https://tiles.openfreemap.org/styles/liberty'
  },
  {
    id: 'satellite',
    name: 'Satellite',
    style: EOX_SATELLITE_STYLE
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