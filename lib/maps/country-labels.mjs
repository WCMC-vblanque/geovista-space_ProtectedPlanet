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
import polylabel from 'polylabel'
import zlib from 'node:zlib'

const LABEL_TILES = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/UN_Boundaries_Labels/VectorTileServer/tile'
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

export async function countryLabelPoints () {
  const [labels, groups] = await Promise.all([officialLabels(), unPolygons()])
  const unmatched = []
  const features = labels.map(label => {
    const pointMerc = toMerc(label.point)
    const found = AS_PUBLISHED.has(label.cls) ? null : matchGroup(pointMerc, groups)
    // Use the polygon only when its UN name agrees with the label
    const match = found && sameCountry(label.name, found.group) ? found : null
    if (found && !match) unmatched.push(label.name)
    let point = label.point
    let minzoom = AS_PUBLISHED.has(label.cls) ? 4 : 6 // unmatched: small islands
    let area = 0
    if (match) {
      const g = match.group
      area = Math.round(g.mercKm2)
      minzoom = TIERS.find(([min]) => g.mercKm2 >= min)[1]
      const largest = g.merc[g.areas.indexOf(Math.max(...g.areas))]
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
    return {
      type: 'Feature',
      properties: { name: label.name, short: SHORT[label.name] || label.name, cls: label.cls, minzoom, area, moved: point !== label.point },
      geometry: { type: 'Point', coordinates: point.map(v => Math.round(v * 1e4) / 1e4) }
    }
  })
  if (!labels.some(l => /^ANTARCTICA$/i.test(l.name))) {
    // Not in the label tiles (beyond their extent): fixed position
    features.push({ type: 'Feature', properties: { name: 'ANTARCTICA', cls: 'member', minzoom: 2, area: 100000000, moved: false }, geometry: { type: 'Point', coordinates: [0, -78] } })
  }
  if (unmatched.length) console.log(`country labels kept as published (no matching polygon name): ${unmatched.join(', ')}`)
  return { type: 'FeatureCollection', features }
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
    paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.4 }
  }
  const layout = {
    'text-field': text,
    'text-max-width': 7,
    'symbol-sort-key': ['-', ['get', 'area']],
    'text-padding': 4,
    // when a capital (placed first) is in the way, the name moves just
    // above or below its point instead of hiding the capital
    'text-variable-anchor-offset': ['literal', ['center', [0, 0], 'top', [0, 1.4], 'bottom', [0, -1.4], 'left', [1.2, 0], 'right', [-1.2, 0]]]
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
  const zooms = [...new Set([...TIERS.map(([, z]) => z), 4])].sort((a, b) => b - a)
  return zooms.flatMap(z => [
    { ...common, id: `country-label-other-z${z}`, minzoom: Math.max(z, 3.5), filter: ['all', ['!', isMember], ['==', ['get', 'minzoom'], z]], layout: other },
    { ...common, id: `country-label-member-z${z}`, minzoom: z, filter: ['all', isMember, ['==', ['get', 'minzoom'], z]], layout: member }
  ])
}
