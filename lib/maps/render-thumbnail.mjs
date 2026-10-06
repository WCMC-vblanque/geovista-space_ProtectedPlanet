// Server-side PA thumbnails with MapLibre Native (headless, no browser).
// Prototype of the Mapbox Static Images replacement: output is a plain PNG,
// so the site pages and the PDF export embed it exactly as today.
//
//   node render-thumbnail.mjs --pmtiles <url.pmtiles> [--out dir] <site_id>...
//
// Site geometry comes from the WDPA MapServer here; in PP it would be
// GeometryConcern#geojson (already simplified in PostGIS).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import mbgl from '@maplibre/maplibre-gl-native'
import { PNG } from 'pngjs'
import { PMTiles } from 'pmtiles'
import { thumbnailStyle, fitCamera, siteBbox, THUMB_SIZE } from '../../public/maps/thumbnail-style.mjs'

const WDPA_MS = 'https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer'
const MAPS = new URL('../../public/maps/', import.meta.url)
const RATIO = 2

const { values: opts, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    pmtiles: { type: 'string' },
    style: { type: 'string', default: 'unep-outdoor-terrain' },
    out: { type: 'string', default: fileURLToPath(new URL('thumbs/', MAPS)) }
  }
})
if (!opts.pmtiles || !ids.length) {
  console.error('Usage: node render-thumbnail.mjs --pmtiles <url.pmtiles> [--style name] [--out dir] <site_id>...')
  process.exit(1)
}

const archive = new PMTiles(opts.pmtiles)

async function baseStyle () {
  const style = JSON.parse(await readFile(new URL(`preview/${opts.style}.json`, MAPS), 'utf8'))
  const { maxZoom } = await archive.getHeader()
  for (const src of Object.values(style.sources)) {
    if (src.url === '__PMTILES_URL__' || src.tiles?.[0] === '__PMTILES_TILES__') {
      delete src.url
      src.tiles = ['pmtiles://{z}/{x}/{y}']
      src.maxzoom = maxZoom
    }
  }
  style.glyphs = style.glyphs.replace('__GLYPHS__', new URL('fonts', MAPS).href)
  return style
}

// MapLibre Native asks the host for every resource (tiles, glyphs, sprites).
async function load (url) {
  if (url.startsWith('pmtiles://')) {
    const [z, x, y] = url.slice('pmtiles://'.length).split('/').map(Number)
    const tile = await archive.getZxy(z, x, y)
    return tile && Buffer.from(tile.data)
  }
  if (url.startsWith('file:')) return readFile(new URL(url)).catch(() => null)
  const res = await fetch(url)
  if (res.status === 404 || res.status === 204) return null
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function request ({ url }, callback) {
  load(url).then(data => callback(null, data ? { data } : {}), err => callback(err))
}

async function siteGeojson (id) {
  for (const layer of [1, 0]) {   // polygons, then points
    const q = `${WDPA_MS}/${layer}/query?where=site_id%3D${id}&outFields=realm&outSR=4326&maxAllowableOffset=0.003&geometryPrecision=3&f=geojson`
    const fc = await fetch(q).then(r => r.json())
    if (fc.features?.length) return fc
  }
  throw new Error(`site_id ${id} not found`)
}

function render (style, camera) {
  const map = new mbgl.Map({ request, ratio: RATIO })
  map.load(style)
  return new Promise((resolve, reject) => map.render({ ...camera, ...THUMB_SIZE }, (err, pixels) => {
    map.release()
    if (err) return reject(err)
    const png = new PNG({ width: THUMB_SIZE.width * RATIO, height: THUMB_SIZE.height * RATIO })
    png.data = Buffer.from(pixels)
    resolve(PNG.sync.write(png))
  }))
}

const base = await baseStyle()
await mkdir(opts.out, { recursive: true })
for (const id of ids) {
  const t0 = performance.now()
  try {
    const fc = await siteGeojson(id)
    const marine = fc.features.some(f => f.properties.realm !== 'Terrestrial')
    const camera = fitCamera(siteBbox(fc))
    const png = await render(thumbnailStyle(base, fc, { marine }), camera)
    await writeFile(join(opts.out, `${id}.png`), png)
    console.log(`${id}: ${Math.round(performance.now() - t0)} ms, ${(png.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    console.error(`${id}: ${err.message}`)
  }
}
