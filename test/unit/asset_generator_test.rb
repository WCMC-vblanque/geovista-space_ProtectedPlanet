require 'test_helper'

class AssetGeneratorTest < ActiveSupport::TestCase
  VALID_GEOJSON = '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[10.0,20.0],[11.0,20.0],[11.0,21.0],[10.0,21.0],[10.0,20.0]]]}}'

  def setup
    @protected_area = FactoryGirl.create(:protected_area)
    @protected_area.stubs(:geojson).returns(VALID_GEOJSON)
  end

  test '#protected_area_tile renders a thumbnail via the Node.js script and returns PNG content' do
    fake_png = 'PNG_BINARY_DATA'

    Open3.expects(:capture3).
      with("node #{AssetGenerator::THUMBNAIL_SCRIPT}", stdin_data: VALID_GEOJSON).
      returns([fake_png, '', mock(success?: true)])

    result = AssetGenerator.protected_area_tile(@protected_area)
    assert_equal fake_png, result
  end

  test '#protected_area_tile returns empty string when the Node.js script fails' do
    Open3.expects(:capture3).
      with("node #{AssetGenerator::THUMBNAIL_SCRIPT}", stdin_data: VALID_GEOJSON).
      returns(['', 'some error', mock(success?: false)])

    result = AssetGenerator.protected_area_tile(@protected_area)
    assert_equal '', result
  end

  test '#protected_area_tile returns empty string when protected area is nil' do
    result = AssetGenerator.protected_area_tile(nil)
    assert_equal '', result
  end

  test '#protected_area_tile returns empty string when geojson is blank' do
    @protected_area.stubs(:geojson).returns(nil)
    result = AssetGenerator.protected_area_tile(@protected_area)
    assert_equal '', result
  end
end
