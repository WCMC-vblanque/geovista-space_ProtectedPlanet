// Map options preview only (MAP_OPTIONS_PREVIEW=true): collapsible legend to
// show/hide groups of map layers and change their opacity, to compare
// basemaps and overlays on real pages. Same logic as public/maps/compare.
const OVERLAY_NAMES = {
  terrestrial_wdpa: 'Protected areas (WDPA)',
  marine_wdpa: 'Marine protected areas',
  oecm: 'OECMs',
  oecm_marine: 'Marine OECMs',
  individual_site: 'This site',
  greenlist_terrestrial: 'Green List',
  greenlist_marine: 'Green List (marine)'
}
const SOURCE_LAYER_NAMES = {
  earth: 'Land', land: 'Land', landcover: 'Land cover', landuse: 'Land use', park: 'Parks',
  water: 'Water', waterway: 'Rivers', water_name: 'Water labels', roads: 'Roads', transportation: 'Roads',
  transportation_name: 'Road labels', places: 'Cities & places', place: 'Cities & places', pois: 'Points of interest',
  boundaries: 'Boundaries (OSM)', boundary: 'Boundaries (OSM)', buildings: 'Buildings', building: 'Buildings',
  aeroway: 'Airports', aerodrome_label: 'Airports'
}
const OPACITY_PROPS = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  raster: ['raster-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  background: ['background-opacity'],
  hillshade: ['hillshade-exaggeration']
}
const DEFAULT_OPACITY = { 'hillshade-exaggeration': 0.5 }
const STYLES = `
  .v-map-preview-legend { max-width: 260px; max-height: 60vh; overflow: auto; font: 12px/1.4 sans-serif; color: #222; }
  .v-map-preview-legend summary { cursor: pointer; padding: 6px 8px; font-weight: 600; }
  .v-map-preview-legend__rows { display: grid; gap: 4px; padding: 0 8px 8px; }
  .v-map-preview-legend__row { display: grid; grid-template-columns: 1fr 70px; gap: 6px; align-items: center; }
  .v-map-preview-legend__row label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .v-map-preview-legend__row input[type=range] { width: 70px; }
`

function groupName (layer) {
  const overlay = layer.id.match(/^(.+?)_\d+(__line|__point)?$/)
  if (overlay && OVERLAY_NAMES[overlay[1]]) { return `Overlay: ${OVERLAY_NAMES[overlay[1]]}` }
  if (layer.type === 'background') { return 'Background' }
  if (layer.type === 'hillshade') { return 'Relief (hillshade)' }
  if (layer.id.startsWith('national-park')) { return 'National parks (OSM)' }
  if (layer.source === 'un') {
    return layer.type === 'symbol' ? 'UN labels' : 'UN boundaries'
  }
  if (layer.type === 'raster') { return /ref/.test(layer.id) ? 'Reference labels (raster)' : 'Basemap image' }

  const name = SOURCE_LAYER_NAMES[layer['source-layer']] || layer['source-layer'] || layer.id
  return layer.type === 'symbol' && !/label|places|Points|Airports/i.test(name) ? `${name} labels` : name
}

const isZoom = (e) => Array.isArray(e) && e[0] === 'zoom'

// Scales an opacity value, keeping zoom curves valid (zoom must stay top level)
function scaleOpacity (value, factor) {
  if (value === undefined || value === null) { return factor }
  if (typeof value === 'number') { return value * factor }
  if (value.stops) { return { ...value, stops: value.stops.map(([z, v]) => [z, scaleOpacity(v, factor)]) } }
  if (Array.isArray(value) && String(value[0]).startsWith('interpolate') && isZoom(value[2])) {
    return value.map((v, i) => (i >= 4 && i % 2 === 0 ? scaleOpacity(v, factor) : v))
  }
  if (Array.isArray(value) && value[0] === 'step' && isZoom(value[1])) {
    return value.map((v, i) => (i === 2 || (i >= 4 && i % 2 === 0) ? scaleOpacity(v, factor) : v))
  }
  return ['*', value, factor]
}

export class PreviewLegendControl {
  constructor () {
    this.state = {}          // group -> { visible, opacity }, kept across basemap switches
    this.originals = {}      // layer id -> { paint prop -> original value }
    this.signature = ''
    this.onStyleLoad = () => { this.originals = {}; this.signature = '' }
    this.onStyleData = () => this.render()
  }

  onAdd (map) {
    this.map = map
    if (!document.getElementById('v-map-preview-legend-styles')) {
      const style = document.createElement('style')
      style.id = 'v-map-preview-legend-styles'
      style.textContent = STYLES
      document.head.appendChild(style)
    }
    this.container = document.createElement('details')
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group v-map-preview-legend'
    this.container.open = true
    this.container.innerHTML = '<summary>Layers (preview)</summary><div class="v-map-preview-legend__rows"></div>'
    map.on('style.load', this.onStyleLoad)
    map.on('styledata', this.onStyleData)
    return this.container
  }

  onRemove () {
    this.map.off('style.load', this.onStyleLoad)
    this.map.off('styledata', this.onStyleData)
    this.container.remove()
  }

  // Rebuilds only when layers were added or removed (overlays arrive late)
  render () {
    let layers
    try { layers = this.map.getStyle().layers } catch (e) { return }
    const signature = layers.map(l => l.id).join('|')
    if (signature === this.signature) { return }
    this.signature = signature

    this.groups = new Map()
    layers.forEach(layer => {
      if (!this.originals[layer.id]) {
        this.originals[layer.id] = Object.fromEntries((OPACITY_PROPS[layer.type] || []).map(p => [
          p, this.map.getPaintProperty(layer.id, p) ?? DEFAULT_OPACITY[p]
        ]))
      }
      const name = groupName(layer)
      if (!this.groups.has(name)) { this.groups.set(name, []) }
      this.groups.get(name).push(layer.id)
    })

    const rows = this.container.querySelector('.v-map-preview-legend__rows')
    rows.innerHTML = ''
    const names = [...this.groups.keys()].reverse()
    names.sort((x, y) => y.startsWith('Overlay') - x.startsWith('Overlay'))
    names.forEach(name => {
      const st = this.state[name] || (this.state[name] = { visible: true, opacity: 100 })
      const row = document.createElement('div')
      row.className = 'v-map-preview-legend__row'
      row.innerHTML = `<label title="${name}"><input type="checkbox" ${st.visible ? 'checked' : ''}> ${name}</label>` +
        `<input type="range" min="0" max="100" step="5" value="${st.opacity}" title="Opacity ${st.opacity}%">`
      const [check, range] = row.querySelectorAll('input')
      check.addEventListener('change', () => { st.visible = check.checked; this.apply(name) })
      range.addEventListener('input', () => {
        st.opacity = Number(range.value)
        range.title = `Opacity ${range.value}%`
        this.apply(name)
      })
      rows.appendChild(row)
      if (!st.visible || st.opacity !== 100) { this.apply(name) }
    })
  }

  apply (name) {
    const st = this.state[name]
    this.groups.get(name).forEach(id => {
      if (!this.map.getLayer(id)) { return }
      this.map.setLayoutProperty(id, 'visibility', st.visible ? 'visible' : 'none')
      Object.entries(this.originals[id] || {}).forEach(([prop, value]) => {
        this.map.setPaintProperty(id, prop, scaleOpacity(value, st.opacity / 100))
      })
    })
  }
}
