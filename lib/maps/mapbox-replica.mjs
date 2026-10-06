// Replica of the previous Mapbox style "UNEP Basemap (APPROVED - 14/04/21) -
// Faint" (unepwcmc/cko1hsfi50vog17l697cr4d6p) on Protomaps tiles.
//
// Only layers visible at zoom <= 10 (PP's maximum) are translated. Paint
// values are copied from the Mapbox style; Mapbox Streets attributes are
// mapped to the Protomaps schema (class -> kind / kind_detail). Substitutes:
//   - fonts: DIN Pro -> Noto Sans (Mapbox fonts are Mapbox-only)
//   - hillshade: Mapbox Terrain polygons -> raster-dem (AWS Terrain Tiles)
//   - UN boundaries/labels: Mapbox uploads -> UNEP-WCMC ArcGIS vector tiles
//   - city sizes: Mapbox symbolrank -> Protomaps population_rank (approx.)
const SOURCE = 'protomaps'
const FONT = { regular: ['Noto Sans Regular'], medium: ['Noto Sans Medium'], italic: ['Noto Sans Italic'] }

const LAND = ['interpolate', ['linear'], ['zoom'], 11, 'hsl(35, 25%, 93%)', 13, 'hsl(35, 9%, 91%)']
const WATER = '#b7d3db'
const WATER_SHADOW = 'rgb(178, 197, 219)'
const SHADOW_TRANSLATE = ['interpolate', ['exponential', 1.2], ['zoom'], 7, ['literal', [0, 0]], 16, ['literal', [-1, -1]]]
const LABEL_COLOR = 'hsl(230, 29%, 0%)'
const UN_HALO = ['interpolate', ['linear'], ['zoom'], 2, 'hsla(35, 16%, 100%, 0.75)', 3, 'hsl(35, 16%, 100%)']
const BOUNDARY_COLOR = 'hsl(230, 8%, 51%)'
const BOUNDARY_WIDTH = ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 2]

const kindIn = (kinds) => ['in', ['get', 'kind'], ['literal', kinds]]
const isLine = ['==', ['geometry-type'], 'LineString']
const isPolygon = ['==', ['geometry-type'], 'Polygon']
const name = ['coalesce', ['get', 'name:en'], ['get', 'name']]

// Mapbox landuse classes -> Protomaps landuse kinds
const LANDUSE = {
  park: ['park'],
  garden: ['garden', 'playground', 'zoo'],
  airport: ['aerodrome', 'airfield'],
  cemetery: ['cemetery'],
  glacier: ['glacier'],
  hospital: ['hospital'],
  pitch: ['pitch'],
  sand: ['sand', 'beach'],
  school: ['school', 'college', 'university', 'kindergarten'],
  agriculture: ['farmland', 'farmyard', 'orchard', 'vineyard', 'allotments'],
  wood: ['forest', 'wood'],
  grass: ['grass', 'grassland', 'meadow'],
  scrub: ['scrub', 'heath']
}
const landuseKind = (cls) => ['literal', LANDUSE[cls]]
const matchLanduse = (pairs, fallback) => [
  'match', ['get', 'kind'],
  ...pairs.flatMap(([classes, value]) => [[].concat(classes).flatMap(c => LANDUSE[c]), value]),
  fallback
]

const road = (id, details, minzoom, paint, layout = {}) => ({
  id,
  type: 'line',
  source: SOURCE,
  'source-layer': 'roads',
  ...(minzoom ? { minzoom } : {}),
  filter: ['all', isLine, ['in', ['get', 'kind_detail'], ['literal', details]]],
  layout: {
    'line-cap': ['step', ['zoom'], 'butt', 14, 'round'],
    'line-join': ['step', ['zoom'], 'miter', 14, 'round'],
    ...layout
  },
  paint
})

const ROAD_CASE_COLOR = 'hsl(230, 26%, 88%)'
const MAJOR_CASE_COLOR = 'hsl(230, 26%, 100%)'
const SECONDARY = ['secondary', 'tertiary']
const MAJOR_LINK = ['motorway_link', 'trunk_link']
const MOTORWAY = ['motorway', 'trunk']
const kindDetail = ['get', 'kind_detail']

// Layers beneath the UN boundaries
export function baseLayers () {
  return [
    { id: 'land', type: 'background', paint: { 'background-color': LAND } },
    { id: 'earth', type: 'fill', source: SOURCE, 'source-layer': 'earth', filter: isPolygon, paint: { 'fill-color': LAND } },
    {
      id: 'landcover-outdoors',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      maxzoom: 12,
      filter: kindIn(['forest', 'grassland', 'scrub', 'farmland', 'glacier']),
      paint: {
        'fill-color': ['match', ['get', 'kind'], 'glacier', 'hsl(35, 11%, 100%)', 'hsl(81, 37%, 83%)'],
        'fill-opacity': ['interpolate', ['exponential', 1.5], ['zoom'], 2, 0.3, 12, 0],
        'fill-antialias': false
      }
    },
    {
      id: 'national-park',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      minzoom: 5,
      filter: kindIn(['national_park', 'nature_reserve', 'protected_area']),
      paint: {
        'fill-color': 'hsl(99, 57%, 75%)',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6, 0.75, 10, 0.35]
      }
    },
    {
      id: 'national-park_tint-band',
      type: 'line',
      source: SOURCE,
      'source-layer': 'landuse',
      minzoom: 9,
      filter: kindIn(['national_park', 'nature_reserve', 'protected_area']),
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': 'hsl(99, 58%, 70%)',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 1, 14, 8],
        'line-offset': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 0, 14, -2.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 0.75],
        'line-blur': 3
      }
    },
    {
      id: 'landuse',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      minzoom: 5,
      filter: kindIn(Object.values(LANDUSE).flat()),
      paint: {
        'fill-color': matchLanduse([
          ['park', 'hsl(99, 57%, 75%)'],
          ['garden', 'hsl(99, 35%, 73%)'],
          ['airport', 'hsl(230, 12%, 92%)'],
          ['cemetery', 'hsl(81, 26%, 81%)'],
          ['glacier', 'rgb(251, 252, 253)'],
          ['hospital', 'hsl(340, 21%, 88%)'],
          ['pitch', 'hsl(99, 58%, 70%)'],
          ['sand', 'hsl(65, 46%, 89%)'],
          ['school', 'hsl(50, 46%, 82%)'],
          ['agriculture', 'hsl(81, 26%, 81%)'],
          [['wood', 'grass', 'scrub'], 'hsl(81, 25%, 66%)']
        ], 'hsl(35, 13%, 86%)'),
        'fill-opacity': ['interpolate', ['linear'], ['zoom'],
          5, 0,
          6, matchLanduse([[['agriculture', 'wood', 'grass', 'scrub'], 0], ['glacier', 0.5]], 1),
          15, matchLanduse([['agriculture', 0.75], [['wood', 'glacier'], 0.5], ['grass', 0.4], ['scrub', 0.2]], 1)
        ]
      }
    },
    {
      id: 'wetland',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      minzoom: 5,
      filter: kindIn(['wetland']),
      paint: { 'fill-color': 'rgb(211, 211, 211)', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.25, 10.5, 0.15] }
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        'hillshade-shadow-color': 'hsl(65, 35%, 21%)',
        'hillshade-highlight-color': 'hsl(35, 11%, 100%)',
        'hillshade-accent-color': 'hsl(65, 35%, 21%)',
        'hillshade-exaggeration': 0.2
      }
    },
    {
      id: 'waterway-shadow',
      type: 'line',
      source: SOURCE,
      'source-layer': 'water',
      minzoom: 8,
      filter: ['all', isLine, kindIn(['river', 'canal', 'stream'])],
      layout: { 'line-cap': ['step', ['zoom'], 'butt', 11, 'round'], 'line-join': 'round' },
      paint: {
        'line-color': WATER_SHADOW,
        'line-width': waterwayWidth(),
        'line-translate': SHADOW_TRANSLATE,
        'line-translate-anchor': 'viewport',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 8.5, 1]
      }
    },
    {
      id: 'water-shadow',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'water',
      filter: isPolygon,
      paint: { 'fill-color': WATER_SHADOW, 'fill-translate': SHADOW_TRANSLATE, 'fill-translate-anchor': 'viewport' }
    },
    {
      id: 'waterway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'water',
      minzoom: 8,
      filter: ['all', isLine, kindIn(['river', 'canal', 'stream'])],
      layout: { 'line-cap': ['step', ['zoom'], 'butt', 11, 'round'], 'line-join': 'round' },
      paint: {
        'line-color': WATER,
        'line-width': waterwayWidth(),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 8.5, 1]
      }
    },
    { id: 'water', type: 'fill', source: SOURCE, 'source-layer': 'water', filter: isPolygon, paint: { 'fill-color': WATER } },
    road('road-secondary-tertiary-case', SECONDARY, 8, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 0.75, 18, 2],
      'line-color': ROAD_CASE_COLOR,
      'line-gap-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.1, 18, 26],
      'line-opacity': ['step', ['zoom'], 0, 10, 1]
    }),
    road('road-primary-case', ['primary'], 7, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1, 18, 2],
      'line-color': ROAD_CASE_COLOR,
      'line-gap-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.75, 18, 32],
      'line-opacity': ['step', ['zoom'], 0, 10, 1]
    }),
    road('road-major-link-case', MAJOR_LINK, 10, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.75, 20, 2],
      'line-color': MAJOR_CASE_COLOR,
      'line-gap-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 14, 2, 18, 18],
      'line-opacity': ['step', ['zoom'], 0, 11, 1]
    }),
    road('road-motorway-trunk-case', MOTORWAY, 5, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1, 18, 2],
      'line-color': MAJOR_CASE_COLOR,
      'line-gap-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.75, 18, 32],
      'line-opacity': ['step', ['zoom'], ['match', kindDetail, 'motorway', 1, 0], 6, 1]
    }),
    road('road-major-link', MAJOR_LINK, 10, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 14, 2, 18, 18],
      'line-color': ['match', kindDetail, 'motorway_link', 'hsl(26, 67%, 68%)', 'hsl(46, 69%, 68%)']
    }, { 'line-cap': ['step', ['zoom'], 'butt', 13, 'round'], 'line-join': ['step', ['zoom'], 'miter', 13, 'round'] }),
    road('road-secondary-tertiary', SECONDARY, 8, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.1, 18, 26],
      'line-color': 'hsl(0, 0%, 100%)'
    }),
    road('road-primary', ['primary'], 6, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.75, 18, 32],
      'line-color': 'hsl(0, 0%, 100%)'
    }),
    road('road-motorway-trunk', MOTORWAY, 0, {
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.75, 18, 32],
      'line-color': ['step', ['zoom'],
        ['match', kindDetail, 'motorway', 'hsl(26, 74%, 62%)', 'hsl(0, 0%, 100%)'],
        6, ['match', kindDetail, 'motorway', 'hsl(26, 74%, 62%)', 'hsl(46, 67%, 60%)'],
        9, ['match', kindDetail, 'motorway', 'hsl(26, 67%, 68%)', 'hsl(46, 69%, 68%)']
      ]
    }, { 'line-cap': ['step', ['zoom'], 'butt', 13, 'round'], 'line-join': ['step', ['zoom'], 'miter', 13, 'round'] })
  ]
}

function waterwayWidth () {
  return ['interpolate', ['exponential', 1.3], ['zoom'],
    9, ['match', ['get', 'kind'], ['canal', 'river'], 0.1, 0],
    20, ['match', ['get', 'kind'], ['canal', 'river'], 8, 3]
  ]
}

// Labels between the UN boundaries and the UN labels
export function labelLayers (placesLayout) {
  const waterKinds = ['ocean', 'sea', 'bay', 'strait', 'lake', 'water', 'reservoir']
  const isSeaLike = ['match', ['get', 'kind'], ['ocean', 'sea', 'bay', 'strait'], true, false]

  return [
    {
      id: 'water-point-label',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'water',
      filter: ['all', ['==', ['geometry-type'], 'Point'], kindIn(waterKinds)],
      layout: {
        'text-field': name,
        'text-font': FONT.italic,
        'text-line-height': 1.3,
        // Mapbox sizerank -> kind
        'text-size': ['interpolate', ['linear'], ['zoom'],
          2, ['match', ['get', 'kind'], 'ocean', 14, ['sea', 'bay', 'strait'], 11, 10],
          7, ['match', ['get', 'kind'], 'ocean', 24, ['sea', 'bay', 'strait'], 18, 12],
          10, ['match', ['get', 'kind'], ['ocean', 'sea', 'bay', 'strait'], 18, 12]
        ],
        'text-letter-spacing': ['match', ['get', 'kind'], 'ocean', 0.25, ['bay', 'sea'], 0.15, 0.01],
        'text-max-width': ['match', ['get', 'kind'], 'ocean', 4, 'sea', 5, ['bay', 'water', 'lake'], 7, 10]
      },
      paint: { 'text-color': ['case', isSeaLike, 'rgb(119, 167, 181)', 'rgb(143, 145, 147)'] }
    },
    {
      id: 'Cities',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'places',
      minzoom: 4,
      maxzoom: 15.5,
      filter: ['all', ['==', ['get', 'kind'], 'locality'], ['>=', ['zoom'], ['get', 'min_zoom']]],
      layout: {
        ...placesLayout,
        'icon-image': ['step', ['zoom'], ['case', ['==', ['get', 'capital'], 'yes'], 'capital', 'townspot'], 8, ''],
        // UN naming rules from the Mapbox style
        'text-field': ['case',
          ['==', ['get', 'name:en'], 'Vatican City'], 'Holy See',
          ['==', ['get', 'name:en'], 'Macau'], 'Macau, SAR CHINA',
          ['match', ['get', 'name'], ['', 'Ma`tan as Sarah'], true, false], '',
          ['match', ['get', 'name:en'], ['Hala’ib', 'Abyei'], true, false], '',
          name
        ],
        'text-transform': ['match', ['get', 'name:en'], ['Vatican City'], 'uppercase', 'none'],
        'text-font': FONT.regular,
        'text-line-height': 1.1,
        'text-max-width': 7,
        // Mapbox symbolrank (lower = bigger) -> population_rank (higher = bigger)
        'text-size': ['interpolate', ['cubic-bezier', 0.2, 0, 0.9, 1], ['zoom'],
          3, ['step', ['get', 'population_rank'], 8.5, 9, 9.5, 11, 10.5, 13, 12],
          13, ['step', ['get', 'population_rank'], 15, 9, 17, 11, 19, 12, 21, 13, 25]
        ],
        'symbol-sort-key': ['-', 20, ['get', 'population_rank']]
      },
      paint: { 'text-color': LABEL_COLOR, 'text-halo-color': 'hsl(35, 16%, 100%)', 'text-halo-width': 1, 'text-halo-blur': 1 }
    }
  ]
}

// UN boundary lines (ArcGIS) restyled like the Mapbox admin-0 layers
export function restyleUnBoundaries (lines) {
  const dash = (id) => {
    if (/dash and a dot/i.test(id)) return [2, 1.5, 0.8, 1.5]
    if (/more dotted/i.test(id)) return [0.7, 1.5]
    if (/dashed/i.test(id)) return [2, 1.5]
    return null
  }

  return lines.flatMap(l => {
    const dasharray = dash(l.id)
    const line = {
      ...l,
      paint: { 'line-color': BOUNDARY_COLOR, 'line-width': BOUNDARY_WIDTH, ...(dasharray ? { 'line-dasharray': dasharray } : {}) }
    }
    if (dasharray) return [line]

    // Continuous international boundaries also get the soft background band
    const background = {
      ...l,
      id: `${l.id} background`,
      paint: {
        'line-color': ['interpolate', ['linear'], ['zoom'], 6, 'hsl(35, 9%, 91%)', 8, 'hsl(230, 49%, 91%)'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.5, 10, 8],
        'line-opacity': 0.5,
        'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 0, 10, 2]
      }
    }
    return [background, line]
  })
}

// UN labels (ArcGIS) restyled like the Mapbox un-labels-* layers
export function restyleUnLabels (labels) {
  const styleFor = (id) => {
    if (/Member State/.test(id)) return { minzoom: 3, font: FONT.medium, size: [11, 18], uppercase: true }
    if (/Palestin|Vatican/.test(id)) return { minzoom: 3.5, font: FONT.medium, size: [7, 14], uppercase: true }
    if (/Territor|Antarctica/.test(id)) return { minzoom: 3, font: FONT.regular, size: [9, 14], uppercase: false }
    return { minzoom: 4, font: FONT.medium, size: [7, 14], uppercase: false } // special regions, undetermined
  }

  return labels.map(l => {
    const s = styleFor(l.id)
    const { maxzoom, ...rest } = l
    return {
      ...rest,
      minzoom: s.minzoom,
      layout: {
        ...l.layout,
        'text-font': s.font,
        'text-size': ['interpolate', ['cubic-bezier', 0.2, 0, 0.7, 1], ['zoom'], 1, s.size[0], 9, s.size[1]],
        'text-line-height': 1.1,
        'text-max-width': 6,
        'text-transform': s.uppercase ? 'uppercase' : 'none'
      },
      paint: {
        'text-color': LABEL_COLOR,
        'text-halo-color': UN_HALO,
        'text-halo-width': 1.25,
        'text-opacity': ['step', ['zoom'], 0, 1, 1, 9, 0]
      }
    }
  })
}

// v2: tuned against screenshots of the Mapbox style at zooms 1-11
//   - roads from zoom 5 (Mapbox tiles have none before)
//   - UN boundaries from zoom 2 (none at world view)
//   - city labels: national capitals only, up to zoom 8 (Mapbox filter
//     capital <= 2; larger zooms show no place labels)
//   - forests drawn soft green like the Mapbox protected forests
//   - slightly smaller country labels (Noto Sans is wider than DIN Pro)
export function tuneV2 (style) {
  const layers = style.layers.map(l => {
    if (l.id === 'road-motorway-trunk') return { ...l, minzoom: 5 }
    if (l.id.startsWith('un-boundary-')) return { ...l, minzoom: Math.max(l.minzoom || 0, 2) }
    if (l.id === 'Cities') {
      return {
        ...l,
        maxzoom: 8,
        filter: ['all', ['==', ['get', 'kind'], 'locality'], ['==', ['get', 'capital'], 'yes']]
      }
    }
    if (l.id.startsWith('un-label-') && /Member State/.test(l.id)) {
      return { ...l, layout: { ...l.layout, 'text-size': ['interpolate', ['cubic-bezier', 0.2, 0, 0.7, 1], ['zoom'], 1, 10, 9, 16] } }
    }
    return l
  })

  const forest = {
    id: 'forest',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    minzoom: 5,
    filter: kindIn(['forest', 'wood']),
    paint: {
      'fill-color': 'hsl(99, 45%, 78%)',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6, 0.55, 10, 0.35, 13, 0.2]
    }
  }
  layers.splice(layers.findIndex(l => l.id === 'national-park'), 0, forest)

  return { ...style, name: 'PP Terrain (Mapbox UNEP Faint replica v2 on PMTiles)', layers }
}
