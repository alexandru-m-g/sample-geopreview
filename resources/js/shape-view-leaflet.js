(function () {
  var options = {
    pcode: null,
    value: null,
    pcodeSelectorId: '#pcode',
    valueSelectorId: '#value',
    baseLayer: null,
    invertLatLong: true,
    boundaryPoly: {
      minLat: null,
      maxLat: null,
      minLong: null,
      maxLong: null,
      overlap: true,
    },
    data: null,
    fields: null,
    geoData: null,
    pcodeMap: {},
  };

  var defaultStyle = {
    weight: 1,
    fill: true,
    fillColor: 'rgb(255, 73, 61)',
    fillOpacity: 0.6,
    color: 'rgb(255, 73, 61)',
  };
  var defaultLineStyle = {
    color: 'rgb(255, 73, 61)',
    weight: 3,
  };
  var defaultPointStyle = {
    weight: 0,
    color: 'rgb(255, 73, 61)',
    radius: 8,
    fill: true,
    fillColor: 'rgb(255, 73, 61)',
    fillOpacity: 0.6,
  };

  function layerStyling(properties, zoom, geometryDimension) {
    if (!properties.__geometryDimension) {
      properties.__geometryDimension = geometryDimension;
    } else if (!geometryDimension) {
      geometryDimension = properties.__geometryDimension;
    }
    if (geometryDimension === 1) {
      // point
      return defaultPointStyle;
    } else if (geometryDimension === 2) {
      // line
      return defaultLineStyle;
    } else {
      // polygon
      return defaultStyle;
    }
  }

  function getFieldListAndBuildLayer(layerData, info, firstAdded, options, layers) {
    var ALLOWED_COLUMN_TYPES = ['character varying', 'integer', 'numeric'];

    var value = layerData.url;

    var bboxArray = layerData.bounding_box.replace('BOX(', '').replace(')', '').split(',');
    var xmin = bboxArray[0].split(' ')[0];
    var ymin = bboxArray[0].split(' ')[1];
    var xmax = bboxArray[1].split(' ')[0];
    var ymax = bboxArray[1].split(' ')[1];
    var bounds = [
      [ymin, xmin],
      [ymax, xmax],
    ];

    function createLayer(extraFields) {
      var mvtSource = L.vectorGrid.protobuf(
        value + '?geom=wkb_geometry&fields=ogc_fid' + extraFields, // postile
        {
          interactive: true,
          getFeatureId: function (feature) {
            return feature.properties.ogc_fid;
          },
          vectorTileLayerStyles: {
            [layerData.layer_id]: layerStyling, // for newer vector tiles servers
            PROJ_LIB: layerStyling, // for the old GISAPI server
          },
          layerLink: function (layerName) {
            if (layerName.indexOf('_label') > -1) {
              return layerName.replace('_label', '');
            }
            return layerName + '_label';
          },
        }
      );
      mvtSource.on('mouseover', function (event) {
        if (event.layer && event.layer.properties) {
          var layer = event.layer;
          var featureId = layer.properties.ogc_fid;
          mvtSource.setFeatureStyle(featureId, {
            weight: layer.options.weight + 3,
            color: layer.options.color,
            fillColor: layer.options.fillColor,
            fillOpacity: 0.8,
            fill: layer.options.fill,
          });
          info.update(event.layer.properties);
        }
      });
      mvtSource.on('mouseout', function (event) {
        if (event.layer && event.layer.properties) {
          var featureId = event.layer.properties.ogc_fid;
          mvtSource.resetFeatureStyle(featureId);
        }
      });
      mvtSource.myFitBounds = function () {
        options.map.fitBounds(bounds);
      };
      if (!firstAdded) {
        mvtSource.myFitBounds();
        options.map.addLayer(mvtSource);
        firstAdded = true;
      }

      layers[layerData.resource_name] = mvtSource;
    }

    var promise = null;
    var layer_fields = layerData.layer_fields;
    if (layer_fields && layer_fields.length > 0) {
      // New way in which the fields are stored in 'shape_info' in CKAN

      var extraFields = '';
      for (var i = 0; i < layer_fields.length; i++) {
        var field = layer_fields[i];
        if (field.field_name !== 'ogc_fid' && ALLOWED_COLUMN_TYPES.indexOf(field.data_type) >= 0) {
          var escaped_field_name = encodeURIComponent(field.field_name);
          extraFields += ',"' + escaped_field_name + '"';
        }
      }
      createLayer(extraFields);
    } else {
      // Still supporting the old way for backwards compatibility - fetching fields from spatial server

      var fieldsInfo = value.substr(0, value.indexOf('/wkb_geometry/vector-tiles/{z}/{x}/{y}.pbf'));
      var splitString = '/postgis/';
      var splitPosition = fieldsInfo.indexOf(splitString);
      fieldsInfo =
        fieldsInfo.substr(0, splitPosition) +
        '/tables/' +
        fieldsInfo.substr(splitPosition + splitString.length);

      promise = $.getJSON(fieldsInfo + '?format=geojson', function (data) {
        var extraFields = '';
        if (data.columns) {
          for (var i = 0; i < data.columns.length; i++) {
            var column = data.columns[i];
            var escaped_column_name = encodeURIComponent(column.column_name);
            if (
              column.column_name !== 'ogc_fid' &&
              ALLOWED_COLUMN_TYPES.indexOf(column.data_type) >= 0
            ) {
              extraFields += ',"' + escaped_column_name + '"';
            }
          }
        }

        createLayer(extraFields);
      });
    }
    return promise;
  }

  function getData(options) {
    //call DataProxy to get data for resource

    /**
     * List of shape info for each geopreviewable resource
     * @type {[{resource_name: string, url: string, bounding_box: string, layer_fields: Array, layer_id: string}]}
     */
    var NOT_ALLOWED_PROPERTIES = ['ogc_fid', '__geometryDimension', 'srid'];
    var data = JSON.parse($('#shapeData').text());
    var layers = [];

    var info = L.control({ position: 'topleft' });

    info.onAdd = function (map) {
      this._div = L.DomUtil.create('div', 'map-info'); // create a div with a class "info"
      return this._div;
    };

    // method that we will use to update the control based on feature properties passed
    info.update = function (props) {
      var innerData = '';
      if (props) {
        for (var key in props) {
          if (!NOT_ALLOWED_PROPERTIES.includes(key)) {
            var value = props[key];
            innerData +=
              '<tr><td style="text-align: right;">' +
              key +
              '</td><td>&nbsp;&nbsp; <b>' +
              value +
              '</b><td></tr>';
          }
        }
      }
      this._div.innerHTML =
        '<h4>' +
        'Shape info' +
        '</h4>' +
        (props ? '<table>' + innerData + '</table>' : 'Click on a shape');
    };
    info.showOtherMessage = function (message) {
      this._div.innerHTML = message;
    };
    info.addTo(options.map);
    info.update();

    var promises = [];
    var firstAdded = false;
    for (var idx = 0; idx < data.length; idx++) {
      var promise = getFieldListAndBuildLayer(
        data[idx],
        info,
        firstAdded,
        options,
        layers,
        data[idx].resource_name
      );
      if (!firstAdded) {
        firstAdded = true;
      }
      if (promise) promises.push(promise);
    }

    $.when.apply($, promises).done(function (sources) {
      L.control.layers([], layers).addTo(options.map);
      options.map.on('overlayadd', function (e) {
        e.layer.myFitBounds();
      });
    });

    $('.map-info').mousedown(function (event) {
      event.stopPropagation();
    });
  }

  function buildMap(options) {
    let map = L.map('map', { attributionControl: false });
    setHDXBaseMap(map, 16);
    options.map = map;
    getData(options);
  }

  $(document).ready(function () {
    buildMap(options);
  });
})();
