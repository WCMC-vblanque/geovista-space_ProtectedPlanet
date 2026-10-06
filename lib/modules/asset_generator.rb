module AssetGenerator
  class AssetGenerationFailedError < StandardError; end;
  FALLBACK_PATH = Rails.root.join('app/assets/images', 'search-placeholder-country.png')
  THUMBNAIL_SIZE = { x: 304, y: 138 }.freeze

  # ArcGIS MapServers whose `export` renders the thumbnail basemap
  ARCGIS_BASEMAPS = {
    'arcgis-clearmap-topo' => 'https://geoservices.un.org/arcgis/rest/services/ClearMap_WebTopo/MapServer',
    'arcgis-esri-imagery' => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  }.freeze
  THUMBNAIL_SOURCES = ['mapbox', *ARCGIS_BASEMAPS.keys].freeze
  # Smallest thumbnail extent (Web Mercator metres), e.g. for point sites
  MIN_EXTENT_METRES = 20_000
  EARTH_RADIUS = 6_378_137

  def self.protected_area_tile protected_area
    raise AssetGenerationFailedError if protected_area.nil?

    tile_url = mapbox_url protected_area.geojson
    request_tile tile_url
  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  def self.country_tile country
    raise AssetGenerationFailedError if country.nil?

    tile_url = mapbox_url country.geojson({"fill-opacity" => 0, "stroke-width" => 0})
    request_tile tile_url

  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  def self.region_tile region
    raise AssetGenerationFailedError if region.nil?

    tile_url = mapbox_url region.geojson({"fill-opacity" => 0, "stroke-width" => 0})
    request_tile tile_url
  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  # Basemap and highlighted site from ArcGIS `export`, layered in an SVG that
  # embeds both PNGs, so no image library is needed.
  def self.arcgis_tile record, source
    raise AssetGenerationFailedError if record.nil?

    bbox = thumbnail_bbox(fetch_extent(record.extent_url[:url]))
    images = [request_image(arcgis_export_url(ARCGIS_BASEMAPS.fetch(source), bbox))]
    images << request_image(site_overlay_url(record, bbox)) if record.is_a?(ProtectedArea)

    svg(images)
  rescue StandardError => e
    # Includes network errors: callers fall back to the placeholder image
    Rails.logger.warn("ArcGIS thumbnail failed (#{source}): #{e.class} #{e.message}")
    ''
  end

  private

  def self.fetch_extent url
    extent = JSON.parse(request_tile(url))['extent']
    raise AssetGenerationFailedError unless extent && extent['xmin'].is_a?(Numeric)

    extent
  end

  # Padded extent in Web Mercator, stretched to the thumbnail aspect ratio
  # (same framing as Mapbox 'auto').
  def self.thumbnail_bbox extent, padding = 0.1
    x0, y0 = to_mercator(extent['xmin'], extent['ymin'])
    x1, y1 = to_mercator(extent['xmax'], extent['ymax'])
    width = [(x1 - x0) * (1 + 2 * padding), MIN_EXTENT_METRES].max
    height = [(y1 - y0) * (1 + 2 * padding), MIN_EXTENT_METRES].max
    ratio = THUMBNAIL_SIZE[:x].to_f / THUMBNAIL_SIZE[:y]
    if width / height > ratio
      height = width / ratio
    else
      width = height * ratio
    end
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2

    [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2]
  end

  def self.to_mercator lon, lat
    lat = lat.clamp(-85.0511, 85.0511)
    [
      lon * Math::PI / 180 * EARTH_RADIUS,
      Math.log(Math.tan(Math::PI / 4 + lat * Math::PI / 360)) * EARTH_RADIUS
    ]
  end

  def self.arcgis_export_url service, bbox, extra_params = {}
    params = {
      bbox: bbox.map { |v| v.round(1) }.join(','),
      bboxSR: 3857,
      imageSR: 3857,
      size: "#{THUMBNAIL_SIZE[:x] * 2},#{THUMBNAIL_SIZE[:y] * 2}",
      format: 'png32',
      transparent: true,
      f: 'image'
    }.merge(extra_params)

    "#{service}/export?#{params.to_query}"
  end

  # Only this site, drawn with the WDPA/OECM service's own symbology
  def self.site_overlay_url protected_area, bbox
    service, layer = protected_area.arcgis_layer.match(%r{\A(.+)/(\d+)\z}).captures

    arcgis_export_url(service, bbox, {
      layers: "show:#{layer}",
      layerDefs: { layer => "site_id=#{protected_area.site_id.to_i}" }.to_json
    })
  end

  def self.svg pngs
    width = THUMBNAIL_SIZE[:x] * 2
    height = THUMBNAIL_SIZE[:y] * 2
    images = pngs.map do |png|
      %(<image width="#{width}" height="#{height}" xlink:href="data:image/png;base64,#{Base64.strict_encode64(png)}"/>)
    end

    %(<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ) +
      %(width="#{width}" height="#{height}" viewBox="0 0 #{width} #{height}">#{images.join}</svg>)
  end

  # ArcGIS returns errors as JSON with a 200 status
  def self.request_image url
    uri = URI(url)
    response = Net::HTTP.get_response(uri)
    unless response.code == '200' && response['Content-Type'].to_s.start_with?('image/')
      raise AssetGenerationFailedError
    end

    response.body
  end

  def self.mapbox_url geojson
    mapbox_config = Rails.application.secrets.mapbox
    access_token = mapbox_config[:access_token] || mapbox_config['access_token']
    base_url = mapbox_config[:base_url] || mapbox_config['base_url']
    size = THUMBNAIL_SIZE

    raise AssetGenerationFailedError unless geojson.present?

    tile_url = base_url + "geojson(#{geojson})/auto/#{size[:x]}x#{size[:y]}@2x"
    tile_url << "?access_token=#{access_token}"
  end

  def self.request_tile tile_url
    uri = URI(URI.encode(tile_url, '[]'))
    request = Net::HTTP::Get.new(uri)
    # As we have set whitelist to only allow pp server/urls to use the mapbox token
    # so we need to set referer header so mapbox knows the request comes from pp server
    # see https://docs.mapbox.com/accounts/guides/tokens/#url-restrictions
    # and https://console.mapbox.com/account/access-tokens/
    request['Referer'] = Rails.application.routes.url_helpers.root_url
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    response = http.request(request)
    raise AssetGenerationFailedError if response.code != '200'
    
    response.body
  end

  def self.fallback_tile
    @fallback_tile ||= File.read(FALLBACK_PATH)
  end
end
