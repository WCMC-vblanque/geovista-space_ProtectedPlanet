require "test_helper"

class AssetsControllerTest < ActionController::TestCase
  def setup
    THUMBNAIL_STORE.clear
  end

  test ".tiles, given a pa id, generates the asset and returns the image with the
   correct mimetype" do
    pa = FactoryGirl.create(:protected_area)

    AssetGenerator.stubs(:protected_area_tile).returns("the tile")

    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area"}
    assert_equal "the tile", @response.body
  end

  test ".tiles generates the asset only once, even after Rails.cache is cleared" do
    pa = FactoryGirl.create(:protected_area)

    AssetGenerator.expects(:protected_area_tile).once.returns("the tile")

    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area"}
    Rails.cache.clear
    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area"}

    assert_equal "the tile", @response.body
  end

  test ".tiles does not persist a failed generation, so it is retried" do
    pa = FactoryGirl.create(:protected_area)

    AssetGenerator.expects(:protected_area_tile).twice.returns('', "the tile")

    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area"}
    assert_response :redirect
    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area"}

    assert_equal "the tile", @response.body
  end

  test ".tiles ignores thumbnail_source unless the map options preview is enabled" do
    pa = FactoryGirl.create(:protected_area)

    AssetGenerator.expects(:protected_area_tile).returns("the tile")
    AssetGenerator.expects(:arcgis_tile).never

    get :tiles, params: {"id" => pa.site_id, "type" => "protected_area", "thumbnail_source" => "arcgis-clearmap-topo"}
    assert_equal "image/png", @response.content_type
  end

  test ".tiles serves ArcGIS SVG thumbnails when previewing, stored apart from Mapbox ones" do
    pa = FactoryGirl.create(:protected_area)

    with_map_options_preview do
      AssetGenerator.expects(:protected_area_tile).once.returns("the tile")
      AssetGenerator.expects(:arcgis_tile).once.returns("<svg/>")

      get :tiles, params: {"id" => pa.site_id, "type" => "protected_area", "thumbnail_source" => "arcgis-clearmap-topo"}
      assert_equal "image/svg+xml", @response.content_type
      assert_equal "<svg/>", @response.body

      get :tiles, params: {"id" => pa.site_id, "type" => "protected_area", "thumbnail_source" => ""}
      assert_equal "the tile", @response.body
    end
  end

  test ".tiles falls back to Mapbox for an unknown thumbnail_source" do
    pa = FactoryGirl.create(:protected_area)

    with_map_options_preview do
      AssetGenerator.expects(:protected_area_tile).returns("the tile")
      AssetGenerator.expects(:arcgis_tile).never

      get :tiles, params: {"id" => pa.site_id, "type" => "protected_area", "thumbnail_source" => "nope"}
      assert_equal "the tile", @response.body
    end
  end

  private

  def with_map_options_preview
    ENV['MAP_OPTIONS_PREVIEW'] = 'true'
    yield
  ensure
    ENV.delete('MAP_OPTIONS_PREVIEW')
  end
end
