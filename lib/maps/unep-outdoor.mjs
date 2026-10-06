// "UNEP Outdoor": original basemap design for Protected Planet on
// self-hosted Protomaps tiles. Built from the Protomaps basemaps layers
// (BSD-3-Clause, Protomaps LLC / Kelso Cartography); the Mapbox style is NOT
// used as input. Design choices (own):
//   - quiet warm paper land, soft cyan water: the protected-area overlays
//     (green/blue/yellow) must stay the strongest colours on the map
//   - vegetation in muted sage greens kept at every zoom (Protomaps only
//     stores landcover to zoom 7: a second source overzooms it)
//   - OSM national parks / reserves in soft green from zoom 3
//   - large letter-spaced italic ocean names
//   - hillshade in a cool grey-green, faint, beneath water
//   - roads discreet: amber motorways, white majors on a sand casing,
//     appearing progressively (no roads before zoom 5)
//   - places: capitals from zoom 3, other cities one zoom later than
//     Protomaps' default; English names only; no POIs
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
  motorway: '#e6ae78',
  motorwayCasing: '#cf955f',
  major: '#ffffff',
  majorCasing: '#ddd5c3',
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
    highway: PALETTE.motorway,
    highway_casing_early: PALETTE.motorwayCasing,
    highway_casing_late: PALETTE.motorwayCasing,
    major: PALETTE.major,
    major_casing_early: PALETTE.majorCasing,
    major_casing_late: PALETTE.majorCasing,
    link: PALETTE.major,
    link_casing: PALETTE.majorCasing,
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

// OSM layers replaced by UN ones, and details too busy for PP
const DROP = /^(boundaries|places_country|places_region|pois|address_label)|^landcover$/
const isRoad = (id) => id.startsWith('roads_') && !id.startsWith('roads_label')

// Protomaps layers with the UNEP Outdoor palette and rules
export function outdoorLayers (source = 'protomaps') {
  return protomapsLayers(source, flavor(), { lang: 'en' })
    .filter(l => !DROP.test(l.id))
    .map(l => {
      if (isRoad(l.id)) return { ...l, minzoom: Math.max(l.minzoom || 0, 5) }
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
          minzoom: 3,
          filter: ['all', ['==', ['get', 'kind'], 'locality'],
            ['any', ['==', ['get', 'capital'], 'yes'], ['>=', ['zoom'], ['+', ['get', 'min_zoom'], 1]]]],
          layout: { ...l.layout, 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']] },
          paint: { ...l.paint, 'text-color': PALETTE.text, 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.2 }
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
