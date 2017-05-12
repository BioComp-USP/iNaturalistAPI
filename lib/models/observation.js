"use strict";
var _ = require( "underscore" ),
    util = require( "../util" ),
    Model = require( "./model" );

var Observation = class Observation extends Model {

  constructor( attrs, options ) {
    super( attrs );
    this.obscured = !!(this.geoprivacy === "obscured" || this.private_location);
    if( this.observation_photos ) {
      var photosByID = _.object( _.map( this.photos, p => [ p.id, p ] ) );
      _.each( this.observation_photos, op => {
        op.photo = photosByID[op.photo_id];
        if( op.photo ) {
          op.photo.url = util.fix_https( op.photo.url );
        }
        delete op.photo_id;
      });
    }
    if( this.project_observations ) {
      _.each( this.project_observations, po => {
        po.project = { id: po.project_id };
        delete po.project_id;
      });
    }
    options = options || { };
    if ( options.userSession && this.user &&
         this.user.id === options.userSession.user_id ) {
      // logged in
    } else {
      delete this.private_location;
      delete this.private_geojson;
    }
  }

};

Observation.modelName = "observation";
Observation.indexName = "observations";
Observation.tableName = "observations";

module.exports = Observation;
