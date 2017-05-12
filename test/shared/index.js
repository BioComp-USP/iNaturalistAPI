var expect = require( "chai" ).expect,
    sinon = require( "sinon" ),
    shared = require( "../../lib/shared" );

describe( "preloadAllAssociationsForObservation", function( ) {
  it( "returns preload ID errors", function( done ) {
    var stub = sinon.stub( shared.observations, "preloadIdentifications", function( p, cb ) {
      cb("id-error");
    });
    shared.preloadAllAssociationsForObservation([ ], null, function( e ) {
      expect( e ).to.eq( "id-error" );
      stub.restore( );
      done( );
    });
  });

  it( "returns preload fave errors", function( done ) {
    var stub = sinon.stub( shared.observations, "preloadFaves", function( p, cb ) {
      cb("fave-error");
    });
    shared.preloadAllAssociationsForObservation([ ], null, function( e ) {
      expect( e ).to.eq( "fave-error" );
      stub.restore( );
      done( );
    });
  });
});
