import { executeAfterCondition } from '../../../helpers/timing-helpers'

export default {
  data () {
    return {
      // null until the style has loaded; undefined means 'add on top'
      firstForegroundLayerId: null,
    }
  },

  methods: {
    setFirstForegroundLayerId () {
      this.firstForegroundLayerId = this.getFirstForegroundLayerId()
    },

    getFirstForegroundLayerId () {
      let firstBoundaryId = ''
      let firstSymbolId = ''
    
      for (const layer of this.map.getStyle().layers) {
        // Matches Mapbox ('admin-0-boundary') and OpenMapTiles ('boundary_2') ids
        if (layer.id.match('boundary')) {
          firstBoundaryId = layer.id
          break
        } else if (layer.type === 'symbol') {
          firstSymbolId = layer.id
        }
      }
    
      // Styles without labels or boundaries (e.g. imagery only): add on top
      return firstBoundaryId || firstSymbolId || undefined
    },

    executeAfterStyleLoad (cb) {
      executeAfterCondition(
        () => typeof this.map.isStyleLoaded === 'function' && this.map.isStyleLoaded(), 
        cb
      )
    }
  }
}