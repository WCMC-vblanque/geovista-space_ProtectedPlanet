// "UNEP Outdoor": original basemap design for Protected Planet on
// self-hosted Protomaps tiles. Built from the Protomaps basemaps layers
// (BSD-3-Clause, Protomaps LLC / Kelso Cartography); the Mapbox style is NOT
// used as input. Design choices (own):
//   - quiet warm paper land, soft cyan water: the protected-area overlays
//     (green/blue/yellow) must stay the strongest colours on the map
//   - vegetation in muted sage greens kept at every zoom (Protomaps only
//     stores landcover to zoom 7: a second source overzooms it)
//   - no OSM national parks / reserves by default: protection is shown only
//     by PP's WDPA/OECM overlays (variant "+ OSM parks" keeps them)
//   - English names only: labels without an English name are hidden when
//     the local name is in a non-Latin script (Arabic, Hebrew, ...)
//   - territory labels break before "(": "Guernsey" / "(UK)"
//   - river names follow the river from zoom 8
//   - large letter-spaced italic ocean names
//   - hillshade in a cool grey-green, faint, beneath water
//   - roads discreet and all the same colour (white on a warm grey
//     casing); hierarchy shown by width only; no road number shields;
//     none before zoom 5
//   - capitals: solid slate-teal dot with a white ring; other towns: small
//     hollow dot
//   - label hierarchy (fixed, not by population): country names largest
//     (UN, upper case) > capitals (regular) > other cities (smaller, lighter)
//   - all capitals appear together from zoom 5 (tiles hold ~90% of them at
//     zoom 5, all at 6), other cities from zoom 6; capitals win collisions;
//     English names only; no POIs
//   - UN boundaries/labels from UNEP-WCMC ArcGIS in slate grey, dashed
//     styles per UN boundary type
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'

const PALETTE = {
  paper: '#f2efe6',
  water: '#aed2e3',
  waterLabel: '#6a98ae',
  protected: '#c3dfab',
  protectedEdge: '#a8cf8b',
  // Kept pale so the PP protected-area overlays (#38A800) stay dominant
  park: '#d3e6c3',
  parkAlt: '#cbe1b9',
  wood: '#e0e9d2',
  woodAlt: '#dae5ca',
  scrub: '#e8ebd6',
  grass: '#e5ecd8',
  farmland: '#ece9da',
  sand: '#eee4ca',
  glacier: '#ffffff',
  urban: '#ebe7de',
  road: '#ffffff',
  roadCasing: '#ddd5c3',
  motorwayCasing: '#cdc4b1',
  capital: '#2f4b4f',
  minor: '#fbfaf6',
  minorCasing: '#e6e0d2',
  rail: '#d3cfc6',
  building: '#e4dfd4',
  text: '#3b3d40',
  halo: '#f7f5ef',
  boundary: '#8e92a0',
  relief: '#56685c'
}

// Low-zoom vegetation tint (Protomaps landcover kinds)
const LANDCOVER = {
  forest: '#d6e6c2',
  grassland: '#e2ebcf',
  scrub: '#e5e9cf',
  farmland: '#eaebd8',
  barren: '#f2efe6',
  urban_area: '#ebe7de',
  glacier: '#ffffff'
}

const FONT = { regular: ['Noto Sans Regular'], medium: ['Noto Sans Medium'], italic: ['Noto Sans Italic'] }

function flavor () {
  const base = namedFlavor('light')
  return {
    ...base,
    background: PALETTE.paper,
    earth: PALETTE.paper,
    park_a: PALETTE.park,
    park_b: PALETTE.parkAlt,
    wood_a: PALETTE.wood,
    wood_b: PALETTE.woodAlt,
    scrub_a: PALETTE.scrub,
    scrub_b: PALETTE.scrub,
    glacier: PALETTE.glacier,
    sand: PALETTE.sand,
    beach: PALETTE.sand,
    water: PALETTE.water,
    buildings: PALETTE.building,
    // One road colour: every highway/major/link variant (incl. tunnels and
    // bridges) is white; casings warm grey, a bit darker for motorways
    ...Object.fromEntries(Object.keys(base)
      .filter(k => /(highway|major|link)(_casing)?(_early|_late)?$/.test(k) && !k.startsWith('roads_label'))
      .map(k => [k, k.includes('casing') ? (k.includes('highway') ? PALETTE.motorwayCasing : PALETTE.roadCasing) : PALETTE.road])),
    minor_a: PALETTE.minor,
    minor_b: PALETTE.minor,
    minor_service: PALETTE.minor,
    minor_casing: PALETTE.minorCasing,
    minor_service_casing: PALETTE.minorCasing,
    railway: PALETTE.rail,
    ocean_label: PALETTE.waterLabel,
    city_label: PALETTE.text,
    city_label_halo: PALETTE.halo,
    subplace_label: '#77736b',
    subplace_label_halo: PALETTE.halo,
    roads_label_major: '#6e6a62',
    roads_label_major_halo: PALETTE.halo,
    roads_label_minor: '#8a857c',
    roads_label_minor_halo: PALETTE.halo,
    landcover: {
      ...base.landcover,
      grassland: PALETTE.grass,
      barren: PALETTE.paper,
      urban_area: PALETTE.urban,
      farmland: PALETTE.farmland,
      glacier: PALETTE.glacier,
      scrub: PALETTE.scrub,
      forest: PALETTE.wood
    }
  }
}

// English name; local name only when it is in Latin script (Protomaps sets
// "script" for non-Latin names); otherwise no label
const EN_NAME = ['coalesce', ['get', 'name:en'], ['case', ['has', 'script'], '', ['get', 'name']]]

// OSM layers replaced by UN ones, and details too busy for PP
const DROP = /^(boundaries|places_country|places_region|pois|address_label|roads_shields)|^landcover$/
const isRoad = (id) => id.startsWith('roads_') && !id.startsWith('roads_label')

// Protomaps layers with the UNEP Outdoor palette and rules
export function outdoorLayers (source = 'protomaps') {
  return protomapsLayers(source, flavor(), { lang: 'en' })
    .filter(l => !DROP.test(l.id))
    .map(l => (l.type === 'symbol' && l.layout && l.layout['text-field'] ? { ...l, layout: { ...l.layout, 'text-field': EN_NAME } } : l))
    .map(l => {
      if (l.id === 'roads_highway') {
        return { ...l, minzoom: 5, paint: { ...l.paint, 'line-width': MOTORWAY_WIDTH } }
      }
      if (/^roads_highway_casing/.test(l.id)) {
        return { ...l, minzoom: Math.max(l.minzoom || 0, 5), paint: { ...l.paint, 'line-gap-width': MOTORWAY_WIDTH } }
      }
      if (isRoad(l.id)) return { ...l, minzoom: Math.max(l.minzoom || 0, 5) }
      if (l.id === 'water_waterway_label') {
        return {
          ...l,
          minzoom: 8,
          filter: ['in', ['get', 'kind'], ['literal', ['river', 'canal']]],
          layout: { ...l.layout, 'symbol-placement': 'line', 'text-font': FONT.italic, 'text-size': 11, 'text-letter-spacing': 0.1, 'symbol-spacing': 350 },
          paint: { 'text-color': PALETTE.waterLabel, 'text-halo-color': PALETTE.halo, 'text-halo-width': 1 }
        }
      }
      if (l.id === 'water_label_ocean') {
        return {
          ...l,
          layout: {
            ...l.layout,
            'text-size': ['interpolate', ['linear'], ['zoom'], 1, 12, 4, 17, 8, 15],
            'text-letter-spacing': 0.22,
            'text-transform': 'none',
            'text-max-width': 6
          },
          paint: { 'text-color': PALETTE.waterLabel, 'text-halo-width': 0 }
        }
      }
      if (l.id === 'places_locality') {
        return {
          ...l,
          minzoom: CAPITALS_FROM,
          filter: ['all', ['==', ['get', 'kind'], 'locality'],
            ['any', IS_CAPITAL, ['all', ['>=', ['zoom'], CITIES_FROM], ['>=', ['zoom'], ['+', ['get', 'min_zoom'], 1]]]]],
          layout: {
            ...l.layout,
            'text-font': FONT.regular,
            // capitals always smaller than country names (10 -> 14 at zooms 2-6)
            'text-size': ['interpolate', ['linear'], ['zoom'],
              5, ['case', IS_CAPITAL, 10, 9],
              8, ['case', IS_CAPITAL, 12, 10.5],
              12, ['case', IS_CAPITAL, 14, 12.5]],
            'symbol-sort-key': ['case', IS_CAPITAL, 0, ['+', 10, ['get', 'min_zoom']]],
            // capitals get their own marker (capitalMarker); towns keep the hollow dot
            'icon-image': ['step', ['zoom'], ['case', ['==', ['get', 'capital'], 'yes'], '', 'townspot'], 8, ''],
            'text-radial-offset': 0.6
          },
          paint: { ...l.paint, 'text-color': ['case', IS_CAPITAL, PALETTE.text, '#5c5e62'], 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.2 }
        }
      }
      return l
    })
}

// Vegetation tint on a landcover-only source capped at zoom 7, so MapLibre
// keeps drawing it (overzoomed) at higher zooms
export const LANDCOVER_SOURCE = 'protomaps-landcover'
export const landcoverLayer = {
  id: 'landcover',
  type: 'fill',
  source: LANDCOVER_SOURCE,
  'source-layer': 'landcover',
  paint: {
    'fill-color': ['match', ['get', 'kind'], ...Object.entries(LANDCOVER).flat(), PALETTE.paper],
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 11, 0.6, 14, 0.25],
    'fill-antialias': false
  }
}

// OSM national parks, nature reserves and protected areas
export const protectedLandLayers = [
  {
    id: 'protected-land',
    type: 'fill',
    source: 'protomaps',
    'source-layer': 'landuse',
    minzoom: 3,
    filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'nature_reserve', 'protected_area']]],
    paint: { 'fill-color': PALETTE.protected, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 10, 0.5, 14, 0.35] }
  },
  {
    id: 'protected-land-edge',
    type: 'line',
    source: 'protomaps',
    'source-layer': 'landuse',
    minzoom: 8,
    filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'nature_reserve', 'protected_area']]],
    paint: { 'line-color': PALETTE.protectedEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] }
  }
]

export const hillshadeLayer = {
  id: 'hillshade',
  type: 'hillshade',
  source: 'dem',
  paint: {
    'hillshade-shadow-color': PALETTE.relief,
    'hillshade-highlight-color': '#ffffff',
    'hillshade-accent-color': PALETTE.relief,
    'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.15, 8, 0.3, 12, 0.2]
  }
}

// Same appearance zoom for every capital; other cities only after them
const CAPITALS_FROM = 5
const CITIES_FROM = 6
const IS_CAPITAL = ['==', ['get', 'capital'], 'yes']

// Width is the only road hierarchy: motorways wider than other roads
const MOTORWAY_WIDTH = ['interpolate', ['exponential', 1.6], ['zoom'], 5, 0.8, 8, 1.6, 12, 2.6, 15, 6, 18, 17]

// Capital marker: solid slate-teal dot with a white ring, until zoom 8
export const capitalMarker = {
  id: 'capital-marker',
  type: 'circle',
  source: 'protomaps',
  'source-layer': 'places',
  minzoom: CAPITALS_FROM,
  maxzoom: 8,
  filter: ['all', ['==', ['get', 'kind'], 'locality'], IS_CAPITAL],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 4],
    'circle-color': PALETTE.capital,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.3
  }
}

// UN boundaries: slate grey, own dash patterns per UN boundary type
export function outdoorUnBoundaries (lines) {
  const dash = (id) => {
    if (/dash and a dot/i.test(id)) return [4, 2, 1, 2]
    if (/more dotted/i.test(id)) return [1, 2]
    if (/dashed/i.test(id)) return [3, 2]
    return null
  }
  return lines.map(l => {
    const dasharray = dash(l.id)
    return {
      ...l,
      minzoom: Math.max(l.minzoom || 0, 2),
      paint: {
        'line-color': PALETTE.boundary,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 0.9, 10, 1.6],
        ...(dasharray ? { 'line-dasharray': dasharray } : {})
      }
    }
  })
}

// "{_name2}" (ArcGIS token) -> text with a line break before "(":
// "Guernsey (UK)" -> "Guernsey" / "(UK)"
function breakBeforeParenthesis (token) {
  const text = ['to-string', ['get', String(token).replace(/[{}]/g, '')]]
  const i = ['index-of', ' (', text]
  return ['case', ['>', i, 0], ['concat', ['slice', text, 0, i], '\n', ['slice', text, ['+', i, 1]]], text]
}

// UN labels: letter-spaced capitals for member states, italic for others
export function outdoorUnLabels (labels) {
  return labels.map(l => {
    const isMemberState = /Member State/.test(l.id)
    const { minzoom, maxzoom, ...rest } = l
    return {
      ...rest,
      minzoom: isMemberState ? 2 : 3.5,
      maxzoom: 9,
      layout: {
        ...l.layout,
        'text-field': breakBeforeParenthesis(l.layout['text-field']),
        'text-font': isMemberState ? FONT.medium : FONT.italic,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, isMemberState ? 10 : 8.5, 6, isMemberState ? 14 : 12],
        'text-transform': isMemberState ? 'uppercase' : 'none',
        'text-letter-spacing': isMemberState ? 0.08 : 0.02,
        'text-max-width': 7
      },
      paint: { 'text-color': '#45474c', 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.4 }
    }
  })
}

// "UNEP Outdoor + terrain": same design with relief as a feature
//   - elevation tint (MapLibre color-relief): green lowlands, warm uplands,
//     pale high mountains; kept light so overlays stay dominant
//   - multidirectional hillshade (4 light directions), stronger than 2a
const ELEVATION_TINT = [
  -500, '#e2ebd6',
  0, '#e2ebd4',
  200, '#e6ecd1',
  500, '#eaebce',
  1000, '#ebe5c9',
  1800, '#e7dbc1',
  2800, '#e1d3bf',
  3800, '#ebe7e1',
  5000, '#ffffff'
]

export function withTerrain (style) {
  const layers = style.layers.filter(l => l.id !== 'hillshade')
  const reliefTint = {
    id: 'relief-tint',
    type: 'color-relief',
    source: 'dem',
    paint: {
      'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...ELEVATION_TINT],
      'color-relief-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 0.5, 12, 0.3]
    }
  }
  const hillshade = {
    id: 'hillshade',
    type: 'hillshade',
    source: 'dem',
    paint: {
      'hillshade-method': 'multidirectional',
      'hillshade-illumination-direction': [270, 315, 0, 45],
      'hillshade-highlight-color': ['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.4)'],
      'hillshade-shadow-color': ['#56645a', '#4c5a51', '#56645a', '#5e6b62'],
      'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 8, 0.55, 12, 0.45]
    }
  }
  layers.splice(layers.findIndex(l => l.id === 'landcover') + 1, 0, reliefTint)
  layers.splice(layers.findIndex(l => l.id === 'water'), 0, hillshade)
  return { ...style, name: 'UNEP Outdoor + terrain (original design, self-hosted PMTiles + UN boundaries)', layers }
}
