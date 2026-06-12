/**
 * Generates a 304x138 PNG static map thumbnail.
 * Reads GeoJSON from stdin, writes PNG binary to stdout.
 *
 * Requires Node.js 18+ (staticmaps@1.12 uses sharp which needs node: builtins).
 * Usage: node scripts/generate_map_thumbnail.js < input.geojson > output.png
 */
'use strict'

const StaticMaps = require('staticmaps')

const WIDTH  = 304
const HEIGHT = 138
const ESRI_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// White outline with light fill — visible on satellite imagery
const POLYGON_STYLE = {
  color: '#FFFFFF',
  width: 2,
  fill:  'rgba(255, 255, 255, 0.15)'
}

async function generateThumbnail(geojsonStr) {
  const geojson = JSON.parse(geojsonStr)

  const map = new StaticMaps({
    width:    WIDTH,
    height:   HEIGHT,
    tileUrl:  ESRI_TILE_URL,
    tileSize: 256,
    tileRequestTimeout: 10000,
    tileRequestLimit:   10
  })

  addFeatures(map, geojson)
  await map.render()

  const buffer = await map.image.buffer('image/png')
  process.stdout.write(buffer)
}

function addFeatures(map, geojson) {
  for (const geom of flatGeometries(geojson)) {
    drawGeometry(map, geom)
  }
}

function flatGeometries(obj) {
  if (!obj) return []
  switch (obj.type) {
    case 'FeatureCollection':
      return (obj.features || []).flatMap(f => flatGeometries(f))
    case 'Feature':
      return flatGeometries(obj.geometry)
    case 'GeometryCollection':
      return (obj.geometries || []).flatMap(g => flatGeometries(g))
    default:
      return [obj]
  }
}

function drawGeometry(map, geom) {
  if (!geom || !geom.type) return
  switch (geom.type) {
    case 'Polygon':
      map.addPolygon({ coords: geom.coordinates[0], ...POLYGON_STYLE })
      break
    case 'MultiPolygon':
      for (const part of geom.coordinates) {
        map.addPolygon({ coords: part[0], ...POLYGON_STYLE })
      }
      break
  }
}

// Read GeoJSON from stdin
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  generateThumbnail(input.trim()).catch(err => {
    process.stderr.write(`generate_map_thumbnail error: ${err.message}\n`)
    process.exit(1)
  })
})
