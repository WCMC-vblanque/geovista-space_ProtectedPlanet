// Browser-side cost of each UNEP-WCMC Nature rule, measured offline with
// MapLibre Native: render time with the rule minus without it (same views,
// tiles cached in memory, paired runs, median). Network time not included.
// usage (from lib/maps):
//   npm i --no-save @maplibre/maplibre-gl-native pngjs
//   node benchmark-rules.mjs ../../public/maps/preview/unep-outdoor-terrain.json
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { PMTiles } from 'pmtiles'
import { PNG } from 'pngjs'
const require = createRequire(import.meta.url)
const PUBLIC = new URL('../../public/maps/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const mbgl = require('@maplibre/maplibre-gl-native')

const PMTILES = new PMTiles('https://build.protomaps.com/20261006.pmtiles')
const EXTRACT_MAXZOOM = 10 // same as basemap-z10.pmtiles

// Views matching the Mapbox screenshots (approximate)

const cache = new Map()
async function fetchUrl (url) {
  if (cache.has(url)) return cache.get(url)
  let data = null
  if (url.startsWith('pmtiles-proxy://tilejson')) {
    data = Buffer.from(JSON.stringify({ tilejson: '3.0.0', tiles: ['pmtiles-proxy://tile/{z}/{x}/{y}'], minzoom: 0, maxzoom: EXTRACT_MAXZOOM }))
  } else if (url.startsWith('local-glyphs://')) {
    const f = PUBLIC + 'fonts/' + decodeURIComponent(url.slice(15))
    data = fs.existsSync(f) ? fs.readFileSync(f) : null
  } else if (url.startsWith('pmtiles-proxy://tile/')) {
    const [z, x, y] = url.split('/').slice(-3).map(Number)
    const t = await PMTILES.getZxy(z, x, y)
    if (t) { data = Buffer.from(t.data); if (data[0] === 0x1f) data = zlib.gunzipSync(data) }
  } else {
    const res = await fetch(url)
    if (res.ok) data = Buffer.from(await res.arrayBuffer())
  }
  cache.set(url, data)
  return data
}
function request (req, cb) {
  fetchUrl(req.url).then(data => cb(null, data ? { data } : {})).catch(err => cb(err))
}

// Runtime cost of each UNEP-WCMC Nature rule: render time of the full style
// minus the same style without the rule's layers (tiles cached in memory)
const style = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
style.glyphs = 'local-glyphs://{fontstack}/{range}.pbf'
for (const src of Object.values(style.sources)) {
  if (typeof src.data === 'string' && src.data.startsWith('__DATA__')) src.data = JSON.parse(fs.readFileSync(PUBLIC + 'data/' + src.data.slice(9), 'utf8'))
  if (src.url === '__PMTILES_URL__') src.url = 'pmtiles-proxy://tilejson'
  if (src.tiles && src.tiles[0] === '__PMTILES_TILES__') src.tiles = ['pmtiles-proxy://tile/{z}/{x}/{y}']
}
const VIEWS = [[3, [15, 40]], [5, [19.3, 44.5]], [7, [127, 38.3]], [9, [20.4, 44.8]]]
const RULES = {
  'Relief tint (elevation colours, 2b/2c)': id => id === 'relief-tint',
  'Hillshade (relief shading)': id => id === 'hillshade',
  'Vegetation / land cover (overzoomed to z7)': id => id === 'landcover',
  'Rivers z2-9 (Natural Earth)': id => id === 'rivers-ne',
  'Curved sea labels': id => id === 'sea-label-curved',
  'Country labels (12 tier layers)': id => id.startsWith('country-label'),
  'Capital labels + marker': id => id === 'places_capital' || id === 'capital-marker',
  'Town labels (ranked)': id => id === 'places_locality',
  'Paper halo under dotted UN lines': id => id.endsWith('(halo)'),
  'Between-country dotted lines (Korea, Kashmir...)': id => id.startsWith('un-interstate')
}
const N = 15
async function renderOnce (s, [zoom, center]) {
  const map = new mbgl.Map({ request, ratio: 1 })
  map.load(s)
  const t = performance.now()
  await new Promise((resolve, reject) => map.render({ zoom, center, width: 1024, height: 768 }, err => err ? reject(err) : resolve()))
  const ms = performance.now() - t
  map.release()
  return ms
}
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
// alternate with / without the rule, median of the paired differences
async function cost (withRule, withoutRule) {
  let total = 0; let base = 0
  for (const v of VIEWS) {
    const d = []; const b = []
    for (let i = 0; i < N; i++) {
      const a = await renderOnce(withRule, v)
      const c = await renderOnce(withoutRule, v)
      d.push(a - c); b.push(a)
    }
    total += median(d); base += median(b)
  }
  return { total, base }
}
for (const v of VIEWS) { await renderOnce(style, v); await renderOnce(style, v) } // warm caches
const rows = []
let fullMs = 0
for (const [name, match] of Object.entries(RULES)) {
  const layers = style.layers.filter(l => match(l.id))
  if (!layers.length) continue
  const { total, base } = await cost(style, { ...style, layers: style.layers.filter(l => !match(l.id)) })
  fullMs = Math.max(fullMs, base)
  rows.push([name, layers.length, total])
}
console.log(`full style (${style.layers.length} layers): ~${fullMs.toFixed(0)} ms for ${VIEWS.length} views (zooms ${VIEWS.map(v => v[0]).join(', ')}) at 1024x768`)
rows.sort((a, b) => b[2] - a[2])
for (const [name, n, d] of rows) console.log(`${d.toFixed(1).padStart(7)} ms  ${(100 * d / fullMs).toFixed(1).padStart(5)}%  ${String(n).padStart(2)} layers  ${name}`)
