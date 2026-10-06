require 'test_helper'

class AssetGeneratorTest < ActiveSupport::TestCase
  def setup
    @options = {size: {x: 25, y: 25}}
    @protected_area = FactoryGirl.create(:protected_area)
    @protected_area.stubs(:geojson).returns('{}')
  end

  test '#protected_area_tile, given a protected area without images and an
   options hash, sends a request to Mapbox and returns the content' do

    response_mock = mock
    response_mock.stubs(:body).returns('the image')
    response_mock.stubs(:code).returns('200')

    Rails.application.secrets.
      stubs(:mapbox).
      returns({'base_url' => 'http://mapbox.com/', 'access_token' => '123'})
    Net::HTTP.expects(:get_response).
      with('mapbox.com', '/geojson({})/auto/304x138@2x.png?access_token=123').
      returns(response_mock)

    pa_image = AssetGenerator.protected_area_tile(@protected_area)
    assert_equal 'the image', pa_image
  end

  test '#protected_area_tile, when an exception occurs during the retrieval of the
   tile, returns the fallback tile' do
    skip('no longer try to provide a backend-generated fallback image')
    response_mock = mock
    response_mock.stubs(:code).returns('404')
    Net::HTTP.stubs(:get_response).returns(response_mock)

    File.expects(:read).with(AssetGenerator::FALLBACK_PATH).returns('fallback image')

    pa_image = AssetGenerator.protected_area_tile(@protected_area)
    assert_equal 'fallback image', pa_image
  end

  test '#protected_area_tile, given a Protected Area with no geometry, returns
   the fallback tile' do
    skip('no longer try to provide a backend-generated fallback image')
    AssetGenerator.expects(:fallback_tile).returns('fallback image')

    protected_area = FactoryGirl.create(:protected_area)
    protected_area.stubs(:geojson).returns(nil)

    pa_image = AssetGenerator.protected_area_tile(protected_area)
    assert_equal 'fallback image', pa_image
  end

  test '#arcgis_tile, given a protected area, layers the ArcGIS basemap and
   the site overlay in an SVG' do
    @protected_area.stubs(:extent_url).returns(url: 'https://gis.test/extent')
    @protected_area.stubs(:arcgis_layer).returns('https://gis.test/WDPA/MapServer/1')
    AssetGenerator.stubs(:request_tile).with('https://gis.test/extent').
      returns({ extent: { xmin: 30.8, ymin: -25.6, xmax: 32.1, ymax: -22.3 } }.to_json)

    basemap = AssetGenerator::ARCGIS_BASEMAPS['arcgis-clearmap-topo']
    AssetGenerator.expects(:request_image).
      with { |url| url.start_with?("#{basemap}/export?") }.returns('BASEMAP')
    AssetGenerator.expects(:request_image).
      with { |url| url.start_with?('https://gis.test/WDPA/MapServer/export?') && url.include?('layers=show%3A1') }.
      returns('SITE')

    svg = AssetGenerator.arcgis_tile(@protected_area, 'arcgis-clearmap-topo')

    assert svg.start_with?('<svg')
    assert_includes svg, Base64.strict_encode64('BASEMAP')
    assert_includes svg, Base64.strict_encode64('SITE')
  end

  test '#arcgis_tile, given a country, renders the basemap only' do
    country = FactoryGirl.create(:country)
    country.stubs(:extent_url).returns(url: 'https://gis.test/extent')
    AssetGenerator.stubs(:request_tile).
      returns({ extent: { xmin: -10, ymin: 35, xmax: 5, ymax: 44 } }.to_json)
    AssetGenerator.expects(:request_image).once.returns('BASEMAP')

    svg = AssetGenerator.arcgis_tile(country, 'arcgis-esri-imagery')

    assert_includes svg, Base64.strict_encode64('BASEMAP')
  end

  test '#arcgis_tile returns an empty string when the extent is not found' do
    @protected_area.stubs(:extent_url).returns(url: 'https://gis.test/extent')
    AssetGenerator.stubs(:request_tile).returns({ extent: { xmin: 'NaN' } }.to_json)
    AssetGenerator.expects(:request_image).never

    assert_equal '', AssetGenerator.arcgis_tile(@protected_area, 'arcgis-clearmap-topo')
  end

  test '#thumbnail_bbox pads point sites to a minimum extent with the thumbnail ratio' do
    xmin, ymin, xmax, ymax = AssetGenerator.thumbnail_bbox(
      'xmin' => 10, 'ymin' => 10, 'xmax' => 10, 'ymax' => 10
    )

    assert_in_delta AssetGenerator::MIN_EXTENT_METRES, ymax - ymin, 1
    assert_in_delta 304.0 / 138, (xmax - xmin) / (ymax - ymin), 0.001
  end
end
