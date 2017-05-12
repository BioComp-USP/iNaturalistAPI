"use strict";
var _ = require( "underscore" ),
    esClient = require( "../../es_client" ),
    util = require( "../../util" ),
    Taxon = require( "../../models/taxon" ),
    InaturalistAPI = require( "../../inaturalist_api" ),
    pgClient = require( "../../pg_client" ),
    squel = require( "squel" ),
    shared = require( "../../shared" ),
    TaxaController = { };

TaxaController.returnFields = [
  "id",
  "name",
  "names.name",
  "names.locale",
  "names.place_taxon_names",
  "rank",
  "default_photo",
  "ancestor_ids",
  "colors",
  "is_active",
  "observations_count",
  "iconic_taxon_id",
  "rank_level",
  "listed_taxa.place_id",
  "listed_taxa.establishment_means",
  "statuses.place_id",
  "statuses.iucn",
  "taxon_changes_count",
  "taxon_schemes_count"
];

TaxaController.show = function( req, callback ) {
  var ids = _.filter( req.params.id.split(","), _.identity );
  var filters = [{ terms: { id: ids } }];
  shared.taxa.searchQuery( req, { filters: filters, details: true }, callback );
}

TaxaController.exact = function( req, callback ) {
  var q = req.query.q || req.query.term;
  if( !q || q.length < 2 ) { return callback( null, { }); }
  var filters = [ { match: { "names.exact": { query: q } } } ];
  req.query.highlight = { fields: { "names.exact": { } } };
  if( util.is_ja( q ) ) {
    filters.push({ multi_match: {
      query: q,
      fields: [ "names.name_ja^10", "names.exact" ] } });
    req.query.highlight.fields[ "names.name_ja" ] = { };
  }
  var is_active = true;
  if( req.query.is_active === "false" ) {
    is_active = false;
  } else if( req.query.is_active === "any" ) {
    is_active = null;
  }
  if( is_active !== null ) {
    filters.push( esClient.termFilter( "is_active", is_active ) );
  }
  req.query.page = 1;
  req.query.per_page = 1;
  req.query.sort = "_score";
  shared.taxa.searchQuery( req, { filters: filters }, callback );
};

TaxaController.autocomplete = function( req, callback ) {
  // not sending the actual req, rather making a copy
  TaxaController.exact( { query: Object.assign( { }, req.query ) }, function( err, exactResponse ) {
    if( err ) { return callback( err ); }
    var exactResult = ( exactResponse && exactResponse.results && exactResponse.results.length > 0 ) ?
      exactResponse.results[0] : null;
    var q = req.query.q || req.query.term;
    req.query.per_page = Number( req.query.per_page ) || 30;
    if( req.query.per_page < 1 || req.query.per_page > 30 ) {
      req.query.per_page = 30;
    }
    if( !q || q.length < 1 ) {
      return InaturalistAPI.basicResponse( null, req, null, callback );
    }
    var is_active = true;
    if( req.query.is_active === "false" ) {
      is_active = false;
    } else if( req.query.is_active === "any" ) {
      is_active = null;
    }
    var filters = [ { match: { "names.name_autocomplete": {
      query: q, operator: "and" } } } ];
    req.query.highlight = { fields: { "names.name_autocomplete": { } } };
    if( util.is_ja( q ) ) {
      filters.push({ multi_match: {
        query: q,
        fields: [ "names.name_autocomplete_ja^10", "names.name_autocomplete" ] } });
      req.query.highlight.fields[ "names.name_autocomplete_ja" ] = { };
    }
    if( is_active !== null ) {
      filters.push( esClient.termFilter( "is_active", is_active ) );
    }
    req.query.page = 1;
    req.query.sort = { observations_count: "desc" };
    shared.taxa.searchQuery( req, { filters: filters },
      function( err, response ) {
      if( err ) { return callback( err ); }
      if( response && response.results && exactResult ) {
        response.results = _.reject( response.results, function( r ) {
          return r.id == exactResult.id;
        });
        response.results.unshift( exactResult );
        if( response.total_results < response.results.length ) {
          response.total_results = response.results.length;
        }
      }
      callback( err, response );
    });
  });
};

TaxaController.suggest = function( req, callback ) {
  // load observation
  // choose place
  // choose months
  // load observation search results (default most obsered desc)
  // req.query.verifiable = "true";
  
  const getChecklistResults = req => {
    const limit = 10;
    return new Promise( ( resolve, reject) => {
      var query = squel
        .select( ).fields( [
          "listed_taxa.taxon_id",
          "listed_taxa.list_id" ] )
        .from( "listed_taxa" )
        .limit( limit );
      if ( req.query.place_id ) {
        query = query.where( "listed_taxa.place_id = ?", req.query.place_id );
      }
      if ( req.query.taxon_id ) {
        query = query.
          join( "taxon_ancestors", null, "taxon_ancestors.taxon_id = listed_taxa.taxon_id" ).
          where( "taxon_ancestors.ancestor_taxon_id = ?", req.query.taxon_id );
      }
      pgClient.connection.query( query.toString( ),
        function( err, listedTaxaResult ) {
          if( err ) { return reject( err ); }
          var filters = [ { terms: { id: listedTaxaResult.rows.map( r => r.taxon_id ) } } ];
          var searchReq = _.extend( { }, req, { query: { is_active : null, size: limit, locale: req.query.locale } });
          shared.taxa.searchQuery( searchReq, { filters: filters, includePhotos: true }, function( err, response ) {
            if( err ) { return reject( err ); }
            resolve( response.results.map( taxon => ( {
              sourceType: "checklist",
              sourceKey: listedTaxaResult.rows.find( r => r.taxon_id === taxon.id ).list_id,
              taxon
            } ) ) );
          } );
        }
      );
    } );
  };
  shared.suggestifyRequest( req )
    .then( req => {
      if ( req.query.source === "checklist" ) {
        return getChecklistResults( req );
      }
      return shared.getObservationSuggestions( req );
    } )
    .then( results => {
      // getChecklistResults( req ).then( results => {
      const taxa = results.map( r => r.taxon );
      Taxon.preloadPhotosInto( taxa, { localeOpts: util.localeOpts( req ) }, err => {
        if( err ) { return callback( err ); }
        results = results.map( r => {
          r.taxon = taxa.find( t => t.id === r.taxon.id );
          return r;
        } );
        callback( err, {
          query: req.query,
          results
        } );
      } );
    } );
  // load checklist results if there's a place
  // load similar results if there's a taxon
  // load vision results if there's an image
}


module.exports = {
  show: TaxaController.show,
  autocomplete: TaxaController.autocomplete,
  suggest: TaxaController.suggest
};
