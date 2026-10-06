#!/usr/bin/env node
// Builds the default MapLibre basemap styles bundled with the app:
//
//   terrain.json   OpenFreeMap positron (OSM) with its boundaries and
//                  country/state labels replaced by UN-approved ones
//   satellite.json Esri World Imagery with the same UN boundaries/labels
//
// UN boundaries/labels come from the UNEP-WCMC ArcGIS vector tile service
// Hosted/UN_Boundaries_Labels. Colours follow the previous Mapbox style
// "UNEP Basemap (APPROVED - 14/04/21) - Faint".
//
// Usage (Node 18+): node lib/maps/build-basemap-styles.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../app/javascript/components/map/styles')
const POSITRON = 'https://tiles.openfreemap.org/styles/positron'
const UN_VTS = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/UN_Boundaries_Labels/VectorTileServer'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const UN_ATTRIBUTION = 'Boundaries: <a href="https://www.un.org/geospatial">UN Geospatial</a>, UNEP-WCMC'

// OSM layers that conflict with UN boundaries and names
const OSM_LAYERS_TO_DROP = /^(boundary_|label_country|label_state|label_other)/
const FONT = ['Noto Sans Regular'] // available from the OpenFreeMap glyphs

const getJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

// UN layers with absolute tile URLs. Line ids contain 'boundary' so PP
// overlays are inserted beneath them (see mixins/mixin-layers.js).
async function unLayers (labelPaint = {}) {
  const [meta, style] = await Promise.all([getJson(`${UN_VTS}?f=json`), getJson(`${UN_VTS}/resources/styles/root.json`)])
  const source = { type: 'vector', tiles: [`${UN_VTS}/tile/{z}/{y}/{x}.pbf`], maxzoom: meta.maxLOD, attribution: UN_ATTRIBUTION }
  const layers = style.layers
    .filter(l => l.type !== 'circle' && l['source-layer'] !== 'Major_Lakes')
    .map(l => {
      const layer = { ...l, source: 'un' }
      if (l.type === 'line') layer.id = `un-boundary-${l.id}`
      if (l.type === 'symbol') {
        layer.id = `un-label-${l.id}`
        layer.layout = { ...l.layout, 'text-font': FONT }
        layer.paint = { ...l.paint, ...labelPaint }
      }
      return layer
    })
  return {
    source,
    lines: layers.filter(l => l.type === 'line'),
    labels: layers.filter(l => l.type === 'symbol')
  }
}

async function terrain () {
  const [style, un] = await Promise.all([getJson(POSITRON), unLayers()])
  style.name = 'PP Terrain (OSM + UN boundaries)'
  style.layers = style.layers.filter(l => !OSM_LAYERS_TO_DROP.test(l.id))
  for (const l of style.layers) {
    if (l.id === 'background') l.paint = { 'background-color': 'hsl(35, 25%, 93%)' }
    if (l.id === 'water') l.paint = { ...l.paint, 'fill-color': '#b7d3db' }
  }
  style.sources.un = un.source
  style.layers.splice(style.layers.findIndex(l => l.type === 'symbol'), 0, ...un.lines)
  style.layers.push(...un.labels)
  return style
}

async function satellite () {
  const un = await unLayers({ 'text-color': '#ffffff', 'text-halo-color': '#000000' })
  return {
    version: 8,
    name: 'PP Satellite (Esri World Imagery + UN boundaries)',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'esri-imagery': {
        type: 'raster',
        tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION
      },
      un: un.source
    },
    layers: [{ id: 'satellite-imagery', type: 'raster', source: 'esri-imagery' }, ...un.lines, ...un.labels]
  }
}

for (const [name, build] of Object.entries({ terrain, satellite })) {
  const style = await build()
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(style, null, 2) + '\n')
  console.log(`${name}.json: ${style.layers.length} layers`)
}
