// Preview switch to compare candidate basemaps on real pages (docs/maps.md).
// Enabled only when built with MAP_OPTIONS_PREVIEW=true. URL parameters:
//   ?basemap=<style>    replaces the Terrain baselayer
//   ?satellite=<style>  replaces the Satellite baselayer
//   ?pmtiles=<url>      .pmtiles file or TileJSON URL for the pmtiles styles
//                       (default: PMTILES_BASEMAP_URL)
// <style> is a file name in public/maps/preview/ without .json.
const PREVIEW_PATH = '/maps/preview'
const PMTILES_PLACEHOLDER = '__PMTILES_URL__'
const PARAMS_BY_BASELAYER = { terrain: 'basemap', satellite: 'satellite' }

export const isMapPreviewEnabled = () => process.env.MAP_OPTIONS_PREVIEW === 'true'

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
