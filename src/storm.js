import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { createVtkLayer } from './vtkLayer.js';
import { createStormScene } from './stormScene.js';
import { createStormSlice } from './stormSlice.js';
import { createControls } from './controls.js';
import './style.css';
import './storm.css';

maplibregl.setWorkerUrl(mapWorkerUrl);
const status = document.querySelector('#status');
const blankStyle = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5edef' } }] };

async function getBasemap() {
  if (new URLSearchParams(location.search).get('basemap') === 'blank') return blankStyle;
  try {
    const response = await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Basemap unavailable');
    return await response.json();
  } catch {
    document.querySelector('#map-status').textContent = 'Basemap unavailable. The radar volume remains interactive.';
    return blankStyle;
  }
}

async function loadVolume() {
  const response = await fetch('./metadata.json');
  if (!response.ok) throw new Error('Radar metadata unavailable');
  const metadata = await response.json();
  const data = await fetch(`./${metadata.dataFile}`);
  if (!data.ok) throw new Error('Radar volume unavailable');
  const values = new Uint8Array(await data.arrayBuffer());
  if (values.length !== metadata.dimensions.reduce((total, dimension) => total * dimension, 1)) throw new Error('Incomplete radar volume');
  const imageData = vtkImageData.newInstance({ origin: metadata.origin, spacing: metadata.spacing });
  imageData.setDimensions(...metadata.dimensions);
  imageData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Reflectivity', values }));
  return { imageData, metadata };
}

try {
  const [style, { imageData, metadata }] = await Promise.all([getBasemap(), loadVolume()]);
  const mobile = matchMedia('(max-width: 700px)').matches;
  const origin = maplibregl.MercatorCoordinate.fromLngLat(metadata.mapOrigin);
  const map = new maplibregl.Map({
    container: 'map', style, center: metadata.mapOrigin, zoom: 9,
    pitch: 58, bearing: -22, maxPitch: 75, minZoom: 7, maxZoom: 13,
    renderWorldCopies: false, canvasContextAttributes: { antialias: true },
  });
  const camera = map.cameraForBounds(metadata.coordinates.bounds, {
    padding: mobile ? { top: 380, bottom: 30, left: 20, right: 20 } : { top: 80, bottom: 50, left: 320, right: 60 },
    bearing: -22,
  });
  const initialCamera = { ...camera, pitch: 58, bearing: -22 };
  map.jumpTo(initialCamera);
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right');
  map.on('error', () => { document.querySelector('#map-status').textContent = 'Some map tiles could not load.'; });
  const sliceView = createStormSlice(document.querySelector('#slice'), imageData, metadata);
  document.querySelector('#scan-time').textContent = `${metadata.radar} · ${metadata.start.slice(11, 16)}–${metadata.end.slice(11, 16)} UTC`;
  const south = metadata.origin[1] / 1000;
  const north = (metadata.origin[1] + (metadata.dimensions[1] - 1) * metadata.spacing[1]) / 1000;
  const parameters = { cut: Math.round(south + (north - south) * 0.35), reset: () => map.jumpTo(initialCamera) };
  const gui = createControls(document.querySelector('#controls'));
  const cut = gui.add(parameters, 'cut', Math.round(south), Math.round(north), 1).name('Cut position').onChange(updateSlice).disable();
  gui.add(parameters, 'reset').name('Reset view');
  let scene;
  function updateSlice() {
    const kilometers = parameters.cut;
    const index = Math.round((kilometers * 1000 - metadata.origin[1]) / metadata.spacing[1]);
    scene?.setSlice(index);
    sliceView.setSlice(index);
    document.querySelector('#cut-value').textContent = kilometers === 0 ? '0 km' : `${Math.abs(kilometers)} km ${kilometers < 0 ? 'S' : 'N'}`;
    map.triggerRepaint();
  }
  map.once('style.load', () => {
    map.setProjection({ type: 'mercator' });
    map.addLayer(createVtkLayer({
      origin,
      volumeRendering: true,
      createScene: (renderer) => createStormScene(renderer, imageData, metadata),
      onReady(value) { scene = value; updateSlice(); cut.enable(); },
      onRendered() { status.textContent = ''; document.body.dataset.ready = 'true'; },
    }));
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    gui.destroy();
    map.remove();
    sliceView.delete();
    imageData.getPointData().getScalars().delete();
    imageData.delete();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) { map.resize(); sliceView.resize(); }
  });
} catch (error) {
  status.textContent = `${error.message}. Reload to try again.`;
}
