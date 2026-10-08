#!/usr/bin/env node
// Builds an Esri Vector Tile Package (.vtpk) of the UNEP-WCMC Nature basemap
// from the same PMTiles extract, to publish on ArcGIS Server / Enterprise.
// No ArcGIS Pro needed: the PMTiles tiles are already Mapbox Vector Tiles
// (512 px Web Mercator grid, same as Esri's), so they are copied as they are
// into Esri Compact Cache V2 bundles.
//
// Package layout (zip, stored without compression):
//   esriinfo/iteminfo.xml, esriinfo/item.pkinfo       item description
//   p12/root.json                                      VectorTileServer metadata
//   p12/tile/Lzz/R<rrrr>C<cccc>.bundle                 tiles, 128 x 128 per bundle
//   p12/resources/styles/root.json                     Esri-compatible style
//   p12/resources/fonts/<font>/<range>.pbf             glyphs (public/maps/fonts)
//   p12/resources/sprites/sprite(.json|.png|@2x)       icons (Protomaps light)
//
// The Esri style only keeps what ArcGIS clients can draw from these tiles:
// land, water, roads, places... UN boundaries/labels, hillshade, rivers z2-9
// and the computed country labels are separate sources in the web style;
// in ArcGIS add the WCMC UN_Boundaries_Labels service on top.
// Web pages keep the full MapLibre style: only its tile URL changes to
// <service>/VectorTileServer/tile/{z}/{y}/{x}.pbf.
//
// usage (from lib/maps):
//   node build-vtpk.mjs --source ~/pmtiles/basemap-z10.pmtiles --maxzoom 10 --out unep-wcmc-nature.vtpk
//   node build-vtpk.mjs --source https://build.protomaps.com/20261006.pmtiles --maxzoom 3 --out test.vtpk
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'
import { PMTiles } from 'pmtiles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, '../../public/maps')
const SPRITE = 'https://protomaps.github.io/basemaps-assets/sprites/v4/light'
const PACKET = 128 // tiles per bundle side (Compact Cache V2)
const ORIGIN = 20037508.342787
const RES0 = 78271.51696402048 // Esri vector tile LOD 0: 512 px tile = whole world

// --- Arguments --------------------------------------------------------------
const args = {}
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const SOURCE = (args.source || '').replace(/^~/, os.homedir())
const MAXZOOM = Number(args.maxzoom ?? 10)
const OUT = path.resolve(args.out || 'unep-wcmc-nature.vtpk')
const NAME = args.name || 'UNEP-WCMC Nature'
if (!SOURCE) { console.error('usage: node build-vtpk.mjs --source <file.pmtiles|url> [--maxzoom 10] [--out file.vtpk]'); process.exit(1) }

// PMTiles reader for a local file (the library reads URLs by itself)
class LocalSource {
  constructor (file) { this.file = file; this.fd = fs.openSync(file, 'r') }
  getKey () { return this.file }
  async getBytes (offset, length) {
    const buf = Buffer.alloc(length)
    const n = fs.readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}
const archive = new PMTiles(/^https?:/.test(SOURCE) ? SOURCE : new LocalSource(SOURCE))

// --- Tiles -> Compact Cache V2 bundles ---------------------------------------
// Header: 64 bytes, then a 128 x 128 index of 8-byte records (bits 0-39 =
// offset of the tile data, bits 40-63 = size), then each tile prefixed by its
// 4-byte size. Spec: github.com/Esri/raster-tiles-compactcache
function bundleBuffer (tiles) {
  const INDEX = PACKET * PACKET * 8
  const parts = []
  const index = Buffer.alloc(INDEX)
  let offset = 64 + INDEX
  let maxSize = 0
  for (const [i, data] of tiles) {
    const size = Buffer.alloc(4); size.writeUInt32LE(data.length)
    parts.push(size, data)
    offset += 4
    index.writeBigUInt64LE(BigInt(offset) + (BigInt(data.length) << 40n), i * 8)
    offset += data.length
    maxSize = Math.max(maxSize, data.length)
  }
  const header = Buffer.alloc(64)
  header.writeUInt32LE(3, 0) // version
  header.writeUInt32LE(PACKET * PACKET, 4) // record count
  header.writeUInt32LE(maxSize, 8) // maximum tile size
  header.writeUInt32LE(5, 12) // offset byte count
  header.writeBigUInt64LE(0n, 16) // slack space
  header.writeBigUInt64LE(BigInt(offset), 24) // file size
  header.writeBigUInt64LE(40n, 32) // user header offset
  header.writeUInt32LE(20 + INDEX, 40) // user header size
  header.writeUInt32LE(3, 44); header.writeUInt32LE(16, 48) // legacy
  header.writeUInt32LE(PACKET * PACKET, 52); header.writeUInt32LE(5, 56) // legacy
  header.writeUInt32LE(INDEX, 60) // index size
  return Buffer.concat([header, index, ...parts])
}

const gz = (data) => (data[0] === 0x1f && data[1] === 0x8b ? data : zlib.gzipSync(data))

async function writeBundles (dir) {
  let count = 0
  for (let z = 0; z <= MAXZOOM; z++) {
    const n = 2 ** z
    const levelDir = path.join(dir, `L${String(z).padStart(2, '0')}`)
    fs.mkdirSync(levelDir, { recursive: true })
    for (let r0 = 0; r0 < n; r0 += PACKET) {
      for (let c0 = 0; c0 < n; c0 += PACKET) {
        const tiles = []
        for (let r = r0; r < Math.min(r0 + PACKET, n); r++) {
          const row = await Promise.all(Array.from({ length: Math.min(PACKET, n - c0) }, (_, k) => archive.getZxy(z, c0 + k, r)))
          row.forEach((t, k) => { if (t && t.data.byteLength) tiles.push([(r - r0) * PACKET + k, gz(Buffer.from(t.data))]) })
        }
        if (!tiles.length) continue
        const hex = (v) => v.toString(16).padStart(4, '0')
        fs.writeFileSync(path.join(levelDir, `R${hex(r0)}C${hex(c0)}.bundle`), bundleBuffer(tiles))
        count += tiles.length
      }
    }
    console.log(`level ${z}: done (${count} tiles so far)`)
  }
  return count
}

// --- Metadata -----------------------------------------------------------------
const lods = Array.from({ length: MAXZOOM + 1 }, (_, z) => ({
  level: z, resolution: RES0 / 2 ** z, scale: 295828763.7957775 / 2 ** z
}))
const extent = { xmin: -ORIGIN, ymin: -ORIGIN, xmax: ORIGIN, ymax: ORIGIN, spatialReference: { wkid: 102100, latestWkid: 3857 } }

const rootJson = () => ({
  currentVersion: 10.91,
  name: NAME,
  copyrightText: 'Protomaps, © OpenStreetMap contributors (ODbL); style UNEP-WCMC',
  capabilities: 'TilesOnly',
  type: 'vector',
  defaultStyles: 'resources/styles',
  tiles: ['tile/{z}/{y}/{x}.pbf'],
  exportTilesAllowed: false,
  initialExtent: extent,
  fullExtent: extent,
  minScale: 0,
  maxScale: lods[lods.length - 1].scale,
  tileInfo: {
    rows: 512, cols: 512, dpi: 96, format: 'pbf',
    origin: { x: -ORIGIN, y: ORIGIN },
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    lods
  },
  maxzoom: MAXZOOM,
  minLOD: 0,
  maxLOD: MAXZOOM,
  resourceInfo: {
    styleVersion: 8,
    tileCompression: 'gzip',
    cacheInfo: { storageInfo: { packetSize: PACKET, storageFormat: 'compactV2' } }
  }
})

// Esri style: the basemap layers of UNEP-WCMC Nature that read these tiles
function esriStyle () {
  const web = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'preview/unep-outdoor.json'), 'utf8'))
  const layers = web.layers
    .filter(l => l.type === 'background' || ['protomaps', 'protomaps-landcover'].includes(l.source))
    .map(l => (l.source ? { ...l, source: 'esri' } : l))
  return {
    version: 8,
    name: NAME,
    sources: { esri: { type: 'vector', url: '../../', attribution: rootJson().copyrightText } },
    glyphs: '../fonts/{fontstack}/{range}.pbf',
    sprite: '../sprites/sprite',
    layers
  }
}

const itemInfo = () => `<?xml version="1.0" encoding="utf-8"?>
<ESRI_ItemInformation Culture="en-US">
  <name>${NAME}</name>
  <title>${NAME}</title>
  <type>Vector Tile Package</type>
  <typekeywords><typekeyword>Vector Tile Package</typekeyword><typekeyword>tpkx</typekeyword></typekeywords>
  <summary>UNEP-WCMC Nature basemap (Protomaps / OpenStreetMap), Web Mercator, zoom 0-${MAXZOOM}</summary>
  <description>Built by lib/maps/build-vtpk.mjs from a PMTiles extract. Add the UN boundaries and labels service on top.</description>
  <accessinformation>Protomaps, © OpenStreetMap contributors (ODbL); style UNEP-WCMC</accessinformation>
  <tags><tag>basemap</tag><tag>UNEP-WCMC</tag><tag>vector tiles</tag></tags>
</ESRI_ItemInformation>
`
const pkInfo = () => `<?xml version="1.0" encoding="utf-8"?>
<pkinfo Culture="en-US">
  <ID>{${randomUUID().toUpperCase()}}</ID>
  <name>${NAME}</name>
  <version>2.0</version>
  <size>-1</size>
  <created>${new Date().toISOString()}</created>
  <type>Vector Tile Package</type>
  <servable>true</servable>
  <packagelocation></packagelocation>
  <pkinfolocation></pkinfolocation>
</pkinfo>
`

// --- Main ---------------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpk-'))
const p12 = path.join(work, 'p12')
const t0 = Date.now()
const count = await writeBundles(path.join(p12, 'tile'))
fs.writeFileSync(path.join(p12, 'root.json'), JSON.stringify(rootJson(), null, 2))
fs.mkdirSync(path.join(p12, 'resources/styles'), { recursive: true })
fs.writeFileSync(path.join(p12, 'resources/styles/root.json'), JSON.stringify(esriStyle()))
fs.cpSync(path.join(PUBLIC, 'fonts'), path.join(p12, 'resources/fonts'), { recursive: true })
fs.mkdirSync(path.join(p12, 'resources/sprites'), { recursive: true })
for (const f of ['.json', '.png', '@2x.json', '@2x.png']) {
  const res = await fetch(`${SPRITE}${f}`)
  if (res.ok) fs.writeFileSync(path.join(p12, `resources/sprites/sprite${f}`), Buffer.from(await res.arrayBuffer()))
}
fs.mkdirSync(path.join(work, 'esriinfo'), { recursive: true })
fs.writeFileSync(path.join(work, 'esriinfo/iteminfo.xml'), itemInfo())
fs.writeFileSync(path.join(work, 'esriinfo/item.pkinfo'), pkInfo())

// zip without compression (tiles are already gzipped; ArcGIS reads stored entries)
await new Promise((resolve, reject) => {
  const out = fs.createWriteStream(OUT)
  const zip = archiver('zip', { store: true, forceZip64: true })
  out.on('close', resolve)
  zip.on('error', reject)
  zip.pipe(out)
  zip.directory(work, false)
  zip.finalize()
})
fs.rmSync(work, { recursive: true, force: true })
console.log(`${OUT}: ${count} tiles, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
