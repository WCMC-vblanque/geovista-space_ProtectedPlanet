// Headless thumbnail renderer (MapLibre Native, no browser), shared by the
// CLI (render-thumbnail.mjs) and the HTTP service (thumbnail-server.mjs).
import { readFile } from 'node:fs/promises'
import mbgl from '@maplibre/maplibre-gl-native'
import { PNG } from 'pngjs'
import { PMTiles } from 'pmtiles'
import { thumbnailStyle, fitCamera, siteBbox, THUMB_SIZE } from '../../public/maps/thumbnail-style.mjs'

const MAPS = new URL('../../public/maps/', import.meta.url)

/**
 * Creates a renderer bound to one PMTiles archive and one basemap style.
 *
 * @param {{pmtiles: string, style?: string}} opts - PMTiles URL; style name in public/maps/preview/.
 * @returns {Promise<{render: function(object, object=): Promise<Buffer>}>}
 */
export async function createRenderer ({ pmtiles, style: styleName = 'unep-outdoor-terrain' }) {
  const archive = new PMTiles(pmtiles)

  const base = JSON.parse(await readFile(new URL(`preview/${styleName}.json`, MAPS), 'utf8'))
  const { maxZoom } = await archive.getHeader()
  for (const src of Object.values(base.sources)) {
    if (src.url === '__PMTILES_URL__' || src.tiles?.[0] === '__PMTILES_TILES__') {
      delete src.url
      src.tiles = ['pmtiles://{z}/{x}/{y}']
      src.maxzoom = maxZoom
    }
  }
  base.glyphs = base.glyphs.replace('__GLYPHS__', new URL('fonts', MAPS).href)

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
  const request = ({ url }, callback) => load(url).then(data => callback(null, data ? { data } : {}), err => callback(err))

  /**
   * Renders a site thumbnail framed on its geometry.
   *
   * @param {object} fc - GeoJSON FeatureCollection of the site.
   * @param {{marine?: boolean, overlay?: boolean, width?: number, height?: number, ratio?: number}} [opts]
   * @returns {Promise<Buffer>} PNG of width*ratio x height*ratio pixels.
   */
  function render (fc, { marine = false, overlay = true, width = THUMB_SIZE.width, height = THUMB_SIZE.height, ratio = 2 } = {}) {
    const camera = fitCamera(siteBbox(fc), { width, height })
    const map = new mbgl.Map({ request, ratio })
    map.load(thumbnailStyle(base, fc, { marine, overlay }))
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
