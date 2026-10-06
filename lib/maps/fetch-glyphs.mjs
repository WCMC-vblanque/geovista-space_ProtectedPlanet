// Downloads the glyph files (SDF fonts, .pbf) used by UNEP Outdoor into
// public/maps/fonts, so the style needs no third-party font server.
// Only the ranges up to U+2FFF (Latin, Greek, Cyrillic, punctuation):
// UNEP Outdoor shows English names only.
//   - Noto Sans (OFL): Protomaps basemaps-assets
//   - Roboto Condensed (OFL/Apache-2.0): VersaTiles; narrow DIN-like
//     capitals for country names
// usage: node fetch-glyphs.mjs
import fs from 'node:fs'
import path from 'node:path'

const OUT = new URL('../../public/maps/fonts/', import.meta.url)
const PROTOMAPS = 'https://protomaps.github.io/basemaps-assets/fonts'
const VERSATILES = 'https://tiles.versatiles.org/assets/glyphs'
const FONTS = {
  'Noto Sans Regular': `${PROTOMAPS}/Noto Sans Regular`,
  'Noto Sans Medium': `${PROTOMAPS}/Noto Sans Medium`,
  'Noto Sans Italic': `${PROTOMAPS}/Noto Sans Italic`,
  'Roboto Condensed SemiBold': `${VERSATILES}/roboto_condensed_semibold`
}
const RANGES = Array.from({ length: 48 }, (_, i) => `${i * 256}-${i * 256 + 255}`)

for (const [name, base] of Object.entries(FONTS)) {
  const dir = path.join(OUT.pathname.replace(/^\/([A-Z]:)/, '$1'), name)
  fs.mkdirSync(dir, { recursive: true })
  let n = 0
  await Promise.all(RANGES.map(async (range) => {
    const res = await fetch(`${base}/${range}.pbf`)
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 20) return // empty range
    fs.writeFileSync(path.join(dir, `${range}.pbf`), buf)
    n++
  }))
  console.log(`${name}: ${n} ranges`)
}
