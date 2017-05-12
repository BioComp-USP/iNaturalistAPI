"use strict";
var _ = require( "underscore" ),
    ControlledTerm = require( "../models/controlled_term" ),
    DBModel = require( "../models/db_model" ),
    esClient = require( "../es_client" ),
    ESModel = require( "../models/es_model" ),
    Fave = require( "../models/fave" ),
    Flag = require( "../models/flag" ),
    Identification = require( "../models/identification" ),
    InaturalistAPI = require( "../inaturalist_api" ),
    moment = require( "moment" ),
    ObservationField = require( "../models/observation_field" ),
    pgClient = require( "../pg_client" ),
    QualityMetric = require( "../models/quality_metric" ),
    querystring = require( "querystring" ),
    squel = require( "squel" ),
    Taxon = require( "../models/taxon" ),
    User = require( "../models/user" ),
    util = require( "../util" );

const leafCounts = function( req, callback ) {
  ESModel.ancestriesSpeciesCounts( req, "taxon.min_species_ancestry",
    elasticResults, callback );
};

const applyProjectRules = function( req, callback ) {
  var params = _.extend( { }, req.query );
  // if given a project whose rules to apply, fetch those
  // rules and call this method again with the merged params
  req.inat.apply_project_rules_for.searchParams( function( err, rules ) {
    delete params.apply_project_rules_for;
    delete req.inat.apply_project_rules_for;
    params = _.extend( { }, params, rules );
    reqToElasticQueryComponents(
      _.extend( { }, req, { query: params }), callback );
  });
};

const applyInverseProjectRules = function( req, callback ) {
  var params = _.extend( { }, req.query );
  req.inat.not_matching_project_rules_for.searchParams( function( err, r ) {
    delete params.not_matching_project_rules_for;
    delete req.inat.not_matching_project_rules_for;
    reqToElasticQueryComponents( _.extend( { }, req, { query: r }),
      function( err, components ) {
        if( err ) { return callback( err ); }
        params = _.extend( { }, params, { grouped_inverse_filters: components.search_filters } );
        reqToElasticQueryComponents(
          _.extend( { }, req, { query: params }), callback );
      }
    );
  });
};

const applyListTaxaFilters = function( req, callback ) {
  var params = _.extend( { }, req.query );
  // if given a list, fetch its taxon_ids and use those as params
  req.inat.list.taxonIDs( function( err, ids ) {
    delete params.list_id;
    delete req.inat.list;
    params.taxon_ids = params.taxon_ids || [ ];
    params.taxon_ids = params.taxon_ids.concat( ids );
    reqToElasticQueryComponents(
      _.extend( { }, req, { query: params }), callback );
  });
};

const applyUnobservedByUserFilters = function( req, callback ) {
  // if given a list, fetch its taxon_ids and use those as params
  var observedReq = {
    query: {
      user_id: req.inat.unobservedByUser.id,
      hrank: "species",
      per_page: 10000
    }
  };
  // preserve the taxon_id and without_taxon_id for faster queries, and
  // ignore the rest so we have a complete species list for the user
  if( req.query.taxon_id ) {
    observedReq.query.taxon_id = req.query.taxon_id;
  }
  if( req.query.without_taxon_id ) {
    observedReq.query.without_taxon_id = req.query.without_taxon_id;
  }
  leafCounts( observedReq, ( err, taxonCounts ) => {
    if( err ) { return callback( err ); }
    var withoutTaxonIDs = _.map( taxonCounts, c => c.taxon_id );
    if( req.query.without_taxon_id ) {
      // combining with without_taxon_id parameter
      withoutTaxonIDs =
        withoutTaxonIDs.concat( util.paramArray( req.query.without_taxon_id ) );
    }
    var params = _.extend( { }, req.query );
    delete params.unobserved_by_user_id;
    delete req.inat.unobservedByUser;
    params.without_taxon_id = withoutTaxonIDs;
    reqToElasticQueryComponents(
      _.extend( { }, req, { query: params }), callback );
  });
};

const conservationCondition = function( esField, values, params ) {
  // use a nested query to search the specified fields
  var filters = [ ];
  var inverseFilters = [ ];
  var statusFilter = { terms: { } };
  statusFilter.terms[ "taxon.statuses." + esField ] = values;
  filters.push( statusFilter );
  if( params.place_id ) {
    // if a place condition is specified, return all results
    // from the place(s) specified, or where place is NULL
    filters.push( { bool: { should: [
      { terms: { "taxon.statuses.place_id": util.paramArray( params.place_id ) } },
      { bool: { must_not: { exists: { field: "taxon.statuses.place_id" } } } }
    ] } } );
  } else {
    // no place condition specified, so apply a `place is NULL` condition
    inverseFilters.push( { exists: { field: "taxon.statuses.place_id" } } );
  }
  var statusCondition = {
    nested: {
      path: "taxon.statuses",
      query: { bool: {
        filter: filters,
        must_not: inverseFilters } }
    }
  };
  return statusCondition;
};

const reqToElasticQueryComponents = function( req, callback ) {
  if( req.inat ) {
    if( req.inat.apply_project_rules_for ) {
      return applyProjectRules( req, callback );
    }
    if( req.inat.not_matching_project_rules_for ) {
      return applyInverseProjectRules( req, callback );
    }
    if( req.inat.list ) {
      return applyListTaxaFilters( req, callback );
    }
    if( req.inat.unobservedByUser ) {
      return applyUnobservedByUserFilters( req, callback );
    }
  }
  var p = req.query;
  // clone the params object
  var params = _.extend( { }, p );
  var search_filters = [ ];
  var inverse_filters = params.inverse_filters || [ ];
  var grouped_inverse_filters = params.grouped_inverse_filters || [ ];

  if( params.has && _.isArray( params.has ) ) {
    _.each( params.has, function( p ) {
      params[ p ] = "true";
    });
  }
  if( params.q ) {
    var search_on = params.search_on;
    var fields;
    switch( search_on ) {
      case "names":
        fields = [ "taxon.names.name" ];
        break;
      case "tags":
        fields = [ "tags" ];
        break;
      case "description":
        fields = [ "description" ];
        break;
      case "place":
        fields = [ "place_guess" ];
        break;
      default:
        fields = [ "taxon.names.name", "tags", "description", "place_guess" ];
    }
    search_filters.push({ multi_match: {
      query: params.q, operator: "and", fields: fields }});
  }

  var observed_on_param = params.observed_on || params.on;
  var observed_on = observed_on_param ? moment( observed_on_param ) : null;
  if( observed_on && observed_on.isValid( ) ) {
    observed_on.parseZone( );
    params.day = params.day || observed_on.date( );
    params.month = params.month || observed_on.month( ) + 1;
    params.year = params.year || observed_on.year( );
  }

  if( !_.isEmpty( params.user_id ) && !Number( params.user_id ) &&
      !_.isArray( params.user_id )) {
    params.user_login = params.user_id;
    delete params.user_id;
  }

  if( params.photo_license && !_.isArray( params.photo_license ) ) {
    params.photo_license = params.photo_license.toLowerCase( );
  }
  if( params.sound_license && !_.isArray( params.sound_license ) ) {
    params.sound_license = params.sound_license.toLowerCase( );
  }
  _.each([ { http_param: "rank", es_field: "taxon.rank" },
    { http_param: "user_id", es_field: "user.id" },
    { http_param: "user_login", es_field: "user.login" },
    { http_param: "taxon_name", es_field: "taxon.names.name" },
    { http_param: "day", es_field: "observed_on_details.day" },
    { http_param: "month", es_field: "observed_on_details.month" },
    { http_param: "year", es_field: "observed_on_details.year" },
    { http_param: "week", es_field: "observed_on_details.week" },
    { http_param: "place_id", es_field: "place_ids" },
    { http_param: "site_id", es_field: "site_id" },
    { http_param: "id", es_field: "id" },
    { http_param: "license", es_field: "license_code" },
    { http_param: "photo_license", es_field: "photos.license_code" },
    { http_param: "sound_license", es_field: "sounds.license_code" }
  ], function( filter ) {
    if( params[ filter.http_param ] && params[ filter.http_param ] != "any" ) {
      search_filters.push( esClient.termFilter(
        filter.es_field, params[ filter.http_param ] ) );
    }
  });

  _.each([ { http_param: "introduced", es_field: "taxon.introduced" },
    { http_param: "threatened", es_field: "taxon.threatened" },
    { http_param: "native", es_field: "taxon.native" },
    { http_param: "endemic", es_field: "taxon.endemic" },
    { http_param: "id_please", es_field: "id_please" },
    { http_param: "out_of_range", es_field: "out_of_range" },
    { http_param: "mappable", es_field: "mappable" },
    { http_param: "captive", es_field: "captive" }
  ], function( filter ) {
    if( params[ filter.http_param ] == "true" ) {
      search_filters.push( esClient.termFilter( filter.es_field, true ) );
    } else if( params[ filter.http_param ] == "false" ) {
      search_filters.push( esClient.termFilter( filter.es_field, false ) );
    }
  });

  _.each([ { http_param: "photos", es_field: "photos.url" },
    { http_param: "sounds", es_field: "sounds" },
    { http_param: "geo", es_field: "geojson" },
    { http_param: "identified", es_field: "taxon" }
  ], function( filter ) {
    var f = { exists: { field: filter.es_field } };
    if( params[ filter.http_param ] == "true" ) {
      search_filters.push( f );
    } else if( params[ filter.http_param ] == "false" ) {
      inverse_filters.push( f );
    }
  });

  // include the taxon plus all of its descendants.
  // Every taxon has its own ID in ancestor_ids
  if( params.taxon_id || params.taxon_ids ) {
    search_filters.push( esClient.termFilter(
      "taxon.ancestor_ids", params.taxon_id || params.taxon_ids ) );
  }

  if( params.without_taxon_id ) {
    inverse_filters.push( { terms: {
      "taxon.ancestor_ids": util.paramArray( params.without_taxon_id ) } });
  }

  if( params.not_id ) {
    search_filters.push( { not: {
      terms: { id: util.paramArray( params.not_id ) }
    }});
  }

  if( params.verifiable == "true" ) {
    search_filters.push(
      esClient.termFilter( "quality_grade", [ "needs_id", "research" ] ) );
  } else if( params.verifiable == "false" ) {
    inverse_filters.push( { terms: { quality_grade: [ "needs_id", "research" ] } });
  }

  var created_on = params.created_on ? moment( params.created_on ) : null;
  if( created_on && created_on.isValid( ) ) {
    created_on.parseZone( );
    search_filters.push( esClient.termFilter(
      "created_at_details.day", created_on.date( ) ) );
    search_filters.push( esClient.termFilter(
      "created_at_details.month", created_on.month( ) + 1 ) );
    search_filters.push( esClient.termFilter(
      "created_at_details.year", created_on.year( ) ) );
  }

  params.project_id = params.project_id || params.project_ids;
  if( params.project_id && !( _.isArray( params.project_id ) && _.isEmpty( params.project_id ))) {
    search_filters.push( esClient.termFilter( "project_ids", params.project_id ) );
    if( params.pcid ) {
      if( params.pcid == "true" ) {
        search_filters.push( esClient.termFilter(
          "project_ids_with_curator_id", params.project_id ) );
      } else if( params.pcid == "false" ) {
        search_filters.push( esClient.termFilter(
          "project_ids_without_curator_id", params.project_id ) );
      }
    }
  } else if( params.pcid ) {
    if( params.pcid == "true" ) {
      search_filters.push({ exists: {
        field: "project_ids_with_curator_id" } });
    } else if( params.pcid == "false" ) {
      search_filters.push({ exists: {
        field: "project_ids_without_curator_id" } });
    }
  }
  if( params.not_in_project ) {
    inverse_filters.push( { term: { project_ids: params.not_in_project } } );
  }
  if( params.hrank || params.lrank ) {
    search_filters.push({ range: { "taxon.rank_level": {
      gte: Taxon.ranks[ params.lrank ] || 0,
      lte: Taxon.ranks[ params.hrank ] || 100 } } });
  }
  if( params.quality_grade && params.quality_grade !== "any" ) {
    search_filters.push( esClient.termFilter(
      "quality_grade", params.quality_grade ) );
  }
  if( params.identifications === "most_agree" ) {
    search_filters.push( esClient.termFilter( "identifications_most_agree", true ) );
  } else if( params.identifications === "some_agree" ) {
    search_filters.push( esClient.termFilter( "identifications_some_agree", true ) );
  } else if( params.identifications === "most_disagree" ) {
    search_filters.push( esClient.termFilter( "identifications_most_disagree", true ) );
  }

  if( params.nelat || params.nelng || params.swlat || params.swlng ) {
    search_filters.push({ envelope: { geojson: {
      nelat: params.nelat, nelng: params.nelng,
      swlat: params.swlat, swlng: params.swlng } } });
  }

  if( params.lat && params.lng ) {
    search_filters.push({ geo_distance: {
      distance: ( params.radius || 10 ) + "km",
      location: { lat: params.lat, lon: params.lng }
    }});
  }

  if( params.iconic_taxa ) {
    var includesUnknown = false;
    var names = util.paramArray( params.iconic_taxa );
    var iconicTaxonIDs = _.compact( _.map( names, function( n ) {
      if( n === "unknown" ) { includesUnknown = true; }
      return Taxon.iconicTaxonID( n );
    }));
    if( includesUnknown ) {
      search_filters.push({ bool: { should: [
        { terms: { "taxon.iconic_taxon_id": iconicTaxonIDs } },
        { bool: { must_not: { exists: { field: "taxon.iconic_taxon_id" } } } }
      ]}});
    } else {
      search_filters.push( esClient.termFilter(
        "taxon.iconic_taxon_id", iconicTaxonIDs ) );
    }
  }

  if( params.viewer_id ) {
    if( params.reviewed === "true" ) {
      search_filters.push( esClient.termFilter(
        "reviewed_by", params.viewer_id ) );
    } else if( params.reviewed === "false" ) {
      inverse_filters.push( {  term: { reviewed_by: params.viewer_id } } );
    }
  }

  var drf;
  if(( drf = util.dateRangeFilter( "time_observed_at", params.d1, params.d2, "observed_on_details.date" ))) {
    search_filters.push( drf );
  }
  if(( drf = util.dateRangeFilter( "created_at", params.created_d1, params.created_d2 ))) {
    search_filters.push( drf );
  }

  if( params.featured_observation_id ) {
    inverse_filters.push( { term: { id: params.featured_observation_id } });
  }

  let parsedDate;
  if( params.updated_since ) {
    parsedDate = moment.utc( Date.parse( params.updated_since ) );
    if( parsedDate && parsedDate.isValid( ) ) {
      search_filters.push({ range: { updated_at: { gte: parsedDate.format( "YYYY-MM-DDTHH:mm:ssZ" ) } } });
    }
  }

  if( params.observed_after ) {
    parsedDate = moment.utc( Date.parse( params.observed_after ) );
    if( parsedDate && parsedDate.isValid( ) ) {
      search_filters.push({ range: { observed_on: { gte: parsedDate.format( "YYYY-MM-DDTHH:mm:ssZ" ) } } });
    }
  }

  var nested_query;
  if( params.term_id ) {
    nested_query = {
      nested: {
        path: "annotations",
        query: { bool: { filter: [
          { term: { "annotations.controlled_attribute_id": params.term_id } },
          { range: { "annotations.vote_score": { gte: 0 } } }
        ] } }
      }
    }
    if( params.term_value_id ) {
      nested_query.nested.query.bool.filter.push({
        term: { "annotations.controlled_value_id": params.term_value_id } });
    }
    search_filters.push( nested_query );
  } else if( params.annotation_min_score || params.annotation_min_score === 0 ) {
    nested_query = {
      nested: {
        path: "annotations",
        query: { bool: { filter: [
          { range: { "annotations.vote_score": { gte: params.annotation_min_score } } }
        ] } }
      }
    }
    search_filters.push( nested_query );
  }

  // the default "extended" qs query parser for express is great
  // for many things, except when there are escaped brackets in
  // params keys (e.g. field:Origin%2B%5BIUCN%2BRed%2BList%5D)
  // using `querystring` here, which is the default express "simple"
  // query parser
  var simpleParsedParams = req._parsedUrl ? querystring.parse( req._parsedUrl.query ) : { };
  _.each( simpleParsedParams, function( v, k ) {
    // use a nested query to search within a single nested
    // object and not across all nested objects
    var matches = k.match( /^field:(.*)/ );
    if( _.isEmpty( matches ) ) { return; }
    // this and Rails will turn + and %20 into spaces
    var fieldName = matches[ 1 ].replace( /(%20|\+)/g, " ");
    nested_query = {
      nested: {
        path: "ofvs",
        query: { bool: { filter: [ { match: {
          "ofvs.name": fieldName } } ] }
        }
      }
    }
    if( v ) {
      nested_query.nested.query.bool.filter.push({
        match: { "ofvs.value": v } });
    }
    search_filters.push( nested_query );
  });
  // conservation status
  var values;
  if( params.cs ) {
    values = _.map( util.paramArray( params.cs ), function( v ) {
      return v.toLowerCase( );
    });
    search_filters.push( conservationCondition( "status", values, params ) );
  }
  // IUCN conservation status
  if( params.csi ) {
    values = _.filter( _.map( util.paramArray( params.csi ), function( v ) {
      return util.iucnValues[ v.toLowerCase( ) ];
    }), _.identity );
    if( values.length > 0 ) {
      search_filters.push( conservationCondition( "iucn", values, params ) );
    }
  }
  // conservation status authority
  if( params.csa ) {
    values = _.map( util.paramArray( params.csa ), function( v ) {
      return v.toLowerCase( );
    });
    search_filters.push( conservationCondition( "authority", values, params ) );
  }

  if( params.popular === "true" ) {
    search_filters.push({ range: { cached_votes_total: { gte: 1 } } });
  } else if( params.popular === "false" ) {
    search_filters.push( esClient.termFilter( "cached_votes_total", 0 ) );
  }

  if( params.id_above ) {
    search_filters.push({ range: { id: { gt: params.id_above } } });
  }
  if( params.id_below ) {
    search_filters.push({ range: { id: { lt: params.id_below } } });
  }

  if( params.geoprivacy === "open" ) {
    inverse_filters.push({ exists: { field: "geoprivacy" } });
  } else if( params.geoprivacy === "obscured_private" ) {
    search_filters.push( esClient.termFilter( "geoprivacy", [ "obscured", "private" ] ) );
  } else if( params.geoprivacy && params.geoprivacy != "any" ) {
    search_filters.push( esClient.termFilter( "geoprivacy", params.geoprivacy ) );
  }

  if( params.changed_since ) {
    var changedDate = moment.utc( new Date( params.changed_since ) ).parseZone( )
    if( changedDate && changedDate.isValid( ) ) {
      nested_query = {
        nested: {
          path: "field_change_times",
          query: {
            bool: {
              filter: [ { range: { "field_change_times.changed_at":
                { gte: changedDate.format( "YYYY-MM-DDTHH:mm:ssZ" ) }}}]
            }
          }
        }
      }
      if( params.changed_fields ) {
        // one of these fields must have changed (and recorded by Rails)
        nested_query.nested.query.bool.filter.push({
          terms: { "field_change_times.field_name":
            util.paramArray( params.changed_fields ) }
        });
      }
      if( params.change_project_id ) {
        // if there's a project_id, but must be this one
        nested_query.nested.query.bool.filter.push({
          or: [
            { terms: { "field_change_times.project_id":
              util.paramArray( params.change_project_id ) } },
            { not: { exists: { field: "field_change_times.project_id" } } }
          ]
        });
      }
      search_filters.push( nested_query );
    }
  }

  if( params.not_in_place ) {
    inverse_filters.push({ terms: {
      place_ids: util.paramArray( params.not_in_place ) } });
  }

  // sort defaults to created at descending
  var sort_order = ( params.order || "desc" ).toLowerCase( );
  var sort;
  switch( params.order_by ) {
    case "observed_on":
      sort = {
        "observed_on_details.date": sort_order,
        time_observed_at: { order: sort_order, missing: (sort_order === "desc" ? "_last" : "_first") },
        created_at: sort_order };
      break;
    case "species_guess":
      sort = { species_guess: sort_order };
      break;
    case "votes":
      sort = { cached_votes_total: sort_order };
      break;
    case "id":
      sort = { id: sort_order };
      break;
    case "random":
      sort = "random"; // handle in esClient.searchHash
      break;
    default:
      sort = { created_at: sort_order };
  }
  callback( null, {
    search_filters: search_filters,
    inverse_filters: inverse_filters,
    grouped_inverse_filters: grouped_inverse_filters,
    sort: sort
  });
};

const reqToElasticQuery = function( req, callback ) {
  reqToElasticQueryComponents( req, function( err, components ) {
    if( err ) { return callback( err ); }
    var elasticQuery = {
      where: components.search_wheres,
      filters: components.search_filters,
      inverse_filters: components.inverse_filters,
      grouped_inverse_filters: components.grouped_inverse_filters,
      per_page: InaturalistAPI.perPage( req, { default: 30, max: 200 } ),
      page: req.query.page || 1,
      sort: components.sort
    };
    callback( null, elasticQuery );
  });
};

const elasticResults = function( req, callback ) {
  reqToElasticQuery( req, function( err, query ) {
    if( err ) { return callback( err ); }
    var opts = { excludes: [ "taxon.names", "taxon.photos", "taxon.taxon_photos" ] };
    ESModel.elasticResults( req, query, "observations", opts, callback );
  });
};

const preloadUsers = ( obs, callback ) => {
  ESModel.fetchBelongsTo( obs, User, { }, callback );
}

const preloadIdentifications = ( obs, callback ) => {
  DBModel.fetchHasMany( obs, Identification, "observation_id", { }, callback );
}

const preloadFaves = ( obs, callback ) => {
  DBModel.fetchHasMany( obs, Fave, "votable_id", { }, callback );
}

const preloadFlags = ( obs, callback ) => {
  const comments = _.compact( _.flatten( _.pluck( obs, "comments" ) ) );
  const ids = _.compact( _.flatten( _.pluck( obs, "identifications" ) ) );
  var withFlags = _.filter(
    _.flatten( [ obs, comments, ids ] ), _.identity
  );
  DBModel.fetchHasMany( withFlags, Flag, "flaggable_id", { }, err => {
    if ( err ) { return callback( err ); }
    _.each( obs, o => {
      o.flags = _.filter( o.flags, f => f.flaggable_type == "Observation" );
    } );
    _.each( comments, c => {
      c.flags = _.filter( c.flags, f => f.flaggable_type == "Comment" );
    } );
    _.each( ids, id => {
      id.flags = _.filter( id.flags, f => f.flaggable_type == "Identification" );
    } );
    callback( );
  } );
}

const preloadQualityMetrics = ( obs, callback ) => {
  DBModel.fetchHasMany( obs, QualityMetric, "observation_id", { }, callback );
}

const preloadAnnotationControlledTerms = ( obs, callback ) => {
  ESModel.fetchBelongsTo(
    _.flatten( _.pluck( obs, "annotations" ) ),
    ControlledTerm,
    { idFields: {
      controlled_value_id: "controlled_value",
      controlled_attribute_id: "controlled_attribute" } },
    callback );
}

const preloadObservationFields = ( obs, callback ) => {
  ESModel.fetchBelongsTo(
    _.flatten( _.pluck( obs, "ofvs" ) ),
    ObservationField,
    { foreignKey: "field_id" },
    callback );
}

const preloadProjectMembership = ( obs, options, callback ) => {
  if ( !options.userSession || !options.userSession.user_id ) { return callback( null ); }
  const projobs = _.compact( _.flatten( _.map( obs, o => ( o.project_observations ) ) ) );
  const projectIDs = _.compact( _.map( projobs, po => ( po.project.id ) ) );
  if ( projectIDs.length === 0 ) { return callback( null ); }
  const query = squel.select( ).fields([ "pu.project_id" ]).
    from( "project_users pu" ).
    where( "pu.project_id IN ?", projectIDs ).
    where( "pu.user_id = ?", options.userSession.user_id );
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    const memberProjects = { };
    _.each( result.rows, r => {
      memberProjects[ r.project_id ] = true;
    });
    _.each( projobs, po => {
      po.current_user_is_member = memberProjects[ po.project.id ] || false;
    });
    callback( null );
  });
}

const preloadProjectObservationPreferences = ( obs, options, callback ) => {
  if ( !options.userSession || !options.userSession.user_id ) { return callback( null ); }
  const projobs = _.compact( _.flatten( _.map( obs, o => ( o.project_observations ) ) ) );
  const projobsIDs = _.compact( _.map( projobs, po => ( po.uuid ) ) );
  if ( projobsIDs.length === 0 ) { return callback( null ); }
  const query = squel.select( ).fields([ "po.uuid, p.name, p.value" ]).
    from( "project_observations po" ).
    left_join( "preferences p",  null,
      "po.id = p.owner_id AND p.owner_type= 'ProjectObservation' AND p.name = 'curator_coordinate_access'" ).
    where( "po.uuid IN ?", projobsIDs );
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    const projectObsPrefs = { };
    _.each( result.rows, r => {
      if ( r.value === "t" ) {
        projectObsPrefs[ r.uuid ] = true;
      } else if ( r.value === "f" ) {
        projectObsPrefs[ r.uuid ] = false;
      }
    });
    _.each( projobs, po => {
      po.preferences = { allows_curator_coordinate_access: projectObsPrefs[ po.uuid ] || false };
    });
    callback( null );
  });
}

const preloadObservationPreferences = ( obs, callback ) => {
  if ( obs.length === 0 ) { return callback( null ); }
  const obsIDs = _.map( obs, o => ( o.id ) );
  const query = squel.select( ).fields([ "o.id, p.name, p.value" ]).
    from( "observations o" ).
    left_join( "preferences p",  null,
      "o.id = p.owner_id AND p.owner_type= 'Observation' AND p.name = 'community_taxon'" ).
    where( "o.id IN ?", obsIDs );
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    const obsPrefs = { };
    _.each( result.rows, r => {
      if ( r.value === "t" ) {
        obsPrefs[ r.id ] = true;
      } else if ( r.value === "f" ) {
        obsPrefs[ r.id ] = false;
      }
    });
    _.each( obs, o => {
      o.preferences = { prefers_community_taxon: obsPrefs[ o.id ] };
    });
    callback( null );
  });
}

const preloadObservationUserPreferences = ( obs, callback ) => {
  if ( obs.length === 0 ) { return callback( null ); }
  const userIDs = _.map( obs, o => ( o.user.id ) );
  const query = squel.select( ).fields([ "u.id, p.name, p.value" ]).
    from( "users u" ).
    left_join( "preferences p",  null,
      "u.id = p.owner_id AND p.owner_type= 'User' AND p.name = 'community_taxa'" ).
    where( "u.id IN ?", userIDs );
  pgClient.connection.query( query.toString( ), ( err, result ) => {
    if( err ) { return callback( err ); }
    const userPrefs = { };
    _.each( result.rows, r => {
      if ( r.value === "t" ) {
        userPrefs[ r.id ] = true;
      } else if ( r.value === "f" ) {
        userPrefs[ r.id ] = false;
      }
    });
    _.each( obs, o => {
      o.user.preferences = { prefers_community_taxa: userPrefs[ o.user.id ] };
    });
    callback( null );
  });
}

module.exports = {
  leafCounts,
  elasticResults,
  reqToElasticQuery,
  preloadFlags,
  preloadFaves,
  preloadIdentifications,
  preloadUsers,
  preloadObservationPreferences,
  preloadObservationUserPreferences,
  preloadProjectObservationPreferences,
  preloadProjectMembership,
  preloadObservationFields,
  preloadAnnotationControlledTerms,
  preloadQualityMetrics
};
