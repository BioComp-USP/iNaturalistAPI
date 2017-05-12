"use strict";

/*
  Shared module(s) for code that might be shared between other modules. Model
  /controller-specific modules should handle tasks unique to those domains.
  Code the needs to use code from more than one of these should live here in
  index.js to avoid circular requirement
*/

var _ = require( "underscore" ),
    ESModel = require( "../models/es_model" ),
    Model = require( "../models/model" ),
    Observation = require( "../models/observation" ),
    Project = require( "../models/project" ),
    Taxon = require( "../models/taxon" ),
    User = require( "../models/user" ),
    util = require( "../util" ),
    sharedTaxa = require( "./taxa" ),
    sharedObservations = require( "./observations" );


const getObservationSuggestions = ( req ) => {
  return new Promise( ( resolve, reject ) => {
    sharedObservations.leafCounts( req, ( err, leafCounts ) => {
      if ( err ) { return reject( err ); }
      sharedTaxa.speciesCountsResponse( req, leafCounts, { photos: true }, ( err, data ) => {
        if ( err ) { return reject( err ); }
        // resolve( data.results.map( r => r.taxon ) );
        resolve( data.results.map( r => ( {
          sourceType: "observations",
          sourceDetails: {
            observations_count: r.count
          },
          taxon: r.taxon
        } ) ) );
      } );
    } );
  } );
};

const preloadMinimalForObservation = ( obs, localeOpts, callback ) => {
  var prepareTaxon = function( t ) {
    t.prepareForResponse( localeOpts );
  }
  const ids = _.flatten( _.pluck( obs, "identifications" ) );
  const comments = _.flatten( _.pluck( obs, "comments" ) );
  const ofvs = _.flatten( _.pluck( obs, "ofvs" ) );
  var withTaxa = _.filter(
    _.flatten( [ obs, ids, ofvs ] ), wt => ( wt && (
      ( wt.taxon && Number( wt.taxon.id ) ) ||
      ( wt.taxon_id && Number( wt.taxon_id ) ) ) )
  );
  var annotations = _.flatten( _.pluck( obs, "annotations" ) );
  var annotationVotes = _.flatten( _.pluck( annotations, "votes" ) );
  var withUsers = _.filter(
    _.flatten( [ obs,
      ids,
      annotations,
      annotationVotes,
      comments,
      _.pluck( comments, "flags" ),
      _.pluck( ids, "flags" ),
      _.pluck( obs, "flags" ),
      _.pluck( obs, "faves" ),
      _.pluck( obs, "votes" ),
      _.pluck( obs, "quality_metrics" ) ] ), _.identity
  );
  Model.preloadObjectPhotoDimensions( obs, err => {
    if( err ) { return callback( err ); }
    var taxonOpts = { modifier: prepareTaxon, source: { excludes: [ "photos", "taxon_photos" ] } };
    ESModel.fetchBelongsTo( withTaxa, Taxon, taxonOpts, err => {
      if( err ) { return callback( err ); }
      const taxa = _.compact( _.pluck( ids, "taxon" ) );
      sharedTaxa.assignAncestors( { }, taxa, { ancestors: true }, ( ) => {
        ESModel.fetchBelongsTo( withUsers, User, { }, callback );
      });
    });
  });
}

const suggestifyRequest = req => {
  return new Promise( ( resolve, reject ) => {
    req.query.verifiable = "true";
    if ( req.query.observation_id ) {
      const obsReq = {
        query: {
          id: [req.query.observation_id]
        }
      }
      sharedTaxa.elasticResults( obsReq, function( err, data ) {
        if( err ) { return reject( err ); }
        if ( data.hits.hits.lentth === 0 ) { return resolve( req ); }
        var obs = [new Observation( data.hits.hits[0]._source, { session: req.userSession } )];
        preloadMinimalForObservation( obs, { localeOpts: util.localeOpts( req ) }, err => {
          if( err ) { return reject( err ); }
          if ( obs[0].taxon ) {
            if ( obs[0].taxon.rank_level <= 10 ) {
              req.query.taxon_id = obs[0].taxon.ancestor_ids[obs[0].taxon.ancestor_ids.length - 2];
            } else {
              req.query.taxon_id = obs[0].taxon.id;
            }
          }
          if ( obs[0].place_ids && obs[0].place_ids.length > 0 ) {
            req.query.place_id = obs[0].place_ids[obs[0].place_ids.length - 1];
          }
          resolve( req );
        } );
      } );
    } else {
      resolve( req );
    }
  } )
};

const preloadAllAssociationsForObservation = ( obs, localeOpts, callback ) => {
  sharedObservations.preloadIdentifications( obs, function( err ) {
    if( err ) { return callback( err ); }
    sharedObservations.preloadFlags( obs, err => {
      if( err ) { return callback( err ); }
      sharedObservations.preloadFaves( obs, err => {
        if( err ) { return callback( err ); }
        sharedObservations.preloadQualityMetrics( obs, err => {
          if( err ) { return callback( err ); }
          sharedObservations.preloadAnnotationControlledTerms( obs, err => {
            if( err ) { return callback( err ); }
            sharedObservations.preloadObservationFields( obs, err => {
              if( err ) { return callback( err ); }
              const projobs = _.flatten( _.map( obs, o => {
               _.each( o.project_observations, po => ( po.project_id = po.project.id ) );
               return o.project_observations;
              } ) );
              ESModel.fetchBelongsTo( projobs, Project, { source: Project.returnFields }, err => {
                if( err ) { return callback( err ); }
                sharedObservations.preloadProjectMembership( obs, localeOpts, err => {
                  if( err ) { return callback( err ); }
                  sharedObservations.preloadProjectObservationPreferences( obs, localeOpts, err => {
                    if( err ) { return callback( err ); }
                    sharedObservations.preloadObservationPreferences( obs, err => {
                      if( err ) { return callback( err ); }
                      sharedObservations.preloadObservationUserPreferences( obs, err => {
                        if( err ) { return callback( err ); }
                        preloadMinimalForObservation( obs, localeOpts, callback );
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

sharedObservations.preloadInto = ( arr, options, callback ) => {
  ESModel.fetchBelongsTo( arr, Observation, options, ( ) => {
    var observations = arr.map( i => ( i.observation ) );
    var preloadCallback = options.minimal ?
      preloadMinimalForObservation : preloadAllAssociationsForObservation;
    preloadCallback( observations, options, callback );
  });
}

module.exports = {
  taxa: sharedTaxa,
  observations: sharedObservations,
  getObservationSuggestions,
  preloadMinimalForObservation,
  suggestifyRequest,
  preloadAllAssociationsForObservation
};
