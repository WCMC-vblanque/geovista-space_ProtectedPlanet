// Headless thumbnail renderer (MapLibre Native, no browser), shared by the
// CLI (render-thumbnail.mjs) and the HTTP service (thumbnail-server.mjs).
import { readFile } from 'node:fs/promises'
import mbgl from '@maplibre/maplibre-gl-native'
import { PNG } from 'pngjs'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { thumbnailStyle, fitCamera, siteBbox, THUMB_SIZE } from './thumbnail-style.mjs'

const MAPS = new URL('../../public/maps/', import.meta.url)

/**
 * Creates a renderer bound to one basemap tile server and one basemap style.
 *
 * @param {{tilejson: string, style?: string}} opts - TileJSON URL of the basemap, as served by
 *   `pmtiles serve` for the interactive map; style name in public/maps/preview/.
 * @returns {Promise<{render: function(object, object=): Promise<Buffer>}>}
 */
export async function createRenderer ({ tilejson, style: styleName = 'unep-outdoor-terrain' }) {
  const tj = await fetch(tilejson).then(r => r.json()).catch(() => null)
  if (!tj?.tiles?.length) throw new Error(`Cannot read the TileJSON at ${tilejson}: is \`pmtiles serve\` running?`)
  const [template] = tj.tiles
  const maxZoom = tj.maxzoom ?? 14

  const base = JSON.parse(await readFile(new URL(`preview/${styleName}.json`, MAPS), 'utf8'))
  for (const src of Object.values(base.sources)) {
    if (src.url === '__PMTILES_URL__' || src.tiles?.[0] === '__PMTILES_TILES__') {
      delete src.url
      src.tiles = [template]
      src.maxzoom = maxZoom
    }
    if (typeof src.data === 'string' && src.data.startsWith('__DATA__')) src.data = src.data.replace('__DATA__', new URL('data', MAPS).href)
  }
  base.glyphs = base.glyphs.replace('__GLYPHS__', new URL('fonts', MAPS).href)

  // MapLibre Native asks the host for every resource (tiles, glyphs, sprites).
  async function load (url) {
    if (url.startsWith('file:')) return readFile(new URL(url)).catch(() => null)
    const res = await fetch(url)
    if (res.status === 404 || res.status === 204) return null
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return Buffer.from(await res.arrayBuffer())
  }
  // Localities from tiles one zoom deeper than the view (low-zoom tiles hold
  // only the largest cities), as GeoJSON for the thumbnail town labels.
  async function placesFor ({ center: [lng, lat], zoom }, width, height) {
    const z = Math.min(Math.floor(zoom) + 1, maxZoom)
    const n = 2 ** z
    const scale = n / (512 * 2 ** zoom)   // view px -> tile units at z
    const cx = (lng + 180) / 360 * n
    const cy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n
    const dx = width / 2 * scale, dy = height / 2 * scale
    const tiles = []
    for (let x = Math.floor(cx - dx); x <= Math.floor(cx + dx); x++) {
      for (let y = Math.max(0, Math.floor(cy - dy)); y <= Math.min(n - 1, Math.floor(cy + dy)); y++) tiles.push([((x % n) + n) % n, y])
    }
    const seen = new Set(), features = []
    await Promise.all(tiles.map(async ([x, y]) => {
      const tile = await load(template.replace('{z}', z).replace('{x}', x).replace('{y}', y))
      const layer = tile && new VectorTile(new Pbf(tile)).layers.places
      for (let i = 0; i < (layer?.length ?? 0); i++) {
        const f = layer.feature(i)
        if (f.properties.kind !== 'locality' || seen.has(f.id ?? f.properties.name)) continue
        seen.add(f.id ?? f.properties.name)
        features.push(f.toGeoJSON(x, y, z))
      }
    }))
    return { type: 'FeatureCollection', features }
  }

  const request = ({ url }, callback) => load(url).then(data => callback(null, data ? { data } : {}), err => callback(err))

  /**
   * Renders a site thumbnail framed on its geometry.
   *
   * @param {object} fc - GeoJSON FeatureCollection of the site.
   * @param {{marine?: boolean, overlay?: boolean, width?: number, height?: number, ratio?: number}} [opts]
   * @returns {Promise<Buffer>} PNG of width*ratio x height*ratio pixels.
   */
  async function render (fc, { marine = false, overlay = true, width = THUMB_SIZE.width, height = THUMB_SIZE.height, ratio = 2 } = {}) {
    const camera = fitCamera(siteBbox(fc), { width, height })
    const places = await placesFor(camera, width, height)
    const map = new mbgl.Map({ request, ratio })
    map.load(thumbnailStyle(base, fc, { marine, overlay, places }))
    return new Promise((resolve, reject) => map.render({ ...camera, width, height }, (err, pixels) => {
      map.release()
      if (err) return reject(err)
      const png = new PNG({ width: width * ratio, height: height * ratio })
      png.data = Buffer.from(pixels)
      resolve(PNG.sync.write(png))
    }))
  }

  return { render }
}
