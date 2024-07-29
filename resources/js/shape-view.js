(function () {
  const ALLOWED_COLUMN_TYPES = ['character varying', 'integer', 'numeric'];
  const NOT_ALLOWED_PROPERTIES = ['ogc_fid', '__geometryDimension', 'srid'];

  let info;

  const options = {
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

  const defaultStyle = {
    type: 'fill',
    paint: {
      'fill-color': 'hsl(4, 100%, 62%)',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'fill-outline-color': 'hsl(4, 100%, 31%)',
    },
  };
  const defaultLineStyle = {
    type: 'line',
    paint: {
      'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 6, 3],
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'line-color': 'hsl(4, 100%, 62%)',
    },
  };
  const defaultPointStyle = {
    type: 'circle',
    paint: {
      'circle-color': 'hsl(4, 100%, 62%)',
      'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.6],
      'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 8],
    },
  };

  class InfoControl {
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
      let innerData = '';
      if (props) {
        for (const key in props) {
          if (!NOT_ALLOWED_PROPERTIES.includes(key)) {
            const value = props[key];
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

  class LayersControl {
    constructor(ctrls) {
      this._container = document.createElement('div');
      this._container.classList.add('maplibregl-ctrl', 'maplibregl-ctrl-group', 'layers-control');
      this._ctrls = ctrls;
      this._inputs = [];
      const hover = document.createElement('a');
      hover.classList.add('layers-control-toggle');
      hover.href = '#';
      const list = document.createElement('div');
      list.classList.add('layers-control-list');
      this._container.appendChild(hover);
      this._container.appendChild(list);
      for (const [key, [value, bounds]] of Object.entries(this._ctrls)) {
        const labeled_checkbox = this._createLabeledCheckbox(key, value, bounds);
        list.appendChild(labeled_checkbox);
      }
    }

    _createLabeledCheckbox(key, value, bounds) {
      const label = document.createElement('label');
      label.classList.add('layer-control');
      const text = document.createTextNode(key);
      const input = document.createElement('input');
      this._inputs.push(input);
      input.type = 'checkbox';
      input.id = key;
      input.value = value;
      input.bounds = bounds;
      input.addEventListener('change', (e) => {
        const layer = e.target.value;
        const visibility = e.target.checked ? 'visible' : 'none';
        this._map.setLayoutProperty(layer, 'visibility', visibility);
        if (e.target.checked) this._map.fitBounds(e.target.bounds);
      });
      label.appendChild(input);
      label.appendChild(text);
      return label;
    }

    onAdd(map) {
      this._map = map;
      for (const input of this._inputs) {
        const layername = this._ctrls[input.id][0];
        let isVisible = true;
        isVisible = isVisible && this._map.getLayoutProperty(layername, 'visibility') !== 'none';
        input.checked = isVisible;
      }
      return this._container;
    }

    onRemove(map) {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }

  function getLayerStyling(geomType) {
    const geomTypeUpper = geomType.toUpperCase();
    if (['POINT', 'MULTIPOINT', 'ST_POINT', 'ST_MULTIPOINT'].includes(geomTypeUpper)) {
      return defaultPointStyle;
    } else if (
      ['LINESTRING', 'MULTILINESTRING', 'ST_LINESTRING', 'ST_MULTILINESTRING'].includes(
        geomTypeUpper
      )
    ) {
      return defaultLineStyle;
    } else return defaultStyle;
  }

  function getBounds(BBOX) {
    const bboxArray = BBOX.replace('BOX(', '').replace(')', '').split(',');
    const xmin = Number(bboxArray[0].split(' ')[0]);
    const ymin = Number(bboxArray[0].split(' ')[1]);
    const xmax = Number(bboxArray[1].split(' ')[0]);
    const ymax = Number(bboxArray[1].split(' ')[1]);
    const bounds = [
      [xmin, ymin],
      [xmax, ymax],
    ];
    return bounds;
  }

  async function getFieldListAndBuildLayer(layerData, info, firstAdded, options, layers) {
    const value = layerData.url;
    const tilesURL = location.origin + value + '?geom=wkb_geometry&fields=ogc_fid';
    const bounds = getBounds(layerData.bounding_box);
    const res = await fetch(`/gis/layer-type/${layerData.layer_id}`);
    let geomType;
    if (res.ok) {
      const resJSON = await res.json();
      geomType = resJSON.result;
    } else {
      const tile0 = tilesURL.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
      const r = await fetch(tile0);
      const buffer = await r.arrayBuffer();
      const tileLayer = new VectorTile(new Pbf(buffer)).layers[layerData.layer_id];
      geomType = tileLayer
        ? tileLayer.feature(0).toGeoJSON(0, 0, 0).geometry.type
        : 'ST_MultiPolygon';
    }

    function createLayer(extraFields) {
      const map = options.map;
      map.addSource(layerData.layer_id, {
        type: 'vector',
        promoteId: 'ogc_fid',
        tiles: [tilesURL + extraFields],
      });
      map.addLayer({
        id: layerData.layer_id,
        source: layerData.layer_id,
        'source-layer': layerData.layer_id,
        ...getLayerStyling(geomType),
      });
      const visibility = firstAdded ? 'visible' : 'none';
      map.setLayoutProperty(layerData.layer_id, 'visibility', visibility);

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

      if (firstAdded) options.map.fitBounds(bounds, { animate: false });
    }

    const promise = null;
    const layer_fields = layerData.layer_fields;
    if (layer_fields && layer_fields.length > 0) {
      // New way in which the fields are stored in 'shape_info' in CKAN

      let extraFields = '';
      for (let i = 0; i < layer_fields.length; i++) {
        const field = layer_fields[i];
        if (field.field_name !== 'ogc_fid' && ALLOWED_COLUMN_TYPES.indexOf(field.data_type) >= 0) {
          const escaped_field_name = encodeURIComponent(field.field_name);
          extraFields += ',"' + escaped_field_name + '"';
        }
      }
      createLayer(extraFields);
    } else {
      // Still supporting the old way for backwards compatibility - fetching fields from spatial server

      const fieldsInfo = value.substr(
        0,
        value.indexOf('/wkb_geometry/vector-tiles/{z}/{x}/{y}.pbf')
      );
      const splitString = '/postgis/';
      const splitPosition = fieldsInfo.indexOf(splitString);
      fieldsInfo =
        fieldsInfo.substr(0, splitPosition) +
        '/tables/' +
        fieldsInfo.substr(splitPosition + splitString.length);

      promise = $.getJSON(fieldsInfo + '?format=geojson', function (data) {
        let extraFields = '';
        if (data.columns) {
          for (let i = 0; i < data.columns.length; i++) {
            const column = data.columns[i];
            const escaped_column_name = encodeURIComponent(column.column_name);
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

  async function getData(options) {
    //call DataProxy to get data for resource

    /**
     * List of shape info for each geopreviewable resource
     * @type {[{resource_name: string, url: string, bounding_box: string, layer_fields: Array, layer_id: string}]}
     */
    const data = options.data;
    const layers = [];

    info = new InfoControl();
    options.map.addControl(info, 'top-left');
    info.update();

    const promises = [];
    let firstAdded = true;
    for (let idx = 0; idx < data.length; idx++) {
      const promise = await getFieldListAndBuildLayer(
        data[idx],
        info,
        firstAdded,
        options,
        layers,
        data[idx].resource_name
      );
      if (firstAdded) {
        firstAdded = false;
      }
      if (promise) promises.push(promise);
    }

    $.when.apply($, promises).done(() => {
      layerConfig = {};
      for (const row of data) {
        layerConfig[row.resource_name] = [row.layer_id, getBounds(row.bounding_box)];
      }
      options.map.addControl(new LayersControl(layerConfig), 'top-right');
    });

    $('.map-info').mousedown(function (event) {
      event.stopPropagation();
    });
  }

  function initMap() {
    const map = options.map;
    map.addControl(new maplibregl.AttributionControl({}), 'top-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.dragRotate.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disableRotation();
    getData(options);
  }

  function isMapboxURL(url) {
    return url.indexOf('mapbox:') === 0;
  }
  function transformMapboxUrl(url, resourceType, accessToken) {
    if (url.indexOf('/styles/') > -1 && url.indexOf('/sprite') === -1)
      return { url: normalizeStyleURL(url, accessToken) };
    if (url.indexOf('/sprites/') > -1)
      return { url: normalizeSpriteURL(url, '', '.json', accessToken) };
    if (url.indexOf('/fonts/') > -1) return { url: normalizeGlyphsURL(url, accessToken) };
    if (url.indexOf('/v4/') > -1) return { url: normalizeSourceURL(url, accessToken) };
    if (resourceType === 'Source') return { url: normalizeSourceURL(url, accessToken) };
  }
  function parseUrl(url) {
    const urlRe = /^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/;
    const parts = url.match(urlRe);
    if (!parts) {
      throw new Error('Unable to parse URL object');
    }
    return {
      protocol: parts[1],
      authority: parts[2],
      path: parts[3] || '/',
      params: parts[4] ? parts[4].split('&') : [],
    };
  }
  function formatUrl(urlObject, accessToken) {
    const apiUrlObject = parseUrl('https://api.mapbox.com');
    urlObject.protocol = apiUrlObject.protocol;
    urlObject.authority = apiUrlObject.authority;
    urlObject.params.push(`access_token=${accessToken}`);
    const params = urlObject.params.length ? `?${urlObject.params.join('&')}` : '';
    return `${urlObject.protocol}://${urlObject.authority}${urlObject.path}${params}`;
  }
  function normalizeStyleURL(url, accessToken) {
    const urlObject = parseUrl(url);
    urlObject.path = `/styles/v1${urlObject.path}`;
    return formatUrl(urlObject, accessToken);
  }
  function normalizeGlyphsURL(url, accessToken) {
    const urlObject = parseUrl(url);
    urlObject.path = `/fonts/v1${urlObject.path}`;
    return formatUrl(urlObject, accessToken);
  }
  function normalizeSourceURL(url, accessToken) {
    const urlObject = parseUrl(url);
    urlObject.path = `/v4/${urlObject.authority}.json`;
    urlObject.params.push('secure');
    return formatUrl(urlObject, accessToken);
  }
  function normalizeSpriteURL(url, format, extension, accessToken) {
    const urlObject = parseUrl(url);
    const path = urlObject.path.split('.');
    urlObject.path = `/styles/v1${path[0]}/sprite.${path[1]}`;
    return formatUrl(urlObject, accessToken);
  }

  function buildMap(options) {
    const mapboxKey =
      'pk.eyJ1IjoiaHVtZGF0YSIsImEiOiJja2FvMW1wbDIwMzE2MnFwMW9teHQxOXhpIn0.Uri8IURftz3Jv5It51ISAA';
    function transformRequest(url, resourceType) {
      if (isMapboxURL(url)) return transformMapboxUrl(url, resourceType, mapboxKey);
      return { url };
    }

    options.data = JSON.parse($('#shapeData').text());
    options.map = new maplibregl.Map({
      container: 'map',
      attributionControl: false,
      cooperativeGestures: true,
      style: '/mapbox/styles/v1/humdata/cl3lpk27k001k15msafr9714b?access_token=cacheToken',
      transformRequest,
      bounds: getBounds(options.data[0].bounding_box),
    });
    options.map.once('load', initMap);
  }

  $(document).ready(function () {
    buildMap(options);
  });
})();
