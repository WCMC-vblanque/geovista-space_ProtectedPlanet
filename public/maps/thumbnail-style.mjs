// Thumbnail style shared by the server renderer (lib/maps/thumbnail-renderer.mjs)
// and the comparison playground, so both draw the same image.
//
// Base: UNEP Outdoor + terrain, plus seafloor relief (hillshade over water)
// and a bathymetry tint. The site is drawn from its GeoJSON, as PP does today
// with Mapbox Static Images: no dependency on the WDPCA vector tiles.

export const THUMB_SIZE = { width: 304, height: 138 }

// Fills as PP's GeometryConcern#geometry_properties. The marine outline is
// lighter than PP's (#2E5387) to stand out over dark bathymetry.
const SITE_COLORS = {
  marine: { fill: '#3E7BB6', stroke: '#d4e6f4', width: 1.25 },
  terrestrial: { fill: '#83ad35', stroke: '#40541b', width: 0.75 }
}

const BATHYMETRY = ['interpolate', ['linear'], ['elevation'],
  -8000, 'rgba(20, 62, 112, 0.55)', -4000, 'rgba(35, 92, 145, 0.45)', -1000, 'rgba(65, 125, 172, 0.32)',
  -200, 'rgba(105, 160, 198, 0.2)', -1, 'rgba(150, 195, 220, 0.06)', 0, 'rgba(0, 0, 0, 0)']

/**
 * Adds seafloor relief, bathymetry and the site overlay to a basemap style.
 *
 * @param {object} base - UNEP Outdoor + terrain style (needs the `dem` source and a `water` layer).
 * @param {object} site - GeoJSON Feature or FeatureCollection of the site.
 * @param {{marine?: boolean, overlay?: boolean}} [opts] - Marine sites are drawn in blue,
 *   others in green; `overlay: false` only frames the geometry (country and region covers).
 * @returns {object} A new style object.
 */
export function thumbnailStyle (base, site, { marine = false, overlay = true } = {}) {
  const style = structuredClone(base)
  const water = style.layers.findIndex(l => l.id === 'water')
  // Above the opaque water fill: depth tint, then shaded seafloor
  style.layers.splice(water + 1, 0,
    { id: 'bathymetry', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': BATHYMETRY } },
    {
      id: 'seafloor-hillshade', type: 'hillshade', source: 'dem',
      paint: {
        'hillshade-exaggeration': 0.3,
        'hillshade-shadow-color': 'rgba(20, 50, 80, 0.6)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.25)',
        'hillshade-accent-color': 'rgba(0, 0, 0, 0)'
      }
    })
  if (!overlay) return style

  const c = SITE_COLORS[marine ? 'marine' : 'terrestrial']
  style.sources.site = { type: 'geojson', data: site }
  const before = style.layers.findIndex(l => l.type === 'symbol')
  style.layers.splice(before, 0,
    { id: 'site-fill', type: 'fill', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.fill, 'fill-opacity': 0.7 } },
    { id: 'site-line', type: 'line', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': c.stroke, 'line-width': c.width } },
    { id: 'site-point', type: 'circle', source: 'site', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': c.fill, 'circle-radius': 5, 'circle-stroke-color': c.stroke, 'circle-stroke-width': 1 } })
  return style
}

const R = 6378137
const toMerc = (x, y) => [x * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) * R]
const toLngLat = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]

/**
 * Camera that fits a lon/lat bbox into the thumbnail, like Mapbox "auto".
 *
 * @param {{xmin:number, ymin:number, xmax:number, ymax:number}} e - Bbox in EPSG:4326.
 * @param {{width?:number, height?:number, pad?:number, maxZoom?:number}} [opts]
 * @returns {{center:[number, number], zoom:number}} Camera for 512 px tiles.
 */
export function fitCamera (e, { width = THUMB_SIZE.width, height = THUMB_SIZE.height, pad = 0.1, maxZoom = 12 } = {}) {
  const [x0, y0] = toMerc(e.xmin, e.ymin), [x1, y1] = toMerc(e.xmax, e.ymax)
  const dx = Math.max((x1 - x0) * (1 + 2 * pad), 1), dy = Math.max((y1 - y0) * (1 + 2 * pad), 1)
  const world = 2 * Math.PI * R
  const zoom = Math.min(maxZoom, Math.log2(Math.min(width * world / (512 * dx), height * world / (512 * dy))))
  return { center: toLngLat((x0 + x1) / 2, (y0 + y1) / 2), zoom: Math.max(0, zoom) }
}

/**
 * Lon/lat bbox of a FeatureCollection; sites crossing the antimeridian are
 * measured on 0–360. Point-only sites get a margin so they are not over-zoomed.
 *
 * @param {object} fc - GeoJSON FeatureCollection.
 * @param {number} [pointPad=0.2] - Margin in degrees for point sites.
 * @returns {{xmin:number, ymin:number, xmax:number, ymax:number}}
 */
export function siteBbox (fc, pointPad = 0.2) {
  const extent = (shift) => {
    const e = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity }
    const walk = c => {
      if (typeof c[0] !== 'number') return c.forEach(walk)
      const x = shift ? (c[0] + 360) % 360 : c[0]
      e.xmin = Math.min(e.xmin, x); e.xmax = Math.max(e.xmax, x)
      e.ymin = Math.min(e.ymin, c[1]); e.ymax = Math.max(e.ymax, c[1])
    }
    fc.features.forEach(f => walk(f.geometry.coordinates))
    return e
  }
  let e = extent(false)
  if (e.xmax - e.xmin > 180) {
    const shifted = extent(true)
    if (shifted.xmax - shifted.xmin < e.xmax - e.xmin) e = shifted
  }
  const d = fc.features.every(f => /Point/.test(f.geometry.type)) ? pointPad : 0
  return { xmin: e.xmin - d, ymin: e.ymin - d, xmax: e.xmax + d, ymax: e.ymax + d }
}
