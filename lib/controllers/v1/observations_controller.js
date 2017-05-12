"use strict";
var _ = require( "underscore" ),
    moment = require( "moment" ),
    extend = require( "node.extend" ),
    squel = require( "squel" ),
    observations = require( "inaturalistjs" ).observations,
    esClient = require( "../../es_client" ),
    pgClient = require( "../../pg_client" ),
    ESModel = require( "../../models/es_model" ),
    util = require( "../../util" ),
    InaturalistAPI = require( "../../inaturalist_api" ),
    ControlledTerm = require( "../../models/controlled_term" ),
    Observation = require( "../../models/observation" ),
    Taxon = require( "../../models/taxon" ),
    Comment = require( "../../models/comment" ),
    User = require( "../../models/user" ),
    Identification = require( "../../models/identification" ),
    UpdateAction = require( "../../models/update_action" ),
    shared = require( "../../shared" ),
    ObservationsController = { };

ObservationsController.create = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.create, req ).then( function( r ) {
    var arr = [ { observation_id: r['0'].id } ];
    var localeOpts = util.localeOpts( req );
    shared.observations.preloadInto( arr, localeOpts, function( ) {
      return callback( null, arr[0].observation );
    });
  }).catch( callback );
};

ObservationsController.update = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.update, req ).then( function( r ) {
    var arr = [ { observation_id: r['0'].id } ];
    var localeOpts = util.localeOpts( req );
    shared.observations.preloadInto( arr, localeOpts, function( ) {
      return callback( null, arr[0].observation );
    });
  }).catch( callback );
};

ObservationsController.delete = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.delete, req  ).then( function( r ) {
    return callback( null, r );
  }).catch( callback );
};

ObservationsController.fave = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.fave, req  ).then( function( ) {
    var arr = [ { observation_id: req.params.id } ];
    var localeOpts = util.localeOpts( req );
    shared.observations.preloadInto( arr, localeOpts, function( ) {
      return callback( null, arr[0].observation );
    });
  }).catch( callback );
};

ObservationsController.unfave = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.unfave, req  ).then( function( ) {
    var arr = [ { observation_id: req.params.id } ];
    var localeOpts = util.localeOpts( req );
    shared.observations.preloadInto( arr, localeOpts, function( ) {
      return callback( null, arr[0].observation );
    });
  }).catch( callback );
};

ObservationsController.review = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.review, req  ).then( function( r ) {
    return callback( null, r );
  }).catch( callback );
};

ObservationsController.unreview = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.unreview, req  ).then( function( r ) {
    return callback( null, r );
  }).catch( callback );
};

ObservationsController.setQualityMetric = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.setQualityMetric, req  ).then( function( r ) {
    return callback( null, r );
  }).catch( callback );
};

ObservationsController.deleteQualityMetric = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.deleteQualityMetric, req  ).then( function( r ) {
    return callback( null, r );
  }).catch( callback );
};

ObservationsController.subscribe = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.subscribe, req  ).then( function( ) {
    callback( null, true );
  }).catch( callback );
};

ObservationsController.taxonSummary = function( req, callback ) {
  InaturalistAPI.iNatJSWrap( observations.taxonSummary, req  ).then( function( r ) {
    callback( null, r );
  }).catch( callback );
};

ObservationsController.show = function( req, callback ) {
  var ids = _.filter( req.params.id.split(","), _.identity );
  // also preserve the ttl and locale params
  req.query = { id: ids, ttl: req.query.ttl, locale: req.query.locale,
    preferred_place_id: req.query.preferred_place_id, details: "all" };
  ObservationsController.search( req, callback );
}

ObservationsController.search = function( req, callback ) {
  if ( req.query.return_bounds === "true" ) {
    req.query.aggs = {
      bbox: {
        geo_bounds: {
          field: "location"
        }
      }
    };
  }
  ObservationsController.resultsForRequest( req, function( err, data ) {
    if( err ) { return callback( err ); }
    var localeOpts = util.localeOpts( req );
    let preloadCallback;
    if( req.query.details === "all" ) {
      preloadCallback = shared.preloadAllAssociationsForObservation;
    } else {
      preloadCallback = shared.preloadMinimalForObservation;
    }
    preloadCallback( data.results, localeOpts, function( err ) {
      if( err ) { return callback( err ); }
      callback( null, data );
    });
  });
};

ObservationsController.histogram = function( req, callback ) {
  req.query.date_field = InaturalistAPI.setDefaultParamValue(
    req.query.date_field, "observed", { enum: [ "created", "observed" ] } );
  req.query.interval = InaturalistAPI.setDefaultParamValue(
    req.query.interval, "month_of_year", { enum:
      [ "year", "month", "week", "day", "hour",
        "month_of_year", "week_of_year" ] } );
  var interval = req.query.interval.replace( /_of_(month|year)/, "" );
  var grouped = req.query.interval.match( /_of_/ );
  var queryField = ( req.query.date_field === "created" ) ? "created_at" : "observed_on";
  var dateLimitField = ( req.query.date_field === "created" ) ? "created_d1" : "d1";
  var countQuery = _.extend( { }, req.query );
  // set a reasonable starting date to limit the number of buckets
  if( !grouped && !countQuery[ dateLimitField ] ) {
    if( interval === "year" || interval === "month" ) {
      countQuery[ dateLimitField ] = moment( ).subtract( 100, "years" ).format( );
    } else if( interval === "week" ) {
      countQuery[ dateLimitField ] = moment( ).subtract( 10, "years" ).format( );
    } else if( interval === "day" ) {
      countQuery[ dateLimitField ] = moment( ).subtract( 1, "years" ).format( );
    } else if( interval === "hour" ) {
      countQuery[ dateLimitField ] = moment( ).subtract( 1, "week" ).format( );
    }
  }
  if( grouped ) {
    // use the $DATE$_details field containing pre-calculated date parts
    countQuery.aggs = {
      histogram: { terms: { field: `${queryField}_details.${interval}`, size: 5000 } }
    };
  } else {
    // use the ES date_histogram aggregation on raw date types
    countQuery.aggs = {
      histogram: {
        date_histogram: {
          field: queryField,
          interval: interval,
          format: ( interval === "hour" ) ? "yyyy-MM-dd'T'HH:mm:ss'Z'" : "yyyy-MM-dd"
        }
      }
    };
  }
  // return nothing but aggregations
  countQuery.per_page = 0;
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var resultOptions = { };
    // fill in 0's for any values without hits, which date_histogram does automatically
    if( req.query.interval === "month_of_year" ) {
      resultOptions.backfill = { min: 1, max: 12 };
    } else if( req.query.interval === "week_of_year" ) {
      resultOptions.backfill = { min: 1, max: 53 };
    }
    var results = { };
    results[ req.query.interval ] =
      util.aggBucketsToHash( data.aggregations.histogram.buckets, resultOptions );
    callback( null, {
      total_results: _.size( results[ req.query.interval ] ),
      page: 1,
      per_page: _.size( results[ req.query.interval ] ),
      results: results
    });
  });
};

ObservationsController.resultsForRequest = function( req, callback ) {
  shared.observations.elasticResults( req, function( err, data ) {
    if( err ) { return callback( err ); }
    var obs = _.map( data.hits.hits, function( h ) {
      return new Observation( h._source, { userSession: req.userSession } );
    });
    if( err ) { return callback( err ); }
    var response = { total_results: data.hits.total };
    if (
      data.aggregations &&
      data.aggregations.bbox &&
      data.aggregations.bbox.bounds &&
      data.aggregations.bbox.bounds.bottom_right
    ) {
      response.total_bounds = {
        swlat: data.aggregations.bbox.bounds.bottom_right.lat,
        swlng: data.aggregations.bbox.bounds.top_left.lon,
        nelat: data.aggregations.bbox.bounds.top_left.lat,
        nelng: data.aggregations.bbox.bounds.bottom_right.lon
      };
    }
    response.page = Number( req.elastic_query.page );
    response.per_page = Number( req.elastic_query.per_page );
    response.results = obs;
    callback( null, response );
  });
};

ObservationsController.speciesCounts = function( req, callback ) {
  shared.observations.leafCounts( req, ( err, leafCounts ) => {
    if( err ) { return callback( err ); }
    shared.taxa.speciesCountsResponse( req, leafCounts, {}, callback );
  });
};

ObservationsController.iconicTaxaCounts = function( req, callback ) {
  var countQuery = _.extend( { }, req.query );
  countQuery.aggs = {
    iconic_taxa: {
      terms: { field: "taxon.iconic_taxon_id" }
    }
  };
  countQuery.per_page = 0;
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var buckets = _.map( data.aggregations.iconic_taxa.buckets, function( b ) {
      return { taxon_id: b.key, count: b.doc_count };
    });
    var localeOpts = util.localeOpts( req );
    var prepareTaxon = function( t ) {
      t.prepareForResponse( localeOpts );
    }
    var taxonOpts = { modifier: prepareTaxon,
      source: { excludes: [ "photos", "taxon_photos" ] } };
    ESModel.fetchBelongsTo( buckets, Taxon, taxonOpts, function( err ) {
      if( err ) { return callback( err ); }
      callback( null, {
        total_results: buckets.length,
        page: 1,
        per_page: buckets.length,
        results: _.sortBy( buckets, function( b ) {
          return -1 * b.count;
        })
      });
    });
  });
};

ObservationsController.iconicTaxaSpeciesCounts = function( req, callback ) {
  var countQuery = _.extend( { }, req.query, {
    per_page: 0,
    aggs: {
      iconic_taxa: {
        terms: { field: "taxon.iconic_taxon_id" },
        aggs: {
          ancestries: { terms: { field: "taxon.min_species_ancestry", size: 150000 } }
        }
      }
  }});
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var iconicTaxonLeafCounts = [ ];
    _.each( data.aggregations.iconic_taxa.buckets, b => {
      var iconicTaxonID = b.key;
      var knownAncestors = { },
          possibleLeaves = { },
          ancestors, taxonID;
      _.each( b.ancestries.buckets, bb => {
         ancestors = bb.key.split(",");
         taxonID = ancestors.pop( );
         possibleLeaves[ taxonID ] = bb.doc_count;
         _.each( ancestors, function( a ) {
           knownAncestors[ a ] = true;
         });
      });
      var taxonIDs = _.keys( possibleLeaves );
      _.each( taxonIDs, function( taxonID ) {
        if( knownAncestors[ taxonID ] ) {
          delete possibleLeaves[ taxonID ];
        }
      });
      var leafCounts = _.sortBy( _.map( possibleLeaves, function( v, k ) {
        return { taxon_id: k, count: v };
      }), function( o ) {
        return o.count * -1;
      });
      iconicTaxonLeafCounts.push( { taxon_id: iconicTaxonID, count: leafCounts.length } );
    } );

    var localeOpts = util.localeOpts( req );
    var prepareTaxon = function( t ) {
      t.prepareForResponse( localeOpts );
    }
    var taxonOpts = { modifier: prepareTaxon,
      source: { excludes: [ "photos", "taxon_photos" ] } };
    var ESModel = require( "../../models/es_model" );
    ESModel.fetchBelongsTo( iconicTaxonLeafCounts, Taxon, taxonOpts, function( err ) {
      if( err ) { return callback( err ); }
      callback( null, {
        total_results: iconicTaxonLeafCounts.length,
        page: 1,
        per_page: iconicTaxonLeafCounts.length,
        results: _.sortBy( iconicTaxonLeafCounts, function( b ) {
          return -1 * b.count;
        })
      });
    });
  });
};

ObservationsController.identifiers = function( req, callback ) {
  var countQuery = _.extend( { }, req.query );
  countQuery.aggs = {
    nested: {
      nested: { path: "non_owner_ids" },
      aggs: {
        total: { cardinality: { field: "non_owner_ids.user.id", precision_threshold: 10000 } },
        users: {
          terms: { field: "non_owner_ids.user.id", size: req.query.per_page || 500 }
        }
      }
    }
  };
  ESModel.userAggregationResponse( req, countQuery,
    shared.observations.elasticResults, callback );
};

ObservationsController.observers = function( req, callback ) {
  InaturalistAPI.setPerPage( req, { default: 500, max: 500 } );
  // depending on the sort order, need to call observers and species
  // counts, since they need separate queries. The second one to be
  // called with add a user_id filter so we can get the corresponding
  // count for all users from the results of the first query.
  if( req.query.order_by == "species_count" ) {
    ObservationsController.observationsSpeciesObserverCounts( req, function( err, speciesObservers ) {
      if( err ) { return callback( err ); }
      var spQuery = _.extend( { }, req.query );
      spQuery.user_id = _.keys( speciesObservers );
      var spReq = _.extend( { }, req, { query: spQuery });
      ObservationsController.observationsObserverCounts( spReq, function( err, observers ) {
        if( err ) { return callback( err ); }
        ObservationsController.observationsObserversResponse( req, observers, speciesObservers, callback );
      });
    });
  } else {
    ObservationsController.observationsObserverCounts( req, function( err, observers ) {
      if( err ) { return callback( err ); }
      var spQuery = _.extend( { }, req.query );
      spQuery.user_id = _.keys( observers.counts );
      var spReq = _.extend( { }, req, { query: spQuery });
      ObservationsController.observationsSpeciesObserverCounts( spReq, function( err, speciesObservers ) {
        if( err ) { return callback( err ); }
        ObservationsController.observationsObserversResponse( req, observers, speciesObservers, callback );
      });
    });
  }
};

ObservationsController.observationsObserversResponse = function( req, observers, speciesObservers, callback ) {
  // using the node.extend package for a deep clone to merge these objects
  var userIndexedCounts = extend( true, { }, observers.counts, speciesObservers );
  var orderField = ( req.query.order_by == "species_count" ) ?
    "species_count" : "observation_count";
  var userCounts = _.map( userIndexedCounts, function( counts ) {
    counts.observation_count = counts.observation_count || 0;
    counts.species_count = counts.species_count || 0;
    return counts;
  });
  shared.observations.preloadUsers( userCounts, function( err ) {
    if( err ) { return callback( err ); }
    callback( null, {
      total_results: observers.total,
      page: 1,
      per_page: req.query.per_page || userCounts.length,
      results: _.sortBy( userCounts, function( b ) {
        return -1 * b[ orderField ];
      })
    });
  });
};

ObservationsController.observationsObserverCounts = function( req, callback ) {
  var countQuery = _.extend( { }, req.query );
  var perPage = _.isArray( countQuery.user_id ) ?
    countQuery.user_id.length : req.query.per_page || 500;
  countQuery.aggs = {
    total_observers: { cardinality: { field: "user.id", precision_threshold: 10000 } },
    top_observers: { terms: { field: "user.id", size: perPage } }
  };
  countQuery.per_page = 0;
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var userIndexedCounts = _.object( _.map( data.aggregations.top_observers.buckets, function( b ) {
      return [ b.key, { user_id: b.key, observation_count: b.doc_count } ];
    }));
    callback( null, { total: data.aggregations.total_observers.value,
      counts: userIndexedCounts });
  });
};


ObservationsController.observationsSpeciesObserverCounts = function( req, callback ) {
  var countQuery = _.extend( { }, req.query );
  countQuery.hrank = "species";
  countQuery.lrank = "subspecies";
  var perPage = _.isArray( countQuery.user_id ) ?
    countQuery.user_id.length : req.query.per_page || 500;
  countQuery.aggs = {
    user_taxa: {
      terms: {
        field: "user.id", size: perPage, order: { distinct_taxa: "desc" } },
      aggs: {
        distinct_taxa: {
          cardinality: {
            field: "taxon.min_species_ancestry", precision_threshold: 10000 }}}}};
  countQuery.per_page = 0;
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var userIndexedCounts = _.object( _.map( data.aggregations.user_taxa.buckets, function( b ) {
      return [ b.key, { user_id: b.key, species_count: b.distinct_taxa.value } ];
    }));
    callback( null, userIndexedCounts );
  });
};

// returns unviewed notifications about new IDs and comments
// on the authroized user's observations
ObservationsController.updates = function( req, callback ) {
  if( !req.userSession ) {
    return callback({ error: "Unauthorized", status: 401 });
  }
  // do not cache results by default
  req.query.ttl = req.query.ttl || -1;
  InaturalistAPI.setPerPage( req, { default: 20, max: 200 } );
  req.query.page  = Number( req.query.page ) || 1;
  var updatesFilters = [
    { term: { resource_type: "observation" } },
    { term: { notification: "activity" } },
    { terms: { notifier_type: [ "identification", "comment" ] } },
    { term: { subscriber_ids: req.userSession.user_id } }
  ];
  var inverseFilters = [ ];
  if( req.query.created_after ) {
    var afterDate = moment.utc( req.query.created_after ).parseZone( );
    if( afterDate.isValid( ) ) {
      updatesFilters.push( { range: { created_at: {
        gte: afterDate.format( "YYYY-MM-DDTHH:mm:ssZ" )
      }}});
    }
  }
  if( req.query.viewed == "false" ) {
    inverseFilters.push( { term: { viewed_subscriber_ids: req.userSession.user_id } } );
  }
  if( req.query.observations_by == "owner" ) {
    updatesFilters.push( {
      term: { resource_owner_id: req.userSession.user_id }
    } );
  } else if ( req.query.observations_by == "following" ) {
    inverseFilters.push( {
      term: { resource_owner_id: req.userSession.user_id }
    } );
  }
  esClient.connection.search({
    preference: global.config.elasticsearch.preference,
    index: ( process.env.NODE_ENV || global.config.environment ) + "_update_actions",
    body: {
      sort: { id: "desc" },
      size: req.query.per_page,
      from: ( req.query.per_page * req.query.page ) - req.query.per_page,
      query: {
        bool: {
          filter: updatesFilters,
          must_not: inverseFilters
        }
      },
      _source: [ "id", "resource_type", "resource_id", "notifier_type",
        "notifier_id", "notification", "created_at", "resource_owner_id",
        "viewed_subscriber_ids" ]
    }
  }, function( err, response ) {
    if( err ) { return callback( err ); }
    var hits = _.map( response.hits.hits, h => new UpdateAction( h._source ) );
    // add in foreign keys for object preloading
    _.each( hits, h => {
      if( h.notifier_type === "Comment" ) {
        h.comment_id = h.notifier_id;
      } else if( h.notifier_type === "Identification" ) {
        h.identification_id = h.notifier_id;
      }
      if( _.contains( h.viewed_subscriber_ids, req.userSession.user_id ) ) {
        h.viewed = true;
      } else {
        h.viewed = false;
      }
      delete h.viewed_subscriber_ids;
    });

    var localeOpts = util.localeOpts( req );
    Comment.preloadInto( hits, localeOpts, function( ) {
      Identification.preloadInto( hits, localeOpts, function( ) {
        callback( null, {
          total_results: response.hits.total,
          page: req.query.page || 1,
          per_page: req.query.per_page,
          results: hits
        });
      });
    });
  });
};

ObservationsController.deleted = function( req, callback ) {
  req.query.ttl = req.query.ttl || -1;
  if( !req.userSession ) {
    return callback({ error: "Unauthorized", status: 401 });
  }
  var deletedSince;
  if( req.query.since ) {
    deletedSince = moment.utc( req.query.since ).parseZone( );
  }
  if( deletedSince && deletedSince.isValid( ) ) {
    var query = squel.select( ).field( "observation_id ").from( "deleted_observations" ).
      where( "user_id = ? AND created_at >= ?", req.userSession.user_id, deletedSince.format( ) ).
      order( "observation_id", false ).limit( 500 );
    pgClient.connection.query( query.toString( ),
      function( err, result ) {
        if( err ) { return callback( err ); }
        callback( null, {
          total_results: result.rows.length,
          page: 1,
          per_page: 500,
          results: _.map( result.rows, "observation_id" )
        });
      }
    );
  } else {
    callback( null, {
      total_results: 0,
      page: 1,
      per_page: 500,
      results: [ ]
    });
  }
};

ObservationsController.popularFieldValues = function( req, callback ) {
  var countQuery = _.extend( { }, req.query, { annotation_min_score: 0 } );
  countQuery.aggs = {
    nested_annotations: {
      nested: { path: "annotations" },
      aggs: {
        attributes: {
          terms: {
            field: "annotations.concatenated_attr_val",
            size: 100
          },
          aggs: {
            back_to_observation: {
              reverse_nested: { },
              aggs: {
                by_month: {
                  terms: {
                    field: "observed_on_details.month",
                    size: 12 }}}}}}}}};
  countQuery.per_page = 0;
  var countReq = _.extend( { }, req, { query: countQuery });
  shared.observations.elasticResults( countReq, function( err, data ) {
    if( err ) { return callback( err ); }
    var resultOptions = { backfill: { min: 1, max: 12 } };
    var results = [ ];
    var controlledTermsIDs = { };
    _.each( data.aggregations.nested_annotations.attributes.buckets, b => {
      var pieces = b.key.split( "|" );
      controlledTermsIDs[ Number( pieces[0] ) ] = true;
      controlledTermsIDs[ Number( pieces[1] ) ] = true;
      results.push( {
        controlled_attribute_id: pieces[0],
        controlled_value_id: pieces[1],
        count: b.back_to_observation.doc_count,
        month_of_year: util.aggBucketsToHash(
          b.back_to_observation.by_month.buckets, resultOptions )
      });
    });
    ESModel.fetchInstancesByIDsObject( controlledTermsIDs, ControlledTerm, { }, ( err, terms ) => {
      if( err ) { return callback( err ); }
      _.each( terms, t => (
        t.values = _.map( t.values, v => ( new ControlledTerm( v ) ) )
      ));
      _.each( results, r => {
        if( terms[ r.controlled_attribute_id ] ) {
          r.controlled_attribute = terms[ r.controlled_attribute_id ];
          delete r.controlled_attribute_id;
        }
        if( terms[ r.controlled_value_id ] ) {
          r.controlled_value = terms[ r.controlled_value_id ];
          delete r.controlled_value_id;
        }
      });
      results = _.filter( results, r => (
        r.controlled_attribute && r.controlled_value
      ));
      callback( null, {
        total_results: results.length,
        page: 1,
        per_page: results.length,
        results: _.sortBy( results, r => ( -1 * r.count ) )
      });
    });
  });
};

ObservationsController.qualityMetrics = ( req, callback ) => {
  var query = squel.select( ).field( "*" ).
    from( "quality_metrics" ).where( "observation_id = ?", req.params.id );
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    var results = result.rows;
    ESModel.fetchBelongsTo( results, User, { }, () => {
      callback( null, {
        total_results: results.length,
        page: 1,
        per_page: results.length,
        results: results
      });
    });
  });
};

ObservationsController.subscriptions = ( req, callback ) => {
  if( !req.userSession ) {
    return callback({ error: "Unauthorized", status: 401 });
  }
  var query = squel.select( ).field( "s.*" ).
    from( "observations o" ).
    join( "subscriptions s", null, `(
      (s.resource_type='Observation' AND s.resource_id=o.id) OR
      (s.resource_type='User' and s.resource_id=o.user_id) )` ).
    where( "o.id = ?", req.params.id ).
    where( "s.user_id = ?", req.userSession.user_id);
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    var results = result.rows;
    callback( null, {
      total_results: results.length,
      page: 1,
      per_page: results.length,
      results: results
    });
  });
};

module.exports = {
  create: ObservationsController.create,
  delete: ObservationsController.delete,
  deleted: ObservationsController.deleted,
  deleteQualityMetric: ObservationsController.deleteQualityMetric,
  fave: ObservationsController.fave,
  histogram: ObservationsController.histogram,
  iconicTaxaCounts: ObservationsController.iconicTaxaCounts,
  iconicTaxaSpeciesCounts: ObservationsController.iconicTaxaSpeciesCounts,
  identifiers: ObservationsController.identifiers,
  observers: ObservationsController.observers,
  popularFieldValues: ObservationsController.popularFieldValues,
  qualityMetrics: ObservationsController.qualityMetrics,
  reqToElasticQuery: ObservationsController.reqToElasticQuery,
  review: ObservationsController.review,
  search: ObservationsController.search,
  setQualityMetric: ObservationsController.setQualityMetric,
  show: ObservationsController.show,
  speciesCounts: ObservationsController.speciesCounts,
  subscribe: ObservationsController.subscribe,
  subscriptions: ObservationsController.subscriptions,
  taxonSummary: ObservationsController.taxonSummary,
  unfave: ObservationsController.unfave,
  unreview: ObservationsController.unreview,
  update: ObservationsController.update,
  updates: ObservationsController.updates
};
