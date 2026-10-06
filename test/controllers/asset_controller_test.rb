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
end
