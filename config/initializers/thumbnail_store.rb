# Persistent store for generated thumbnail images (Mapbox Static Images API).
#
# Kept separate from Rails.cache on purpose: Rails.cache (memcached) is cleared
# on every deploy, search reindex and portal release, which forced every
# thumbnail to be re-requested from Mapbox (billed per request).
# `storage/` is a Capistrano linked dir, so this survives deploys.
# Bump `mapbox.version` in secrets.yml to regenerate all thumbnails.
THUMBNAIL_STORE =
  if Rails.env.test?
    ActiveSupport::Cache::MemoryStore.new
  else
    ActiveSupport::Cache::FileStore.new(
      ENV.fetch('THUMBNAIL_STORE_PATH', Rails.root.join('storage', 'thumbnails').to_s)
    )
  end
