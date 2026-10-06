// Copy to config.local.js (git-ignored) to pre-fill the playground fields.
// Anyone who can open the playground can read these values: use a temporary,
// public (pk.) Mapbox token restricted to the playground URL, and delete it
// in the Mapbox console when testing is over.
window.PLAYGROUND_CONFIG = {
  mapboxToken: '',                                   // e.g. 'pk.…'
  pmtilesUrl: 'http://172.20.0.161:8082/basemap-z10.json'
}
