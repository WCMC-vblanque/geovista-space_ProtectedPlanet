// Preview switch to compare candidate basemaps on real pages (docs/maps.md).
// Enabled only when built with MAP_OPTIONS_PREVIEW=true. URL parameters:
//   ?basemap=<style>    replaces the Terrain baselayer
//   ?satellite=<style>  replaces the Satellite baselayer
//   ?pmtiles=<url>      .pmtiles file or TileJSON URL for the pmtiles styles
//                       (default: PMTILES_BASEMAP_URL)
//   ?overlays=vector    WDPA/OECM raster tiles replaced by the WDPCA vector
//                       tiles (ArcGIS Hosted/WDPCA), not capped at zoom 10
// <style> is a file name in public/maps/preview/ without .json.
const PREVIEW_PATH = '/maps/preview'
const PMTILES_PLACEHOLDER = '__PMTILES_URL__'
const PARAMS_BY_BASELAYER = { terrain: 'basemap', satellite: 'satellite' }

const WDPCA_VECTOR_TILES = 'https://data-gis.unep-wcmc.org/server/rest/services/Hosted/WDPCA/VectorTileServer'
const REALM_COLOR = ['match', ['get', 'realm'], 'Terrestrial', '#38A800', ['Coastal', 'Marine'], '#004DA8', '#999999']
const IS_PA = ['==', ['get', 'site_type'], 'PA']

// Keyed by the overlay id (map_helper.rb OVERLAYS) of each raster_tile overlay
const VECTOR_OVERLAYS = {
  terrestrial_wdpa: { filter: IS_PA, color: REALM_COLOR },
  marine_wdpa: { filter: ['all', IS_PA, ['in', ['get', 'realm'], ['literal', ['Coastal', 'Marine']]]], color: '#004DA8' },
  oecm: { filter: ['==', ['get', 'site_type'], 'OECM'], color: '#D9B143' }
}

export const WDPCA_SOURCE_ID = 'preview-wdpca'
export const WDPCA_SOURCE = { type: 'vector', tiles: [`${WDPCA_VECTOR_TILES}/tile/{z}/{y}/{x}.pbf`], maxzoom: 16 }
export const WDPCA_POLY_LAYER = 'WDPCA_poly_latest'
export const WDPCA_POINT_LAYER = 'WDPCA_point_latest'
// A vector overlay is drawn as 3 map layers: <id> (fill), <id>__line, <id>__point
export const VECTOR_SUBLAYER_SUFFIXES = ['__line', '__point']

export const isMapPreviewEnabled = () => process.env.MAP_OPTIONS_PREVIEW === 'true'

const previewParam = (name) => isMapPreviewEnabled()
  ? new URLSearchParams(window.location.search).get(name)
  : null

// Vector replacement for a serialized raster_tile layer (id '<overlay>_<n>')
export function previewVectorOverlay (layer) {
  if (layer.type !== 'raster_tile' || previewParam('overlays') !== 'vector') { return null }

  return VECTOR_OVERLAYS[layer.id.replace(/_\d+$/, '')] || null
}


const pmtilesSourceUrl = (url) => url.endsWith('.pmtiles') ? `pmtiles://${url}` : url

async function loadPreviewStyle (name, pmtilesUrl) {
  const res = await fetch(`${PREVIEW_PATH}/${encodeURIComponent(name)}.json`)
  if (!res.ok) throw new Error(`Unknown preview basemap '${name}'`)

  const style = await res.json()
  Object.values(style.sources).forEach(source => {
    if (source.url !== PMTILES_PLACEHOLDER) { return }
    if (!pmtilesUrl) throw new Error(`'${name}' needs ?pmtiles=<url> or PMTILES_BASEMAP_URL`)
    source.url = pmtilesSourceUrl(pmtilesUrl)
  })
  return style
}

// Resolves to the baselayers with preview styles swapped in, or null when the
// preview is disabled, not requested, or fails (the defaults are then kept).
export async function loadPreviewBaselayers (baselayers) {
  if (!isMapPreviewEnabled()) { return null }

  const params = new URLSearchParams(window.location.search)
  const pmtilesUrl = params.get('pmtiles') || process.env.PMTILES_BASEMAP_URL
  const requested = baselayers.filter(b => params.get(PARAMS_BY_BASELAYER[b.id]))
  if (!requested.length) { return null }

  try {
    return await Promise.all(baselayers.map(async baselayer => {
      const name = params.get(PARAMS_BY_BASELAYER[baselayer.id])
      if (!name) { return baselayer }

      return {
        ...baselayer,
        name: `${baselayer.name} (${name})`,
        style: await loadPreviewStyle(name, pmtilesUrl)
      }
    }))
  } catch (e) {
    console.warn(`[map preview] ${e.message}; using default basemaps`)
    return null
  }
}
