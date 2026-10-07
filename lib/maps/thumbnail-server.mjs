// Drop-in replacement for the Mapbox Static Images API, for PP thumbnails.
// Accepts the URL AssetGenerator builds today, so Rails only needs
// MAPBOX_STATIC_IMAGE_URL pointed here:
//
//   GET <base>/geojson(<url-encoded Feature>)/auto/304x138@2x[?access_token=...]
//
//   node thumbnail-server.mjs --pmtiles <url-or-path.pmtiles> [--port 8090] [--host 0.0.0.0]
//
// Only "auto" framing is supported (the only mode PP uses). The token is ignored.
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { availableParallelism } from 'node:os'
import { createRenderer } from './thumbnail-renderer.mjs'

const { values: opts } = parseArgs({
  options: {
    pmtiles: { type: 'string', default: process.env.PMTILES_URL },
    style: { type: 'string', default: 'unep-outdoor-terrain' },
    port: { type: 'string', default: process.env.PORT ?? '8090' },
    host: { type: 'string', default: '0.0.0.0' },
    concurrency: { type: 'string', default: String(Math.min(4, Math.max(1, availableParallelism() - 1))) }
  }
})
if (!opts.pmtiles) {
  console.error('Usage: node thumbnail-server.mjs --pmtiles <url-or-path.pmtiles> [--port 8090] [--host 0.0.0.0] [--concurrency n]')
  process.exit(1)
}

const PP_MARINE_FILL = '#3e7bb6'   // GeometryConcern#geometry_properties
const ROUTE = /\/geojson\((.+)\)\/auto\/(\d+)x(\d+)(@2x)?$/
const MAX_SIZE = 1280

// Rails URL-encodes the GeoJSON, then the whole URL: decode until stable.
function decodeGeojson (raw) {
  let s = raw
  for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(s); i++) s = decodeURIComponent(s)
  const g = JSON.parse(s)
  return g.type === 'FeatureCollection' ? g : { type: 'FeatureCollection', features: [g.type === 'Feature' ? g : { type: 'Feature', properties: {}, geometry: g }] }
}

// Limits concurrent renders (each one holds a GL context).
let running = 0
const waiting = []
async function limited (fn) {
  if (running >= Number(opts.concurrency)) await new Promise(resolve => waiting.push(resolve))
  running++
  try { return await fn() } finally { running--; waiting.shift()?.() }
}

const renderer = await createRenderer(opts)

const server = createServer({ maxHeaderSize: 1 << 20 }, async (req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
  const m = req.method === 'GET' && path.match(ROUTE)
  if (!m) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Expected /geojson(<feature>)/auto/<w>x<h>[@2x]')

  const t0 = performance.now()
  try {
    const [, raw, w, h, retina] = m
    const [width, height] = [Number(w), Number(h)]
    if (!width || !height || width > MAX_SIZE || height > MAX_SIZE) throw Object.assign(new Error('Invalid size'), { status: 422 })
    let fc
    try { fc = decodeGeojson(raw) } catch { throw Object.assign(new Error('Invalid GeoJSON'), { status: 422 }) }
    const props = fc.features[0]?.properties ?? {}
    const png = await limited(() => renderer.render(fc, {
      width, height, ratio: retina ? 2 : 1,
      marine: String(props.fill).toLowerCase() === PP_MARINE_FILL,
      overlay: props['fill-opacity'] !== 0   // countries and regions: framing only
    }))
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'public, max-age=86400' }).end(png)
    console.log(`200 ${width}x${height}${retina ?? ''} ${Math.round(performance.now() - t0)} ms`)
  } catch (err) {
    const status = err.status ?? 500
    res.writeHead(status, { 'Content-Type': 'text/plain' }).end(err.message)
    console.error(`${status} ${err.message} ${Math.round(performance.now() - t0)} ms`)
  }
})
server.listen(Number(opts.port), opts.host, () => console.log(`Thumbnail server on http://${opts.host}:${opts.port}/ (concurrency ${opts.concurrency})`))
