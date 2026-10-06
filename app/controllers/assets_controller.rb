class AssetsController < ApplicationController
  TYPES = %w[protected_area country region].freeze

  def tiles
    area_type = params[:type]
    raise_404 unless TYPES.include?(area_type)
    method_name = "#{area_type}_tile"
    record = send(area_type)
    raise_404 if record.nil?

    source = thumbnail_source
    cache_key = [
      'tiles',
      'image',
      "v#{Rails.application.secrets.mapbox[:version]}",
      (source unless source == 'mapbox'),
      area_type,
      params[:id].to_s,
      (record.respond_to?(:updated_at) && record.updated_at ? record.updated_at.to_i : 'na')
    ].compact.join(':')

    image = THUMBNAIL_STORE.read(cache_key)
    if image.blank?
      image = generate_thumbnail(source, method_name, record)
      # Don't persist failures, so they are retried on the next request
      THUMBNAIL_STORE.write(cache_key, image) if image.present?
    end

    if image.blank?
      redirect_to ActionController::Base.helpers.asset_path('search-placeholder-country.png', type: :image)
      return
    end

    expires_in 3.days, public: true

    send_data image, type: image_type(image), disposition: 'inline'
  rescue AssetGenerator::AssetGenerationFailedError
    redirect_to ActionController::Base.helpers.asset_path('search-placeholder-country.png', type: :image)
  end

  private

  def generate_thumbnail(source, method_name, record)
    return AssetGenerator.send(method_name, record) if source == 'mapbox'

    AssetGenerator.arcgis_tile(record, source)
  end

  # ArcGIS thumbnails are SVGs embedding the PNG layers
  def image_type(image)
    image.start_with?('<svg') ? 'image/svg+xml' : 'image/png'
  end

  def protected_area
    @protected_area ||= ProtectedArea.where(site_id: params[:id]).first
  end

  def country
    @country ||= Country.where(iso: params[:id]).first
  end

  def region
    @region ||= Region.where(iso: params[:id]).first
  end
end
