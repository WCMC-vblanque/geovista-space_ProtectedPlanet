# Maps: Mapbox → MapLibre migration and cost savings

## 1. Why

1. **Mapbox billed ~$835 per month for protectedplanet.net** (Sep–Oct 2026).
   1. **Map Loads for Web: ~$606.** Every interactive map initialisation (`new mapboxgl.Map`) is a billed load above 50k/month.
      - Maps are on the home page and every protected area, country and region page.
   2. **Static Images API: ~$220.** PA, country and region thumbnails (search, cards, covers).
   3. **Static Tiles API: ~$9.** Comes from `data-gis.unep-wcmc.org`, not from this app.
2. **Goal: remove Mapbox from Protected Planet and keep the current look as closely as possible.**

## 2. What changed

### 2.1 Interactive maps: Mapbox GL JS → MapLibre GL JS (`feat/maplibre-migration`)

1. **MapLibre GL JS 5.24.0 replaces Mapbox GL JS 1.4.1.**
   - Open-source fork of Mapbox GL JS (BSD-3), same API for Map, Popup, Marker and controls.
   - No access token, no per-load billing.
   - Loaded from cdnjs in `app/views/layouts/partials/_head.html.erb` (global `maplibregl`).
2. **CSS classes renamed from `.mapboxgl-*` to `.maplibregl-*`.**
3. **`preserveDrawingBuffer` (PDF export) moved to `canvasContextAttributes`** — MapLibre v5 API.
4. **Basemaps are now configurable style URLs** (`app/javascript/components/map/default-options.js`).
   1. **Terrain:** `BASEMAP_TERRAIN_STYLE_URL`.
      - Target: self-hosted style reading a PMTiles basemap (see §3).
      - Fallback until published: [OpenFreeMap](https://openfreemap.org) `positron` (free, no key, no limits).
   2. **Satellite:** Esri World Imagery + Esri boundaries/places labels.
      - Override with `BASEMAP_SATELLITE_STYLE_URL` (e.g. a style using EOX Sentinel-2 Cloudless WMTS).
   3. **Both are read at webpack build time** (`dotenv-webpack`) → rebuild assets after changing them.
5. **PMTiles protocol registered** (`pmtiles@4.5.0`).
   - Styles can use `pmtiles://https://…/basemap.pmtiles` sources directly.
   - No tile server needed: the browser reads byte ranges from object storage.
6. **Overlays are unchanged.**
   - WDPA / OECM still come from ArcGIS Server (`data-gis.unep-wcmc.org`, `app/helpers/map_helper.rb`).
   - They are inserted beneath the first `boundary` or label layer of any basemap, or on top if the style has none.

### 2.2 Thumbnails: persistent store (`fix/persistent-thumbnail-cache`, separate PR)

1. **Root cause of the Static Images cost: thumbnails were wiped on every deploy.**
   - They lived in `Rails.cache` (memcached), which is cleared by `deploy:clear_cache`, search reindex and portal release.
   - Every clear re-requested every visited thumbnail from Mapbox.
2. **Thumbnails now live in a `FileStore` under `storage/thumbnails`.**
   - `storage/` is a Capistrano linked dir → survives deploys and `Rails.cache.clear`.
   - Each thumbnail is generated once per record `updated_at`.
   - Failed generations are not stored, so they are retried.
   - Bump `mapbox.version` in `config/secrets.yml` to regenerate all of them.
3. **Generator is still Mapbox Static Images for now** — cost becomes one-off per thumbnail.
   - Next step: replace with ArcGIS `MapServer/export` or a MapLibre Native renderer, then bump the version.

## 3. Self-hosted basemap (PMTiles + Maputnik)

1. **Extract a planet basemap down to zoom 10 only.**
   - Maps are capped at `maxZoom: 10` (ArcGIS overlay cache depth), so deeper tiles are never requested.
   - Uses the [pmtiles CLI](https://github.com/protomaps/go-pmtiles) and a [Protomaps daily build](https://maps.protomaps.com/builds/):
     ```bash
     pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles basemap-z10.pmtiles --maxzoom=10
     ```
2. **Host it on object storage that supports HTTP range requests.**
   1. **Recommended: Cloudflare R2** — no egress fees.
   2. **Alternative: AWS S3 behind CloudFront** — raw S3 egress (~$0.09/GB) gets expensive at ~190k map loads/month.
   3. **CORS must allow** `GET`/`HEAD` from protectedplanet.net and staging hosts, the `Range` request header, and expose `ETag`.
3. **Rebuild the current Mapbox "Terrain" style in [Maputnik](https://maplibre.org/maputnik/).**
   1. Start from the [Protomaps basemap styles](https://github.com/protomaps/basemaps) (same schema as the extract).
   2. Copy colours, line widths and label rules from the exported Mapbox style JSON.
      - Mapbox styles use the Mapbox Streets v8 schema → layers cannot be copied 1:1, only visually matched.
   3. Self-host glyphs (fonts) and sprites next to the PMTiles file.
      - Mapbox fonts and sprites are licensed for Mapbox only.
   4. Keep a layer id containing `boundary` where overlays should go beneath (see §2.1.6).
4. **Publish `style.json` and set `BASEMAP_TERRAIN_STYLE_URL` to its URL.**

## 4. How to test

1. **Thumbnails (`fix/persistent-thumbnail-cache`).**
   1. `bundle exec rails test test/controllers/asset_controller_test.rb test/unit/asset_generator_test.rb`
   2. Open `/assets/tiles/<site_id>?type=protected_area&version=1` → PNG, and a file appears under `storage/thumbnails/`.
   3. `bundle exec rake cache:clear`, reload → served from disk, no new Mapbox request in the logs.
2. **Interactive maps (`feat/maplibre-migration`).**
   1. Rebuild assets (`bin/webpack` or restart `webpacker`), open the home page.
   2. Check in the browser network tab: **no request to `api.mapbox.com`** from the map.
   3. Check on home, Marine, Green List, a country, a region and a PA page:
      1. Basemap renders; overlays (green/blue/yellow) sit beneath labels.
      2. Terrain ↔ Satellite toggle keeps the overlays.
      3. Clicking a site opens the popup and pin; zoom controls and attribution are styled.
      4. Arabic/Hebrew labels render right-to-left.
      5. PA page PDF export still includes the map.

## 5. Expected costs after migration

1. **Mapbox for protectedplanet.net: ~$0.**
   - Remaining Mapbox usage from other sites (OceanPlus, ENCORE, ICCA Registry, data-gis) falls within free tiers. (75%)
2. **New running costs.**
   1. **Basemap hosting:** ~$0 egress on R2 plus a few GB of storage.
   2. **Esri World Imagery:** check the ArcGIS licence covers public web use; may need an ArcGIS key.
   3. **ArcGIS Server:** unchanged load for overlays; more load if thumbnails move to `MapServer/export`.

## 6. Remaining work

1. **Publish the self-hosted Terrain style** (§3) and set `BASEMAP_TERRAIN_STYLE_URL`.
2. **Replace the thumbnail generator** (ArcGIS export or MapLibre Native) and drop `MAPBOX_*` env vars.
3. **Optional: move overlays to the ArcGIS `Hosted/WDPCA/VectorTileServer`.**
   - Sharper rendering, hover/selection via feature-state, popups read from tiles without an ArcGIS `query` round-trip.
