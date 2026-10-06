/* eslint-disable no-undef */

export default {
  methods: {
    addControls () {
      if (this.controlsOptions.showZoom) {
        this.addZoomControls()
      }

      this.map.addControl(
        new maplibregl.AttributionControl(), 
        this.controlsOptions.attributionLocation
      )
    },

    addZoomControls () {
      this.map.addControl(
        new maplibregl.NavigationControl({
          showCompass: this.controlsOptions.showCompass
        })
      )
    }
  }
}