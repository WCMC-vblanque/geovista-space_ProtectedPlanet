# Lets reviewers compare thumbnail sources on real pages (docs/maps.md).
# Enabled only with MAP_OPTIONS_PREVIEW=true. ?thumbnail_source=<source> is
# remembered in the session, so it also applies to thumbnails loaded by XHR
# (e.g. search autocomplete). An empty value resets it.
module MapOptionsPreview
  extend ActiveSupport::Concern

  included do
    before_action :remember_thumbnail_source
    helper_method :thumbnail_source
  end

  def self.enabled?
    ENV['MAP_OPTIONS_PREVIEW'] == 'true'
  end

  private

  def remember_thumbnail_source
    return unless MapOptionsPreview.enabled? && params.key?(:thumbnail_source)

    session[:thumbnail_source] = params[:thumbnail_source].presence
  end

  def thumbnail_source
    source = MapOptionsPreview.enabled? && (params[:thumbnail_source].presence || session[:thumbnail_source])
    AssetGenerator::THUMBNAIL_SOURCES.include?(source) ? source : 'mapbox'
  end
end
