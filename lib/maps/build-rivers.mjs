// Small-scale rivers for UNEP-WCMC Nature: Protomaps has river lines only
// from zoom 9, so zooms 2-9 use Natural Earth 10m river centrelines
// (public domain). Output: public/maps/data/rivers.geojson
//   - properties: n = English name, r = scale rank (0 largest), z = Natural
//     Earth min zoom
//   - lines simplified (Douglas-Peucker, ~300 m) and rounded to 3 decimals
// usage: node build-rivers.mjs
import fs from 'node:fs'

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson'
const OUT = new URL('../../public/maps/data/rivers.geojson', import.meta.url)
const TOLERANCE = 0.003 // degrees

function simplify (points, tol) {
  if (points.length < 3) return points
  const [ax, ay] = points[0]; const [bx, by] = points[points.length - 1]
  const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy) || 1
  let maxD = 0; let idx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]]
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)]
}
const round = (line) => line.map(([x, y]) => [Math.round(x * 1e3) / 1e3, Math.round(y * 1e3) / 1e3])

const src = await (await fetch(SOURCE)).json()
const features = src.features.filter(f => f.geometry).map(f => {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
  const p = f.properties
  return {
    type: 'Feature',
    properties: { n: p.name_en || p.name || '', r: p.scalerank, z: p.min_zoom },
    geometry: { type: 'MultiLineString', coordinates: lines.map(l => round(simplify(l, TOLERANCE))).filter(l => l.length > 1) }
  }
})
fs.mkdirSync(new URL('.', OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`rivers.geojson: ${features.length} rivers, ${Math.round(fs.statSync(OUT).size / 1024)} KB`)
