"use strict";
var _ = require( "underscore" ),
    esClient = require( "../es_client" ),
    Model = require( "../models/model" ),
    Place = require( "../models/place" ),
    Taxon = require( "../models/taxon" ),
    util = require( "../util" );

const assignAncestors = function( req, taxa, options, callback ) {
  if( !options.details && !options.ancestors ) { return callback( null, taxa ); }
  _.each( taxa, t => {
    // remove taxon.id from ancestor_ids
    t.ancestor_ids = _.without( t.ancestor_ids, t.id );
  });
  var ancestor_ids = _.uniq( _.flatten( _.map( taxa, "ancestor_ids" )));
  if( _.size( ancestor_ids ) === 0 ) { return callback( null, taxa ); }
  var ancestorOpts = { filters: [{ terms: { id: ancestor_ids } }], per_page: ancestor_ids.length };
  const newReq = Object.assign( { }, req );
  newReq.query = newReq.query || { };
  newReq.query.size = _.size( ancestor_ids );
  searchQuery( newReq, ancestorOpts, function( err, r ) {
    if( err ) { return callback( err ); }
    var ancestorsByID = _.object( _.map( r.results, r => [ r.id, r ] ));
    _.each( taxa, t => {
      t.ancestors = _.filter(
        _.map( t.ancestor_ids, aid => ancestorsByID[ aid ] ),
        // filter out root of the tree
        ancestor => ancestor && ancestor.name !== "Life"
      );
    });
    callback( null, taxa );
  });
};

const assignChildren = function( req, taxa, options, callback ) {
  if( !options.details ) { return callback( null, taxa ); }
  var ids = _.map( taxa, "id" );
  var childrenOpts = { filters: [
    { terms: { parent_id: ids } },
    { term: { is_active: true } }
  ], per_page: 10000 };
  searchQuery( req, childrenOpts, function( err, r ) {
    if( err ) { return callback( err ); }
    var childrenByID = { };
    _.each( r.results, r => {
      childrenByID[ r.parent_id ] = childrenByID[ r.parent_id ] || [ ];
      childrenByID[ r.parent_id ].push( r );
    });
    _.each( taxa, t => t.children = childrenByID[ t.id ] );
    callback( null, taxa );
  });
};

const assignPlaces = function( taxa, callback ) {
  var places = _.uniq( _.compact( _.flatten( _.map( taxa, function( t ) {
    var place_ids = [ ];
    if( t.establishment_means && t.establishment_means.place_id ) {
      place_ids.push( t.establishment_means.place_id );
    }
    if( t.conservation_status && t.conservation_status.place_id ) {
      place_ids.push( t.conservation_status.place_id );
    }
    return place_ids;
  }))));
  // turning the array into an ID-indexed object
  places = _.object(places, _.map( places, function( ){ return { } } ));
  Place.assignToObject( places, function( err ) {
    if( err ) { return callback( err ); }
    _.each( taxa, function( t ) {
      if( t.establishment_means && t.establishment_means.place_id ) {
        t.establishment_means.place = places[ t.establishment_means.place_id ];
        delete t.establishment_means.place_id;
      }
      if( t.conservation_status && t.conservation_status.place_id ) {
        t.conservation_status.place = places[ t.conservation_status.place_id ];
        delete t.conservation_status.place_id;
      }
    });
    callback( null, taxa );
  });
};

const searchQuery = function( req, options, callback ) {
  options = Object.assign( { }, options );
  var fitlers = options.filters;
  var searchHash = {
    filters: fitlers,
    per_page: Number( options.per_page || req.query.per_page || req.query.size ) || 30,
    page: Number( req.query.page ) || 1,
    sort: req.query.sort || { observations_count: "desc" },
    highlight: req.query.highlight
  };
  req.elastic_query = esClient.searchHash( searchHash );
  var defaultSource = [
    "id",
    "name",
    "names.name",
    "names.locale",
    "names.position",
    "names.is_valid",
    "names.place_taxon_names",
    "rank",
    "default_photo",
    "ancestor_ids",
    "ancestry",
    "colors",
    "is_active",
    "observations_count",
    "iconic_taxon_id",
    "parent_id",
    "rank_level",
    "listed_taxa.place_id",
    "listed_taxa.establishment_means",
    "statuses.*",
    "taxon_changes_count",
    "taxon_schemes_count",
    "atlas_id"
  ];
  // we don't want all photos for ancestors or children
  if( options.details || options.photos ) {
    defaultSource.push( "taxon_photos" );
  }
  esClient.connection.search({
    preference: global.config.elasticsearch.preference,
    index: ( process.env.NODE_ENV || global.config.environment ) + "_taxa",
    body: req.elastic_query,
    _source: req._source || defaultSource
  }, function( err, data ) {
    if( err ) { return callback( err ); }
    var taxa = _.map( data.hits.hits, function( h ) {
      if( req.query.highlight && h.highlight ) {
        var highlighted = h.highlight[ _.keys( h.highlight )[0] ];
        h._source.matched_term = highlighted[0].replace( /<\/?em>/g, "" );
      }
      var t = new Taxon( h._source );
      t.prepareForResponse( util.localeOpts( req ), options );
      return t;
    });
    Model.preloadTaxonPhotoDimensions( taxa, ( ) => {
      Taxon.preloadPhotosInto( taxa, { localeOpts: util.localeOpts( req ) }, err => {
        if( err ) { return callback( err ); }
        assignAncestors( req, taxa, options, ( err, taxaWithAncestors ) => {
          if( err ) { return callback( err ); }
          assignChildren( req, taxaWithAncestors, options, ( err, taxaWithChildren ) => {
            if( err ) { return callback( err ); }
            assignPlaces( taxaWithChildren, ( err, taxaWithPlaces ) => {
              if( err ) { return callback( err ); }
              Taxon.assignConservationStatuses( taxaWithPlaces, options, ( err, taxawithCS ) =>  {
                if( err ) { return callback( err ); }
                Taxon.assignListedTaxa( taxawithCS, options, ( err, taxawithLT ) =>  {
                  if( err ) { return callback( err ); }
                  callback( null, {
                    total_results: data.hits.total,
                    page: Number( searchHash.page ),
                    per_page: Number( searchHash.per_page ),
                    results: taxawithLT
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

const speciesCountsResponse = function( req, leafCounts, opts, callback ) {
  var options = opts || {};
  var totalResults = leafCounts.length;
  leafCounts = leafCounts.slice( 0, req.query.per_page || 500 );
  var leafCountObject = _.object( _.map( leafCounts, function( c ) {
    let obj = Object.assign( { }, c );
    delete obj.taxon_id;
    return [ c.taxon_id, obj ];
  }));
  var filters = [ { terms: { id: _.keys( leafCountObject ) } } ];
  var searchReq = _.extend( { }, req, { query: { is_active : null, size: req.query.per_page || 500,
    locale: req.query.locale } });
  options.filters = filters;
  if( req.inat && req.inat.similarToImage ) {
    options.photos = true;
    options.ancestors = true;
  }
  searchQuery( searchReq, options, function( err, response ) {
    if( err ) { return callback( err ); }
    // insert the resulting taxa into the leafCountObject
    _.each( response.results, function( tax ) {
      leafCountObject[ tax.id ].taxon = tax;
    });
    // remove any with missing taxa
    var leafCountArray = _.reject( leafCountObject, lc => ( !lc.taxon ) );
    // sort the results again by count descending
    callback( null, {
      total_results: totalResults,
      page: 1,
      per_page: leafCountArray.length,
      results: _.sortBy( leafCountArray, function( o ) {
        return ( req.query.order === "asc" ? 1 : -1 ) * o.count;
      })
    });
  });
}

module.exports = {
  searchQuery,
  speciesCountsResponse,
  assignAncestors
};
