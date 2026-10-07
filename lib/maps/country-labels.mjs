// Country and territory labels for UNEP Outdoor, computed at build time.
//   - text and class: the official UN labels published by UNEP-WCMC
//     (Hosted/UN_Boundaries_Labels vector tiles), unchanged
//   - each label is matched (by location) to its UN polygon
//     (Hosted/UN_Boundaries layer 5) to get the country area and shape
//   - appearance zoom by on-screen (Web Mercator) area, not true area:
//     Mercator enlarges high latitudes, so FRANCE shows as early as ALGERIA;
//     large countries first, microstates last
//   - position: the official one when it lies well inside the country;
//     otherwise (member states that are mostly one landmass) a point well
//     inside the largest landmass, as close as possible to its centre
//     (e.g. NORWAY over its land); archipelagos keep the published position
//   - collisions: larger countries win
import { VectorTile } from '@mapbox/vector-tile'
import turfArea from '@turf/area'
import Pbf from 'pbf'
import { PMTiles } from 'pmtiles'
import polylabel from 'polylabel'
import zlib from 'node:zlib'

const LABEL_TILES = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/UN_Boundaries_Labels/VectorTileServer/tile'
// Same Protomaps build as the self-hosted extract (city points)
const PLACES = 'https://build.protomaps.com/20261006.pmtiles'
const POLYGONS = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/UN_Boundaries/FeatureServer/5'

// On-screen area (Mercator km2, i.e. as measured at the equator) -> zoom
// from which the label is shown
const TIERS = [[500000, 2], [150000, 2.5], [30000, 3.5], [3000, 4.5], [0, 6]]
// Keep the official position if it is at least this share of the largest
// possible distance from the border; otherwise move it inside
const KEEP_IF_DEPTH = 0.4
// ...and if it is not too far from that inside point (distance / square
// root of the landmass area): PERU was published in its narrow south
const KEEP_IF_FAR = 0.45

// Short names below SHORT_UNTIL (zoomed out) so neighbours fit; the
// official name from that zoom. Check with UN Geospatial before production.
const SHORT_UNTIL = 5
// Outdated names in the published label service, replaced by the current
// UN name (UNTERM). Report upstream to the UN_Boundaries_Labels owners.
const NAME_FIX = {
  'CAPE VERDE': 'CABO VERDE' // UN name since 2013, at the country's request
}
// Text in brackets ("(PLURINATIONAL STATE OF)", "(UK)") drawn smaller.
// Fallback if a short name is refused: remove it from SHORT below.
const QUALIFIER_SCALE = 0.75
const SHORT = {
  'UNITED KINGDOM OF GREAT BRITAIN & NORTHERN IRELAND': 'UNITED KINGDOM',
  'UNITED STATES OF AMERICA': 'UNITED STATES',
  'BOLIVIA (PLURINATIONAL STATE OF)': 'BOLIVIA',
  'IRAN (ISLAMIC REPUBLIC OF)': 'IRAN',
  'MICRONESIA (FEDERATED STATES OF)': 'MICRONESIA',
  'REPUBLIC OF TÜRKIYE': 'TÜRKIYE',
  'DEMOCRATIC REPUBLIC OF THE CONGO': 'DEM. REP. CONGO',
  "DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA": 'DPR KOREA',
  "LAO PEOPLE'S DEMOCRATIC REPUBLIC": 'LAO PDR',
  'UNITED REPUBLIC OF TANZANIA': 'TANZANIA',
  'SYRIAN ARAB REPUBLIC': 'SYRIA',
  'RUSSIAN FEDERATION': 'RUSSIA',
  'BRUNEI DARUSSALAM': 'BRUNEI',
  'CENTRAL AFRICAN REPUBLIC': 'CENTRAL AFRICAN REP.',
  'BOSNIA AND HERZEGOVINA': 'BOSNIA & HERZ.',
  'SAINT VINCENT AND THE GRENADINES': 'ST VINCENT & GREN.'
}

// City-states: a small country or territory whose capital or main city
// has the same name (MONACO / Monaco). One name at a time: the country
// name next to the city dot until CITY_STATE_UNTIL, then the city name.
const CITY_STATE_MAX_AREA = 30000 // on-screen km2, as TIERS
// within 60 km, or 0.8 x the country's width (Djibouti city is 105 km away)
const cityStateKm = (area) => Math.max(60, 0.8 * Math.sqrt(area))
export const CITY_STATE_UNTIL = 9
const CITY_STATE_FROM = 5 // like capitals
const ALIASES = { 'holy see': 'vatican city' }

// Official label classes (_label_classN / _nameN), cf. the UNEP-WCMC style
const CLASSES = {
  1: 'member', // Member State
  2: 'territory', // Territories and Non-Self-Governing Territories
  3: 'opt', // Occupied Palestinian Territory
  4: 'special', // Special Region or Province
  5: 'member', // The City of Vatican (Holy See)
  6: 'jk' // Jammu and Kashmir
}
// Kept exactly as published (position and zoom)
const AS_PUBLISHED = new Set(['opt', 'jk'])

// --- Web Mercator helpers (label placement is a visual problem) -----------
const R = 6378137
const toMerc = ([lon, lat]) => {
  const y = Math.max(Math.min(lat, 82), -82)
  return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) * R]
}
const toLonLat = ([x, y]) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]

function insideRing ([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const insidePolygon = (p, rings) => insideRing(p, rings[0]) && !rings.slice(1).some(h => insideRing(p, h))

function distanceToEdge ([x, y], rings) {
  let min = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]; const [bx, by] = ring[i]
      const dx = bx - ax; const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      min = Math.min(min, Math.hypot(x - ax - t * dx, y - ay - t * dy))
    }
  }
  return min
}

function centroid (ring) {
  let a = 0; let cx = 0; let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f
  }
  return [cx / (3 * a), cy / (3 * a)]
}

// A point well inside the polygon (depth >= KEEP_IF_DEPTH x max depth),
// as close as possible to the centroid
function goodInsidePoint (rings) {
  const best = polylabel(rings, 1000)
  const maxDepth = best.distance
  const c = centroid(rings[0])
  const xs = rings[0].map(p => p[0]); const ys = rings[0].map(p => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const n = 48
  let chosen = [best[0], best[1]]; let chosenDist = Math.hypot(best[0] - c[0], best[1] - c[1])
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * j / n]
      if (!insidePolygon(p, rings) || distanceToEdge(p, rings) < KEEP_IF_DEPTH * maxDepth) continue
      const d = Math.hypot(p[0] - c[0], p[1] - c[1])
      if (d < chosenDist) { chosen = p; chosenDist = d }
    }
  }
  return { point: chosen, maxDepth }
}

// --- Data -----------------------------------------------------------------
// Small places only exist in deeper label tiles: read zooms 2-5
async function officialLabels () {
  const labels = new Map()
  const tiles = []
  for (let z = 2; z <= 5; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) tiles.push([z, x, y])
  const fetchTile = async ([z, x, y]) => {
    const res = await fetch(`${LABEL_TILES}/${z}/${y}/${x}.pbf`).catch(() => null)
    return res && res.ok ? [z, x, y, Buffer.from(await res.arrayBuffer())] : null
  }
  for (let t = 0; t < tiles.length; t += 16) {
    for (const r of await Promise.all(tiles.slice(t, t + 16).map(fetchTile))) {
      if (!r) continue
      const [z, x, y] = r
      let buf = r[3]
      if (!buf.length) continue
      if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf)
      const layer = new VectorTile(new Pbf(buf)).layers.Countries_Labels
      if (!layer) continue
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const pr = f.properties
        const n = Object.keys(pr).map(k => k.match(/^_name(\d)$/)).find(Boolean)
        const cls = n ? CLASSES[n[1]] : (pr._name ? 'member' : null) // _name: Antarctica
        const name = n ? pr[n[0]] : pr._name
        if (!cls || !name || !name.trim()) continue
        const point = f.toGeoJSON(x, y, z).geometry.coordinates
        if (!labels.has(name)) labels.set(name, { name, cls, point })
      }
    }
  }
  return [...labels.values()]
}

async function unPolygons () {
  const params = new URLSearchParams({
    where: '1=1', outFields: 'iso3cd,stscod,romnam,maplab', returnGeometry: 'true', outSR: '4326',
    maxAllowableOffset: '0.02', geometryPrecision: '4', f: 'geojson'
  })
  const groups = new Map()
  for (let offset = 0; ; offset += 50) {
    params.set('resultOffset', offset)
    params.set('resultRecordCount', 50)
    const page = await (await fetch(`${POLYGONS}/query?${params}`)).json()
    for (const f of page.features) {
      if (!f.geometry) continue
      const key = f.properties.iso3cd || `obj-${groups.size}`
      if (!groups.has(key)) groups.set(key, { key, parts: [], names: new Set() })
      groups.get(key).names.add(`${f.properties.romnam || ''} ${f.properties.maplab || ''}`)
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      groups.get(key).parts.push(...polys)
    }
    if (page.features.length < 50) break
  }
  for (const g of groups.values()) {
    g.areas = g.parts.map(p => turfArea({ type: 'Polygon', coordinates: p }))
    g.areaKm2 = g.areas.reduce((a, b) => a + b, 0) / 1e6
    g.merc = g.parts.map(p => p.map(ring => ring.map(toMerc)))
    g.mercKm2 = g.merc.reduce((sum, rings) => sum + mercArea(rings), 0) / 1e6
  }
  return [...groups.values()]
}

// Planar area of a polygon in Web Mercator (outer ring minus holes), m2
function mercArea (rings) {
  const ringArea = (r) => Math.abs(r.reduce((a, [x, y], i) => {
    const [x2, y2] = r[(i + 1) % r.length]
    return a + x * y2 - x2 * y
  }, 0)) / 2
  return rings.reduce((a, r, i) => a + (i ? -1 : 1) * ringArea(r), 0)
}

// The polygon group containing the label, or the nearest one (labels in the sea)
function matchGroup (pointMerc, groups) {
  let nearest = null; let nearestDist = Infinity
  for (const g of groups) {
    for (const rings of g.merc) {
      if (insidePolygon(pointMerc, rings)) return { group: g, rings }
      const d = distanceToEdge(pointMerc, rings)
      if (d < nearestDist) { nearestDist = d; nearest = { group: g, rings } }
    }
  }
  return nearestDist < 400000 ? nearest : null
}

// Significant words of a name, to check that a label and a polygon agree
const words = (text) => new Set(text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z]+/).filter(w => w.length > 3 && !['republic', 'islands', 'island', 'state', 'states', 'united', 'democratic', 'kingdom'].includes(w)))
const sameCountry = (label, group) => {
  const a = words(label)
  const b = words([...group.names].join(' '))
  if (!a.size) return [...group.names].join(' ').toLowerCase().includes(label.toLowerCase().slice(0, 6))
  return [...a].some(w => b.has(w))
}

// Build time of each step (ms), reported by build-basemap-styles.mjs
export const timings = {}
const timed = async (name, fn) => { const t = performance.now(); const r = await fn(); timings[name] = Math.round(performance.now() - t); return r }

export async function countryLabelPoints () {
  const [labels, groups] = await Promise.all([
    timed('Country labels: read official UN labels (tiles z2-5)', officialLabels),
    timed('Country labels: read UN country polygons', unPolygons)
  ])
  const tPlace = performance.now()
  const unmatched = []
  const shapes = new Map() // feature -> rings of its largest landmass (Mercator)
  const features = labels.map(label => {
    const pointMerc = toMerc(label.point)
    const found = AS_PUBLISHED.has(label.cls) ? null : matchGroup(pointMerc, groups)
    // Use the polygon only when its UN name agrees with the label
    const match = found && sameCountry(label.name, found.group) ? found : null
    if (found && !match) unmatched.push(label.name)
    let point = label.point
    let minzoom = AS_PUBLISHED.has(label.cls) ? 4 : 6 // unmatched: small islands
    let area = 0
    let shape = null
    if (match) {
      const g = match.group
      area = Math.round(g.mercKm2)
      minzoom = TIERS.find(([min]) => g.mercKm2 >= min)[1]
      const largest = g.merc[g.areas.indexOf(Math.max(...g.areas))]
      shape = largest
      const { point: inside, maxDepth } = goodInsidePoint(largest)
      const officialOk = insidePolygon(pointMerc, largest) && distanceToEdge(pointMerc, largest) >= KEEP_IF_DEPTH * maxDepth &&
        Math.hypot(pointMerc[0] - inside[0], pointMerc[1] - inside[1]) <= KEEP_IF_FAR * Math.sqrt(mercArea(largest))
      // Only member states that are mostly one landmass are moved:
      // archipelago names stay in the sea around the islands, as published
      const share = Math.max(...g.areas) / (g.areaKm2 * 1e6)
      const compact = share >= 0.5 && g.areaKm2 >= 20000
      // the 'too far' rule only for countries that are nearly one landmass
      // (MALAYSIA keeps its peninsula position rather than Borneo)
      const ok = officialOk || (share < 0.75 && insidePolygon(pointMerc, largest) && distanceToEdge(pointMerc, largest) >= KEEP_IF_DEPTH * maxDepth)
      if (!ok && label.cls === 'member' && compact) point = toLonLat(inside)
    }
    const feature = {
      type: 'Feature',
      properties: { name: NAME_FIX[label.name] || label.name, short: SHORT[label.name] || NAME_FIX[label.name] || label.name, cls: label.cls, minzoom, area, moved: point !== label.point },
      geometry: { type: 'Point', coordinates: point.map(v => Math.round(v * 1e4) / 1e4) }
    }
    if (shape) shapes.set(feature, shape)
    return feature
  })
  if (!labels.some(l => /^ANTARCTICA$/i.test(l.name))) {
    // Not in the label tiles (beyond their extent): fixed position
    features.push({ type: 'Feature', properties: { name: 'ANTARCTICA', cls: 'member', minzoom: 2, area: 100000000, moved: false }, geometry: { type: 'Point', coordinates: [0, -78] } })
  }
  if (unmatched.length) console.log(`country labels kept as published (no matching polygon name): ${unmatched.join(', ')}`)
  timings['Country labels: placement inside countries + zoom tiers'] = Math.round(performance.now() - tPlace)
  await timed('City-states: one name at a time', () => markCityStates(features))
  await timed('Country names moved off their capital', () => avoidCapitals(features, shapes))
  await timed('Two-line names in narrow countries', () => { for (const [f, shape] of shapes) f.properties.wrapUntil = wrapUntil(f, shape) })
  return { type: 'FeatureCollection', features }
}

// --- Label geometry on screen (approximate, Roboto Condensed capitals) ---
const PX_Z5 = 2 * Math.PI * R / (512 * 2 ** 5) // metres per pixel at zoom 5
const memberSize = (z) => 11 + Math.min(Math.max(z - 2, 0), 4) // text-size 11 -> 15
const textWidthPx = (text, size) => text.length * 0.56 * size

// Horizontal width (Mercator metres) of a shape along the line through p
function chordWidth ([x, y], rings) {
  const xs = []
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j]; const [x2, y2] = ring[i]
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
    }
  }
  xs.sort((a, b) => a - b)
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i] <= x && x <= xs[i + 1]) return xs[i + 1] - xs[i]
  return 0
}

// Zoom until which a multi-word name goes on two lines ("BURKINA" /
// "FASO"): while its one-line width exceeds 90% of the country's width
// along the label line. 0 = never.
function wrapUntil (f, shape) {
  const name = f.properties.short || f.properties.name
  if (f.properties.cls !== 'member' || !/ /.test(name.replace(/ \(.*$/, ''))) return 0
  const chord = chordWidth(toMerc(f.geometry.coordinates), shape)
  for (let z = Math.floor(f.properties.minzoom); z <= 9; z++) {
    const chordPx = chord / (PX_Z5 / 2 ** (z - 5))
    if (textWidthPx(name, memberSize(z)) <= 0.9 * chordPx) return z
  }
  return 9
}

// Moves a country name that would cover a capital (dot + name, shown from
// zoom 5) to just below the capital, or above it, if still inside the
// country. Done here once rather than at runtime: MapLibre's alternative
// anchors also moved names for other collisions and kept them off-centre.
async function avoidCapitals (features, shapes) {
  const moved = []
  for (const [f, shape] of shapes) {
    if (f.properties.city || f.properties.cls !== 'member') continue
    const p = toMerc(f.geometry.coordinates)
    const name = f.properties.name.replace(/ \(.*$/, '')
    const half = { w: textWidthPx(name, memberSize(5)) / 2 + 4, h: memberSize(5) * 0.7 }
    for (const c of await placesAt(f.geometry.coordinates, 5)) {
      if (!c.capital) continue
      const q = toMerc(c.point)
      const dx = (q[0] - p[0]) / PX_Z5
      const dy = (p[1] - q[1]) / PX_Z5 // screen y, down
      // capital: dot plus its name above it, about 12 px tall
      const capHalfW = c.name.length * 3.2 + 4
      if (Math.abs(dx) > half.w + capHalfW || dy > half.h + 8 || dy < -half.h - 24) continue
      const below = [q[0], q[1] - (8 + half.h + 4) * PX_Z5]
      const above = [q[0], q[1] + (24 + half.h + 4) * PX_Z5]
      const target = [below, above].find(t => insidePolygon(t, shape) && distanceToEdge(t, shape) > half.h * PX_Z5)
      if (!target) continue
      f.geometry.coordinates = toLonLat(target).map(v => Math.round(v * 1e4) / 1e4)
      f.properties.moved = true
      moved.push(`${f.properties.short} (${c.name})`)
      break
    }
  }
  console.log(`country names moved off their capital: ${moved.join(', ')}`)
}

const plain = (text) => text.split(',')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\*/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const sameName = (country, city) => {
  const a = ALIASES[plain(country)] || plain(country)
  const b = plain(city)
  return b === a || b.startsWith(`${a} `) // "Kuwait City", "Andorra la Vella"
}

// Finds the city of each small country/territory label: same name, near
// the label. Moves the label to the city (it then sits by the city dot),
// shows it from zoom 5 like capitals, and records the city name.
// Protomaps localities (name, point, capital) of the tile at zoom z
// containing a point; tiles are cached
const placesArchive = new PMTiles(PLACES)
const placeTiles = new Map()
function placesAt ([lon, lat], z) {
  const n = 2 ** z
  const x = Math.floor((lon + 180) / 360 * n)
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)
  const key = `${z}/${x}/${y}`
  if (!placeTiles.has(key)) {
    placeTiles.set(key, placesArchive.getZxy(z, x, y).then(t => {
      if (!t) return []
      let buf = Buffer.from(t.data)
      if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf)
      const layer = new VectorTile(new Pbf(buf)).layers.places
      const out = []
      for (let i = 0; layer && i < layer.length; i++) {
        const f = layer.feature(i)
        if (f.properties.kind !== 'locality') continue
        out.push({
          name: f.properties['name:en'] || f.properties.name,
          capital: f.properties.capital === 'yes',
          point: f.toGeoJSON(x, y, z).geometry.coordinates
        })
      }
      return out
    }))
  }
  return placeTiles.get(key)
}

async function markCityStates (features) {
  const z = 8 // some capitals (Luxembourg) are only in deeper tiles
  const km = ([a, b], [c, d]) => Math.hypot((a - c) * Math.cos((b + d) / 2 * Math.PI / 180), b - d) * 111.32
  const candidates = features.filter(f => !AS_PUBLISHED.has(f.properties.cls) && f.properties.area < CITY_STATE_MAX_AREA)
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(candidates.slice(i, i + 8).map(async (f) => {
      const near = (await placesAt(f.geometry.coordinates, z))
        .filter(c => c.name && sameName(f.properties.name, c.name) && km(c.point, f.geometry.coordinates) <= cityStateKm(f.properties.area))
        .sort((a, b) => km(a.point, f.geometry.coordinates) - km(b.point, f.geometry.coordinates))
      if (!near.length) return
      f.properties.city = near[0].name
      f.properties.minzoom = Math.min(f.properties.minzoom, CITY_STATE_FROM)
      f.geometry.coordinates = near[0].point.map(v => Math.round(v * 1e4) / 1e4)
    }))
  }
  console.log(`city-states: ${features.filter(f => f.properties.city).map(f => `${f.properties.name} = ${f.properties.city}`).join(', ')}`)
}

// City names to hide while their country/territory name is shown
export const cityStateNames = (labels) => labels.features.filter(f => f.properties.city).map(f => f.properties.city)

// Adds "hide city-state names below CITY_STATE_UNTIL" to a town layer
export function hideCityStates (layer, names, nameExpr) {
  return {
    ...layer,
    filter: ['all', layer.filter, ['any', ['>=', ['zoom'], CITY_STATE_UNTIL], ['!', ['in', nameExpr, ['literal', names]]]]]
  }
}

export const COUNTRY_LABEL_SOURCE = 'country-labels'

// Member states (and Antarctica): upper case, letter-spaced; others italic.
// Text breaks before "(": "Guernsey" / "(UK)".
export function countryLabelLayers ({ color, halo, fontMedium, fontItalic }) {
  // line break before "(" (the zoom step must stay at the top level)
  const wrap = (name) => {
    const i = ['index-of', ' (', name]
    // the bracketed qualifier on its own line, smaller: "BOLIVIA" / "(PLURINATIONAL STATE OF)"
    return ['case', ['>', i, 0],
      ['format', ['slice', name, 0, i], {}, '\n', {}, ['slice', name, ['+', i, 1]], { 'font-scale': QUALIFIER_SCALE }],
      name]
  }
  const text = ['step', ['zoom'], wrap(['coalesce', ['get', 'short'], ['get', 'name']]), SHORT_UNTIL, wrap(['get', 'name'])]
  const isMember = ['==', ['get', 'cls'], 'member']
  const big = ['>=', ['get', 'area'], 2000000]
  const common = {
    type: 'symbol',
    source: COUNTRY_LABEL_SOURCE,
    maxzoom: 9,
    paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.8, 'text-halo-blur': 0.5 }
  }
  const layout = {
    'text-field': text,
    'symbol-sort-key': ['-', ['get', 'area']],
    'text-padding': 4,
    // city-states: the name just below the city dot; others centred
    'text-anchor': ['case', ['has', 'city'], 'top', 'center'],
    'text-offset': ['case', ['has', 'city'], ['literal', [0, 0.5]], ['literal', [0, 0]]],
    // narrow countries: multi-word names on two lines until wrapUntil
    'text-max-width': ['step', ['zoom'], ...[2, 3, 4, 5, 6, 7, 8].flatMap((z, i) => [
      ...(i ? [z] : []), ['case', ['!=', ['get', 'cls'], 'member'], 7, ['>', ['coalesce', ['get', 'wrapUntil'], 0], z], 5, 12]])]
  }
  const member = {
    ...layout,
    'text-font': fontMedium,
    'text-transform': 'uppercase',
    // narrow DIN-like capitals (Roboto Condensed): long names take less room
    'text-letter-spacing': 0.05,
    'text-size': ['interpolate', ['linear'], ['zoom'], 2, ['case', big, 12, 11], 6, ['case', big, 16, 15]]
  }
  const other = {
    ...layout,
    'text-font': fontItalic,
    'text-letter-spacing': 0.02,
    'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8.5, 6, 12]
  }
  // One layer per tier: a zoom filter is only checked at whole tile zooms
  // (2.5 would act as 3), a layer minzoom is exact. Larger tiers on top so
  // they are placed first.
  const zooms = [...new Set([...TIERS.map(([, z]) => z), 4, CITY_STATE_FROM])].sort((a, b) => b - a)
  return zooms.flatMap(z => [
    { ...common, id: `country-label-other-z${z}`, minzoom: Math.max(z, 3.5), filter: ['all', ['!', isMember], ['==', ['get', 'minzoom'], z]], layout: other },
    { ...common, id: `country-label-member-z${z}`, minzoom: z, filter: ['all', isMember, ['==', ['get', 'minzoom'], z]], layout: member }
  ])
}
