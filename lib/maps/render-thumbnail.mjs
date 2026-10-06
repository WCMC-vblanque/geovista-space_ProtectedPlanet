// Renders PA thumbnails to PNG files, for the comparison playground.
//
//   node render-thumbnail.mjs --pmtiles <url.pmtiles> [--style name] [--out dir] <site_id>...
//
// Site geometry comes from the WDPA MapServer here; in PP it is
// GeometryConcern#geojson, sent to thumbnail-server.mjs.
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createRenderer } from './thumbnail-renderer.mjs'

const WDPA_MS = 'https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer'

const { values: opts, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    pmtiles: { type: 'string' },
    style: { type: 'string', default: 'unep-outdoor-terrain' },
    out: { type: 'string', default: fileURLToPath(new URL('../../public/maps/thumbs/', import.meta.url)) }
  }
})
if (!opts.pmtiles || !ids.length) {
  console.error('Usage: node render-thumbnail.mjs --pmtiles <url.pmtiles> [--style name] [--out dir] <site_id>...')
  process.exit(1)
}

async function siteGeojson (id) {
  for (const layer of [1, 0]) {   // polygons, then points
    const q = `${WDPA_MS}/${layer}/query?where=site_id%3D${id}&outFields=realm&outSR=4326&maxAllowableOffset=0.003&geometryPrecision=3&f=geojson`
    const fc = await fetch(q).then(r => r.json())
    if (fc.features?.length) return fc
  }
  throw new Error(`site_id ${id} not found`)
}

const renderer = await createRenderer(opts)
await mkdir(opts.out, { recursive: true })
for (const id of ids) {
  const t0 = performance.now()
  try {
    const fc = await siteGeojson(id)
    const png = await renderer.render(fc, { marine: fc.features.some(f => f.properties.realm !== 'Terrestrial') })
    await writeFile(join(opts.out, `${id}.png`), png)
    console.log(`${id}: ${Math.round(performance.now() - t0)} ms, ${(png.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    console.error(`${id}: ${err.message}`)
  }
}
