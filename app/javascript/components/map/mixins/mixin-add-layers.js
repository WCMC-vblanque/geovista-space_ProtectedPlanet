import {
  WDPCA_POINT_LAYER,
  WDPCA_POLY_LAYER,
  WDPCA_SOURCE,
  WDPCA_SOURCE_ID
} from '../preview-options'

const addPaintOptions = (options, layer) => {
  if (layer.isPoint) {
    options['type'] = 'circle'
    options['paint'] = { 
      'circle-radius': [
        'interpolate',
        ['exponential', 1],
        ['zoom'],
        0, 1.5,
        6, 4
      ],
      'circle-color': layer.color,
      'circle-opacity': 0.7
    }
  } else {
    options['type'] = 'fill'
    options['paint'] = {
      'fill-color': layer.color,
      'fill-opacity': 0.8,
    }
  }
}

export default {

  methods: {
    addRasterTileLayer (layer) {
      if(!this.hasExistingMapLayer(layer.id)) {
        this.map.addLayer({
          id: layer.id,
          type: 'raster',
          minzoom: 0,
          maxzoom: 22,
          source: {
            type: 'raster',
            tiles: [layer.url],
            tileSize: 128,
          },
          layout: {
            visibility: 'visible'
          }
        }, this.firstForegroundLayerId)
      }
    },

    addRasterDataLayer(layer) {
      if(!this.hasExistingMapLayer(layer.id)) {
        const options = {
          id: layer.id,
          source: {
            type: 'geojson',
            data: layer.url
          },
          layout: {
            visibility: 'visible'
          }
        }
        
        addPaintOptions(options, layer)

        this.map.addLayer(options, this.firstForegroundLayerId) 
      }
    },

    // Map options preview only (?overlays=vector)
    addVectorTileLayer (layer, vectorOverlay) {
      if (this.hasExistingMapLayer(layer.id)) { return }

      if (!this.map.getSource(WDPCA_SOURCE_ID)) {
        this.map.addSource(WDPCA_SOURCE_ID, WDPCA_SOURCE)
      }

      const common = {
        source: WDPCA_SOURCE_ID,
        filter: vectorOverlay.filter,
        layout: { visibility: 'visible' }
      }
      const color = vectorOverlay.color

      this.map.addLayer({
        ...common, id: layer.id, type: 'fill', 'source-layer': WDPCA_POLY_LAYER,
        paint: { 'fill-color': color, 'fill-opacity': 0.5 }
      }, this.firstForegroundLayerId)
      this.map.addLayer({
        ...common, id: `${layer.id}__line`, type: 'line', 'source-layer': WDPCA_POLY_LAYER,
        paint: { 'line-color': color, 'line-width': 0.6 }
      }, this.firstForegroundLayerId)
      this.map.addLayer({
        ...common, id: `${layer.id}__point`, type: 'circle', 'source-layer': WDPCA_POINT_LAYER,
        paint: {
          'circle-color': color,
          'circle-opacity': 0.7,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.5, 6, 2.5, 12, 4.5]
        }
      }, this.firstForegroundLayerId)
    },

    hasExistingMapLayer (id) {
      const existingMapLayer = this.map.getLayer(id)

      return typeof existingMapLayer !== 'undefined'
    }
  },
}
