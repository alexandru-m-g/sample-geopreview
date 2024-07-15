(function () {
  var ALLOWED_COLUMN_TYPES = ['character varying', 'integer', 'numeric'];
  var NOT_ALLOWED_PROPERTIES = ['ogc_fid', '__geometryDimension', 'srid'];

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
    type: 'fill',
    paint: {
      'fill-color': 'hsl(4, 100%, 62%)',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'fill-outline-color': 'hsl(4, 100%, 31%)',
    },
  };
  var defaultLineStyle = {
    type: 'line',
    paint: {
      'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 6, 3],
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'line-color': 'hsl(4, 100%, 62%)',
    },
  };
  var defaultPointStyle = {
    type: 'circle',
    paint: {
      'circle-color': 'hsl(4, 100%, 62%)',
      'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 8],
    },
  };

  class CustomControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'map-info maplibregl-ctrl';
      this._container.textContent = 'Hello, world';
      return this._container;
    }
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
    update(props) {
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
      this._container.innerHTML =
        '<h4>' +
        'Shape info' +
        '</h4>' +
        (props ? '<table>' + innerData + '</table>' : 'Click on a shape');
    }
    showOtherMessage(message) {
      this._container.innerHTML = message;
    }
  }

  function getLayerStyling(geomType) {
    if ([1, 'Point', 'MultiPoint'].includes(geomType)) return defaultPointStyle;
    else if ([2, 'LineString', 'MultiLineString'].includes(geomType)) return defaultLineStyle;
    else return defaultStyle;
  }

  function getFieldListAndBuildLayer(layerData, info, firstAdded, options, layers) {
    var value = layerData.url;

    var bboxArray = layerData.bounding_box.replace('BOX(', '').replace(')', '').split(',');
    var xmin = bboxArray[0].split(' ')[0];
    var ymin = bboxArray[0].split(' ')[1];
    var xmax = bboxArray[1].split(' ')[0];
    var ymax = bboxArray[1].split(' ')[1];
    var bounds = [
      [xmin, ymin],
      [xmax, ymax],
    ];

    function createLayer(extraFields) {
      let map = options.map;
      map.addSource(layerData.layer_id, {
        type: 'vector',
        promoteId: 'ogc_fid',
        tiles: [location.origin + value + '?geom=wkb_geometry&fields=ogc_fid' + extraFields],
      });
      map.addLayer({
        id: layerData.layer_id,
        source: layerData.layer_id,
        'source-layer': layerData.layer_id,
        ...getLayerStyling(layerData.layer_geom_type),
      });

      let featureId;

      function onMouseMove(e) {
        if (e.features.length > 0) {
          map.getCanvas().style.cursor = 'pointer';
          if (featureId) {
            map.setFeatureState(
              { source: layerData.layer_id, sourceLayer: layerData.layer_id, id: featureId },
              { hover: false }
            );
          }
          featureId = e.features[0].id;
          info.update(e.features[0].properties);
          map.setFeatureState(
            { source: layerData.layer_id, sourceLayer: layerData.layer_id, id: featureId },
            { hover: true }
          );
        }
      }

      function onMouseLeave() {
        if (featureId) {
          map.getCanvas().style.cursor = '';
          map.setFeatureState(
            { source: layerData.layer_id, sourceLayer: layerData.layer_id, id: featureId },
            { hover: false }
          );
        }
        featureId = undefined;
        info.update();
      }
      map.on('mousemove', layerData.layer_id, onMouseMove);
      map.on('mouseleave', layerData.layer_id, onMouseLeave);

      if (!firstAdded) {
        options.map.fitBounds(bounds);
        firstAdded = true;
      }
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
    var data = JSON.parse($('#shapeData').text());
    var layers = [];

    var info = new CustomControl();
    options.map.addControl(info, 'top-left');
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

    // $.when.apply($, promises).done(function (sources) {
    //   L.control.layers([], layers).addTo(options.map);
    //   options.map.on("overlayadd", function (e) {
    //     e.layer.myFitBounds();
    //   });
    // });

    $('.map-info').mousedown(function (event) {
      event.stopPropagation();
    });
  }

  function initMap() {
    let map = options.map;
    map.addControl(new maplibregl.AttributionControl({}), 'top-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.scrollZoom.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disableRotation();
    map.addSource('baselayer', {
      type: 'raster',
      attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Mapbox</a>',
      tiles: [$('#mapbox-baselayer-url-div').text()],
      minzoom: 0,
      maxzoom: 12,
      tileSize: 256,
    });
    map.addLayer({
      id: 'baselayer',
      source: 'baselayer',
      type: 'raster',
    });
    getData(options);
  }

  function buildMap(options) {
    options.map = new maplibregl.Map({
      container: 'map',
      attributionControl: false,
    });
    initMap();
  }

  $(document).ready(function () {
    buildMap(options);
  });
})();
