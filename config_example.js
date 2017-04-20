var environment = "development";
if ( global && global.config && global.config.environment ) {
  environment = global.config.environment;
}
if ( process && process.env && process.env.NODE_ENV ) {
  environment = process.env.NODE_ENV;
}
module.exports = {
  environment: environment,
  elasticsearch: {
    host: "localhost:9200",
    geoPointField: "location",
    searchIndex: `${environment}_observations`,
    placeIndex: `${environment}_places`
  },
  database: {
    user: "username",
    host: "127.0.0.1",
    port: 5432,
    geometry_field: "geom",
    srid: 4326,
    dbname: `inaturalist_${environment}`,
    password: "password",
    ssl: false
  },
  tileSize: 512,
  debug: true,
  imageProcesing: {
    taxaFilePath: "",
    uploadsDir: "",
    tensorappURL: ""
  }
};
