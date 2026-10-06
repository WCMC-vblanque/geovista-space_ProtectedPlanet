// Curved labels for seas, gulfs and bays: hand-drawn guide lines along the
// main axis of each water body (WGS84 lon/lat, approximate). Protomaps only
// stores these names as points, so they could not follow the shape.
// The point label of the same name is hidden where a guide line exists.
// Names follow UN usage; check sensitive names before production (issue #7).
const SEAS = [
  // name, [minzoom, maxzoom], size at minzoom, guide line
  ['Persian Gulf', [4.5, 9], 12, [[49.4, 29.0], [50.6, 27.8], [52.1, 26.8], [53.8, 26.2], [55.4, 25.9]]],
  ['Red Sea', [4, 9], 13, [[34.9, 26.8], [36.4, 24.2], [38.0, 21.6], [39.7, 18.4], [41.4, 15.6]]],
  ['Gulf of Oman', [5, 9], 11, [[57.0, 25.1], [58.3, 24.3], [59.6, 23.6]]],
  ['Gulf of Aden', [4.5, 9], 12, [[43.8, 12.3], [46.2, 12.6], [48.8, 13.0], [50.8, 12.8]]],
  ['Mediterranean Sea', [3.5, 7], 14, [[12.5, 34.6], [16.5, 34.0], [20.5, 33.9], [24.0, 34.0]]],
  ['Black Sea', [3.5, 8], 14, [[29.6, 43.4], [32.6, 43.1], [35.8, 42.9], [38.8, 42.4]]],
  ['Caspian Sea', [4, 8], 12, [[49.6, 45.3], [50.6, 42.8], [51.2, 40.0], [51.3, 38.0]]],
  ['Caribbean Sea', [3.5, 7], 14, [[-82.0, 14.6], [-76.0, 14.0], [-70.0, 14.3], [-65.5, 14.9]]],
  ['Gulf of Mexico', [3.5, 7], 14, [[-95.5, 25.0], [-91.0, 25.7], [-86.6, 25.4]]],
  ['Bay of Bengal', [3.5, 7], 14, [[83.5, 15.4], [87.5, 14.6], [91.5, 15.2]]],
  ['South China Sea', [3.5, 7], 14, [[108.6, 9.6], [112.0, 13.0], [115.6, 16.6]]],
  ['Sea of Japan', [4, 8], 13, [[131.0, 37.2], [134.0, 39.6], [137.0, 42.0]]],
  ['Yellow Sea', [4.5, 8], 12, [[123.4, 37.0], [123.7, 35.2], [124.0, 33.8]]],
  ['Gulf of Thailand', [5, 9], 11, [[100.8, 12.4], [101.4, 10.6], [102.6, 9.0]]],
  ['Andaman Sea', [4.5, 8], 12, [[95.8, 13.4], [96.3, 11.0], [96.6, 8.6]]],
  ['Sea of Okhotsk', [4, 8], 13, [[143.5, 52.0], [147.5, 54.0], [151.5, 55.6]]],
  ['Baltic Sea', [4.5, 8], 12, [[17.2, 55.5], [19.9, 57.0], [20.6, 59.0]]],
  ['Gulf of Bothnia', [5, 9], 11, [[20.0, 61.0], [20.6, 62.8], [22.6, 64.6]]],
  ['Gulf of Finland', [6, 10], 11, [[23.6, 59.6], [26.4, 59.95], [28.4, 60.05]]],
  ['North Sea', [4, 8], 13, [[2.6, 53.8], [3.4, 55.6], [3.6, 57.4]]],
  ['Adriatic Sea', [5, 9], 11, [[13.2, 44.5], [15.5, 42.8], [18.0, 41.5]]],
  ['Aegean Sea', [5.5, 9], 11, [[24.9, 39.6], [25.2, 38.6], [25.6, 37.6]]],
  ['Tyrrhenian Sea', [5.5, 9], 11, [[11.6, 40.6], [13.0, 39.8], [14.4, 39.1]]],
  ['Ionian Sea', [5.5, 9], 11, [[18.0, 38.6], [18.8, 37.4], [19.8, 36.4]]],
  ['Gulf of Guinea', [3.5, 7], 13, [[-2.6, 3.4], [1.0, 2.8], [4.6, 2.6], [7.4, 2.4]]],
  ['Mozambique Channel', [4.5, 8], 12, [[42.3, -14.5], [41.8, -18.5], [40.5, -22.5]]],
  ['Hudson Bay', [4, 8], 13, [[-89.5, 57.6], [-86.4, 59.6], [-84.2, 61.6]]],
  ['Gulf of California', [5, 9], 11, [[-113.5, 30.0], [-111.4, 27.5], [-109.5, 24.8]]],
  ['Gulf of Carpentaria', [5, 9], 11, [[139.4, -12.6], [139.6, -14.4], [139.8, -16.0]]],
  ['Coral Sea', [3.5, 7], 13, [[150.0, -14.0], [153.5, -16.5], [156.0, -20.0]]],
  ['Tasman Sea', [3.5, 7], 13, [[156.0, -36.5], [160.0, -38.5], [164.0, -40.0]]],
  ['Arabian Sea', [3.5, 7], 14, [[60.5, 16.0], [64.5, 14.6], [68.5, 15.2]]]
]

export const SEA_NAMES = SEAS.map(([name]) => name)

export const seaLabelSource = {
  type: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: SEAS.map(([name, [minzoom, maxzoom], size, coordinates]) => ({
      type: 'Feature',
      properties: { name, minzoom, maxzoom, size },
      geometry: { type: 'LineString', coordinates }
    }))
  }
}

export function seaLabelLayer (color, halo) {
  return {
    id: 'sea-label-curved',
    type: 'symbol',
    source: 'sea-labels',
    filter: ['all', ['>=', ['zoom'], ['get', 'minzoom']], ['<', ['zoom'], ['get', 'maxzoom']]],
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['+', ['get', 'size'], 2], 8, ['+', ['get', 'size'], 6]],
      'text-letter-spacing': 0.18,
      'text-max-angle': 35,
      'text-keep-upright': true,
      'text-allow-overlap': false
    },
    paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 0.8 }
  }
}

// Filter that hides the point label of a water body drawn by a guide line
export const notCurvedSea = ['!', ['in', ['coalesce', ['get', 'name:en'], ['get', 'name'], ''], ['literal', SEA_NAMES]]]
