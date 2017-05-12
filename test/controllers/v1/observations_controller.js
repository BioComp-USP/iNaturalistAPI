var expect = require( "chai" ).expect,
    observations = require( "inaturalistjs" ).observations,
    testHelper = require( "../../../lib/test_helper" ),
    Observation = require( "../../../lib/models/observation" ),
    ObservationsController = require( "../../../lib/controllers/v1/observations_controller" );

describe( "ObservationsController", function( ) {
  it( "uses the test ENV", function( ) {
    expect( process.env.NODE_ENV ).to.eq( "test" );
  });

  it( "creates", function( done ) {
    testHelper.testInatJSPreload(
      ObservationsController, observations, "create", Observation, done );
  });

  it( "updates", function( done ) {
    testHelper.testInatJSPreload(
      ObservationsController, observations, "update", Observation, done );
  });

  it( "deletes", function( done ) {
    testHelper.testInatJSNoPreload(
      ObservationsController, observations, "delete", done );
  });

  it( "faves", function( done ) {
    testHelper.testInatJSPreload(
      ObservationsController, observations, "fave", Observation, done );
  });

  it( "unfaves", function( done ) {
    testHelper.testInatJSPreload(
      ObservationsController, observations, "unfave", Observation, done );
  });

  it( "reviews", function( done ) {
    testHelper.testInatJSNoPreload(
      ObservationsController, observations, "review", done );
  });

  it( "unreviews", function( done ) {
    testHelper.testInatJSNoPreload(
      ObservationsController, observations, "unreview", done );
  });

  it( "sets quality metrics", function( done ) {
    testHelper.testInatJSNoPreload(
      ObservationsController, observations, "setQualityMetric", done );
  });

  it( "deletes quality metrics", function( done ) {
    testHelper.testInatJSNoPreload(
      ObservationsController, observations, "deleteQualityMetric", done );
  });

  describe( "index", function( ) {
    it( "fetches results", function( done ) {
      ObservationsController.search( { query: { } }, function( ) {
        // this needs some work - fixtures, etc
        done( );
      });
    });
  });

});
