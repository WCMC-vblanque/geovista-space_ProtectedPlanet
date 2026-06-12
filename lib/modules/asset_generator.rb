module AssetGenerator
  class AssetGenerationFailedError < StandardError; end;
  FALLBACK_PATH = Rails.root.join('app/assets/images', 'search-placeholder-country.png')

  ESRI_WORLD_IMAGERY_EXPORT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
  STATIC_IMAGE_SIZE = { x: 304, y: 138 }.freeze
  BBOX_PADDING = 0.1 # degrees

  def self.protected_area_tile protected_area
    raise AssetGenerationFailedError if protected_area.nil?

    tile_url = esri_static_url protected_area.geojson
    request_tile tile_url
  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  def self.country_tile country
    raise AssetGenerationFailedError if country.nil?

    tile_url = esri_static_url country.geojson({"fill-opacity" => 0, "stroke-width" => 0})
    request_tile tile_url

  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  def self.region_tile region
    raise AssetGenerationFailedError if region.nil?

    tile_url = esri_static_url region.geojson({"fill-opacity" => 0, "stroke-width" => 0})
    request_tile tile_url
  rescue AssetGenerationFailedError
    ''#fallback_tile
  end

  private

  def self.esri_static_url(geojson)
    raise AssetGenerationFailedError unless geojson.present?

    bbox = bbox_from_geojson(geojson)
    raise AssetGenerationFailedError unless bbox

    params = [
      "bbox=#{bbox[:xmin]},#{bbox[:ymin]},#{bbox[:xmax]},#{bbox[:ymax]}",
      "bboxSR=4326",
      "size=#{STATIC_IMAGE_SIZE[:x]},#{STATIC_IMAGE_SIZE[:y]}",
      "imageSR=4326",
      "format=png32",
      "f=image"
    ]

    "#{ESRI_WORLD_IMAGERY_EXPORT}?#{params.join('&')}"
  end

  def self.bbox_from_geojson(geojson_str)
    parsed = JSON.parse(geojson_str)
    coords = extract_coordinates(parsed)
    return nil if coords.empty?

    lngs = coords.map { |c| c[0] }
    lats  = coords.map { |c| c[1] }

    {
      xmin: (lngs.min - BBOX_PADDING).round(6),
      ymin: (lats.min  - BBOX_PADDING).round(6),
      xmax: (lngs.max + BBOX_PADDING).round(6),
      ymax: (lats.max  + BBOX_PADDING).round(6)
    }
  rescue JSON::ParserError
    nil
  end

  def self.extract_coordinates(obj)
    case obj
    when Hash
      if obj['type'] == 'FeatureCollection'
        (obj['features'] || []).flat_map { |f| extract_coordinates(f) }
      elsif obj['type'] == 'Feature'
        extract_coordinates(obj['geometry'])
      elsif obj['coordinates']
        extract_coordinates(obj['coordinates'])
      else
        []
      end
    when Array
      return [obj] if obj.length >= 2 && obj[0].is_a?(Numeric) && obj[1].is_a?(Numeric)
      obj.flat_map { |item| extract_coordinates(item) }
    else
      []
    end
  end

  def self.request_tile tile_url
    uri = URI(URI.encode(tile_url, '[]'))
    request = Net::HTTP::Get.new(uri)
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
