#!/usr/bin/env node
// Builds the candidate MapLibre basemap styles for the comparison playground
// (public/maps/compare) into public/maps/preview/.
//
// UN boundaries/labels come from the UNEP-WCMC ArcGIS vector tile service
// Hosted/UN_Boundaries_Labels. Colours follow the current Mapbox style
// "UNEP Basemap (APPROVED - 14/04/21) - Faint".
//
// Usage (Node 18+): cd lib/maps && npm ci && npm run build
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'
import { baseLayers, labelLayers, restyleUnBoundaries, restyleUnLabels, tuneV2 } from './mapbox-replica.mjs'
import { COUNTRY_LABEL_SOURCE, countryLabelLayers, countryLabelPoints } from './country-labels.mjs'
import { capitalLabels, capitalMarker, curvedSeaLabels, hillshadeLayer, SEA_LABEL_SOURCE, seaLabelSource, landcoverLayer, LANDCOVER_SOURCE, outdoorLayers, outdoorUnBoundaries, outdoorUnLabels, protectedLandLayers, withTerrain } from './unep-outdoor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PREVIEW_DIR = join(ROOT, 'public/maps/preview')

const POSITRON = 'https://tiles.openfreemap.org/styles/positron'
const UN_VTS = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/UN_Boundaries_Labels/VectorTileServer'
const WCMC_TEMPLATE_VTS = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/Basemap_Template/VectorTileServer'
const UN_CLEARMAP = 'https://geoservices.un.org/arcgis/rest/services'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const UN_ATTRIBUTION = 'Boundaries: <a href="https://www.un.org/geospatial">UN Geospatial</a>, UNEP-WCMC'
const CLEARMAP_ATTRIBUTION = 'Produced by <a href="https://geoportal.un.org/arcgis/home/item.html?id=541557fd0d4d42efb24449be614e6887">United Nations Geospatial</a>'
// Replaced at runtime by the playground's "PMTiles URL" field
const PMTILES_PLACEHOLDER = '__PMTILES_URL__'
// Tile URL template of the same PMTiles (for sources with their own maxzoom)
const PMTILES_TILES_PLACEHOLDER = '__PMTILES_TILES__'

// OSM layers that conflict with UN boundaries and names
const OSM_LAYERS_TO_DROP = /^(boundary_|label_country|label_state|label_other)/
const PROTOMAPS_LAYERS_TO_DROP = /^(boundaries|places_country|places_region)/
const FONT = ['Noto Sans Regular'] // provided by both OpenFreeMap and Protomaps glyphs
const FAINT = { land: 'hsl(35, 25%, 93%)', water: '#b7d3db', relief: 'hsl(65, 35%, 21%)' }

const getJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const rasterStyle = (name, tiles, attribution, maxzoom = 19) => ({
  version: 8,
  name,
  sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution } },
  layers: [{ id: 'base', type: 'raster', source: 'base' }]
})

// ArcGIS VectorTileServer root.json uses relative URLs; make them absolute.
async function arcgisVts (base) {
  const [meta, style] = await Promise.all([getJson(`${base}?f=json`), getJson(`${base}/resources/styles/root.json`)])
  style.sources = { esri: { type: 'vector', tiles: [`${base}/tile/{z}/{y}/{x}.pbf`], maxzoom: meta.maxLOD, attribution: UN_ATTRIBUTION } }
  style.glyphs = `${base}/resources/fonts/{fontstack}/{range}.pbf`
  style.sprite = `${base}/resources/sprites/sprite`
  return style
}

// UN boundary lines and labels from WCMC ArcGIS. Line ids contain 'boundary'
// so PP overlays go beneath them (mixins/mixin-layers.js).
async function unParts () {
  const un = await arcgisVts(UN_VTS)
  const keep = un.layers.filter(l => l.type !== 'circle' && l['source-layer'] !== 'Major_Lakes')
  return {
    source: un.sources.esri,
    lines: keep.filter(l => l.type === 'line').map(l => ({ ...l, id: `un-boundary-${l.id}`, source: 'un' })),
    labels: keep.filter(l => l.type === 'symbol').map(l => ({ ...l, id: `un-label-${l.id}`, source: 'un' }))
  }
}

// Adds UN boundaries beneath the first label and UN labels on top
async function withUn (style, labelPaint = {}) {
  const un = await unParts()
  const lines = un.lines
  const labels = un.labels.map(l => ({ ...l, layout: { ...l.layout, 'text-font': FONT }, paint: { ...l.paint, ...labelPaint } }))
  style.sources.un = un.source
  const firstSymbol = style.layers.findIndex(l => l.type === 'symbol')
  style.layers.splice(firstSymbol === -1 ? style.layers.length : firstSymbol, 0, ...lines)
  style.layers.push(...labels)
  return style
}

// Hillshade from the free AWS Terrain Tiles, beneath water. For production
// the DEM would be self-hosted as PMTiles next to the basemap.
function withRelief (style) {
  style.name += ' + relief'
  style.sources.dem = {
    type: 'raster-dem',
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>'
  }
  style.layers.splice(style.layers.findIndex(l => l.id === 'water'), 0, {
    id: 'hillshade',
    type: 'hillshade',
    source: 'dem',
    paint: { 'hillshade-shadow-color': FAINT.relief, 'hillshade-highlight-color': '#ffffff', 'hillshade-exaggeration': 0.25 }
  })
  return style
}

async function positron () {
  const style = await getJson(POSITRON)
  style.name = 'OpenFreeMap positron (OSM boundaries, not UN-compliant)'
  return style
}

async function terrain () {
  const style = await getJson(POSITRON)
  style.name = 'PP Terrain (OSM + UN boundaries)'
  style.layers = style.layers.filter(l => !OSM_LAYERS_TO_DROP.test(l.id))
  for (const l of style.layers) {
    if (l.id === 'background') l.paint = { 'background-color': FAINT.land }
    if (l.id === 'water') l.paint = { ...l.paint, 'fill-color': FAINT.water }
  }
  return withUn(style)
}

// Self-hosted Protomaps extract; source URL filled in at runtime.
async function pmtiles () {
  const flavor = {
    ...namedFlavor('light'),
    background: FAINT.land,
    earth: FAINT.land,
    water: FAINT.water,
    park_a: 'hsl(99, 40%, 85%)',
    park_b: 'hsl(99, 40%, 82%)',
    wood_a: 'hsl(99, 30%, 88%)',
    wood_b: 'hsl(99, 30%, 86%)',
    scrub_a: 'hsl(70, 30%, 88%)',
    scrub_b: 'hsl(70, 30%, 86%)'
  }
  return withUn({
    version: 8,
    name: 'PP Terrain (self-hosted PMTiles + UN boundaries)',
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    sources: {
      protomaps: {
        type: 'vector',
        url: PMTILES_PLACEHOLDER,
        attribution: '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      }
    },
    layers: protomapsLayers('protomaps', flavor, { lang: 'en' }).filter(l => !PROTOMAPS_LAYERS_TO_DROP.test(l.id))
  })
}

const DEM_SOURCE = {
  type: 'raster-dem',
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>'
}

// Previous Mapbox "UNEP Basemap - Faint" style rebuilt on Protomaps tiles
// (see mapbox-replica.mjs); includes hillshade like the original.
async function pmtilesMapbox () {
  const un = await unParts()
  const placesLayout = protomapsLayers('protomaps', namedFlavor('light'), { lang: 'en' })
    .find(l => l.id === 'places_locality').layout

  return {
    version: 8,
    name: 'PP Terrain (Mapbox UNEP Faint replica on PMTiles)',
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    sources: {
      protomaps: {
        type: 'vector',
        url: PMTILES_PLACEHOLDER,
        attribution: '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      },
      un: un.source,
      dem: DEM_SOURCE
    },
    layers: [
      ...baseLayers(),
      ...restyleUnBoundaries(un.lines),
      ...labelLayers(placesLayout),
      ...restyleUnLabels(un.labels)
    ]
  }
}

// Country labels computed once per build (see country-labels.mjs)
let countryLabels
const countryLabelData = () => (countryLabels = countryLabels || countryLabelPoints())

// Original UNEP Outdoor design (see unep-outdoor.mjs). OSM protected land
// is off by default so only PP's WDPA/OECM overlays show protection.
async function unepOutdoor ({ osmParks = false } = {}) {
  const un = await unParts()
  const layers = outdoorLayers()
  layers.splice(layers.findIndex(l => l.id === 'earth') + 1, 0, landcoverLayer)
  layers.splice(layers.findIndex(l => l.id === 'water'), 0, ...(osmParks ? protectedLandLayers : []), hillshadeLayer)
  const firstSymbol = layers.findIndex(l => l.type === 'symbol')
  layers.splice(firstSymbol, 0, ...outdoorUnBoundaries(un.lines))
  layers.splice(layers.findIndex(l => l.id === 'places_locality'), 0, curvedSeaLabels(), capitalMarker)
  // Own country labels: placed inside countries, shown by country size
  layers.push(...countryLabelLayers({ color: '#45474c', halo: '#f7f5ef', fontMedium: ['Noto Sans Medium'], fontItalic: ['Noto Sans Italic'] }))
  // capitals on top: placed before the country names, which then give way
  layers.push(capitalLabels(layers.find(l => l.id === 'places_locality')))

  return {
    version: 8,
    name: 'UNEP Outdoor (original design, self-hosted PMTiles + UN boundaries)',
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    sources: {
      protomaps: {
        type: 'vector',
        url: PMTILES_PLACEHOLDER,
        attribution: '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      },
      [LANDCOVER_SOURCE]: { type: 'vector', tiles: [PMTILES_TILES_PLACEHOLDER], maxzoom: 7 },
      [SEA_LABEL_SOURCE]: seaLabelSource,
      [COUNTRY_LABEL_SOURCE]: { type: 'geojson', data: await countryLabelData(), attribution: 'Labels: UN Geospatial, UNEP-WCMC' },
      un: un.source,
      dem: DEM_SOURCE
    },
    layers
  }
}

// VersaTiles "muted" (MIT) on the free VersaTiles tile server, with OSM
// boundaries and country names replaced by UN ones
async function versatilesMuted () {
  const style = await getJson('https://tiles.versatiles.org/assets/styles/muted/style.json')
  style.name = 'VersaTiles muted (hosted, MIT) + UN boundaries'
  // Same flat Web Mercator as every other option (VersaTiles defaults to a globe)
  delete style.projection
  delete style.sky
  style.layers = style.layers.filter(l => !/^(boundary-|label-boundary-)/.test(l.id))
  const font = style.layers.find(l => l.id === 'label-place-city').layout['text-font']
  const un = await unParts()
  style.sources.un = un.source
  const firstSymbol = style.layers.findIndex(l => l.type === 'symbol')
  style.layers.splice(firstSymbol, 0, ...outdoorUnBoundaries(un.lines))
  style.layers.push(...outdoorUnLabels(un.labels).map(l => ({ ...l, layout: { ...l.layout, 'text-font': font } })))
  return style
}

async function wcmcTemplate () {
  const style = await arcgisVts(WCMC_TEMPLATE_VTS)
  style.name = 'WCMC ArcGIS Basemap_Template (UN boundaries)'
  return style
}

const imagery = (name, source) => ({
  version: 8,
  name,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { imagery: { type: 'raster', tileSize: 256, ...source } },
  layers: [{ id: 'satellite-imagery', type: 'raster', source: 'imagery' }]
})

const ESRI_IMAGERY = { tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], maxzoom: 19, attribution: ESRI_ATTRIBUTION }
const UN_ON_IMAGERY = { 'text-color': '#ffffff', 'text-halo-color': '#000000' }

const satellite = () => withUn(imagery('PP Satellite (Esri World Imagery + UN boundaries)', ESRI_IMAGERY), UN_ON_IMAGERY)

function esriLabels () {
  const style = imagery('Esri World Imagery + Esri boundaries/places (not UN-compliant)', ESRI_IMAGERY)
  style.sources.reference = { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`] }
  style.layers.push({ id: 'reference-boundary-places', type: 'raster', source: 'reference' })
  return style
}

const eox = () => withUn(imagery('EOX Sentinel-2 Cloudless 2025 + UN boundaries (CC BY-NC-SA)', {
  tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'],
  maxzoom: 15,
  attribution: 'Sentinel-2 cloudless 2025 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025)'
}), UN_ON_IMAGERY)

const clearmap = (service) => rasterStyle(`UN ClearMap ${service}`, `${UN_CLEARMAP}/ClearMap_${service}/MapServer/tile/{z}/{y}/{x}`, CLEARMAP_ATTRIBUTION)

const PREVIEW = {
  hybrid: terrain,
  'hybrid-relief': async () => withRelief(await terrain()),
  pmtiles,
  'pmtiles-relief': async () => withRelief(await pmtiles()),
  'pmtiles-mapbox': pmtilesMapbox,
  'pmtiles-mapbox-v2': async () => tuneV2(await pmtilesMapbox()),
  'unep-outdoor': unepOutdoor,
  'unep-outdoor-terrain': async () => withTerrain(await unepOutdoor()),
  'unep-outdoor-terrain-osm-parks': async () => {
    const style = withTerrain(await unepOutdoor({ osmParks: true }))
    return { ...style, name: style.name.replace('UNEP Outdoor + terrain', 'UNEP Outdoor + terrain + OSM parks') }
  },
  'versatiles-muted': versatilesMuted,
  'clearmap-topo': () => clearmap('WebTopo'),
  'clearmap-gray': () => clearmap('WebGray'),
  'clearmap-plain': () => clearmap('WebPlain'),
  'wcmc-basemap-template': wcmcTemplate,
  positron,
  'esri-un': satellite,
  'esri-labels': esriLabels,
  'eox-2025': eox
}

mkdirSync(PREVIEW_DIR, { recursive: true })

for (const [name, build] of Object.entries(PREVIEW)) {
  const style = await build()
  writeFileSync(join(PREVIEW_DIR, `${name}.json`), JSON.stringify(style) + '\n')
  console.log(`${name}.json: ${style.layers.length} layers`)
}
