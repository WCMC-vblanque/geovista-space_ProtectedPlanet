require 'open3'

module AssetGenerator
  class AssetGenerationFailedError < StandardError; end
  FALLBACK_PATH = Rails.root.join('app/assets/images', 'search-placeholder-country.png')
  THUMBNAIL_SCRIPT = Rails.root.join('scripts', 'generate_map_thumbnail.js')

  def self.protected_area_tile(protected_area)
    raise AssetGenerationFailedError if protected_area.nil?

    render_thumbnail(protected_area.geojson)
  rescue AssetGenerationFailedError
    ''
  end

  def self.country_tile(country)
    raise AssetGenerationFailedError if country.nil?

    render_thumbnail(country.geojson({ "fill-opacity" => 0, "stroke-width" => 0 }))
  rescue AssetGenerationFailedError
    ''
  end

  def self.region_tile(region)
    raise AssetGenerationFailedError if region.nil?

    render_thumbnail(region.geojson({ "fill-opacity" => 0, "stroke-width" => 0 }))
  rescue AssetGenerationFailedError
    ''
  end

  private

  def self.render_thumbnail(geojson)
    raise AssetGenerationFailedError unless geojson.present?

    png, err, status = Open3.capture3("node #{THUMBNAIL_SCRIPT}", stdin_data: geojson)

    unless status.success?
      Rails.logger.error("generate_map_thumbnail failed: #{err}")
      raise AssetGenerationFailedError
    end

    png
  end

  def self.fallback_tile
    @fallback_tile ||= File.read(FALLBACK_PATH)
  end
end
