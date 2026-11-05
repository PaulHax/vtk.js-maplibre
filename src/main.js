import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { createVtkLayer } from './vtkLayer.js';
import { loadBikes } from './data.js';
import { createBikeScene, bikeAltitude } from './scene.js';
import { createControls } from './controls.js';
import './style.css';

maplibregl.setWorkerUrl(mapWorkerUrl);
const mobile = matchMedia('(max-width: 700px)').matches;
const initialCamera = { center: [-73.987, 40.729], zoom: mobile ? 13.4 : 13.8, pitch: 48, bearing: -22 };
const status = document.querySelector('#status');
const updated = document.querySelector('#updated');
const tooltip = document.querySelector('#tooltip');
const blankStyle = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5edef' } }] };
let map;
let current;
let scene;
let timer;
let pending = false;
let controller;
let stopped = false;
let pinned = false;
let lastAttempt = 0;
const gui = createControls(document.querySelector('#controls'));
const refresh = gui.add({ refresh: refreshData }, 'refresh').name('Refresh');
gui.add({ reset: () => map?.jumpTo(initialCamera) }, 'reset').name('Reset view');
const formatTime = (value) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const showUpdate = () => {
  if (!current) return;
  const stale = Date.now() - current.updatedAt > 5 * 60_000;
  updated.textContent = `${stale ? 'Older feed' : 'Feed updated'} ${formatTime(current.updatedAt)}`;
  updated.dateTime = new Date(current.updatedAt).toISOString();
};
async function refreshData() {
  if (pending || stopped) return;
  clearTimeout(timer);
  pending = true;
  lastAttempt = Date.now();
  refresh.disable();
  controller = new AbortController();
  try {
    const result = await loadBikes({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    if (stopped) return;
    current = result;
    pinned = false;
    tooltip.hidden = true;
    scene?.setData(current.items);
    map?.triggerRepaint();
    document.querySelector('#count').textContent = `${current.items.length.toLocaleString()} stations`;
    status.textContent = current.items.length ? '' : 'No observations in the current feed.';
    showUpdate();
  } catch {
    if (stopped) return;
    showUpdate();
    if (!current) document.querySelector('#count').textContent = 'Unavailable';
    status.textContent = current ? 'Refresh failed. Showing the last received data.' : 'Live feed unavailable. Try refreshing.';
  } finally {
    pending = false;
    refresh.enable();
    if (!stopped && !document.hidden) timer = setTimeout(refreshData, Math.max(60_000, current?.refreshAfter ?? 60_000));
  }
}
const firstLoad = refreshData();
let style = blankStyle;
if (new URLSearchParams(location.search).get('basemap') !== 'blank') {
  try {
    const response = await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Basemap unavailable');
    style = await response.json();
  } catch {
    document.querySelector('#map-status').textContent = 'Basemap unavailable. Data markers remain interactive.';
  }
}
map = new maplibregl.Map({
  container: 'map', style, ...initialCamera,
  padding: mobile ? { top: 190, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: 0, left: 230, right: 0 },
  maxPitch: 70, minZoom: 10, maxZoom: 18,
  renderWorldCopies: false, canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right');
map.on('error', () => { document.querySelector('#map-status').textContent = 'Some map tiles could not load.'; });
const layer = createVtkLayer({
  origin: maplibregl.MercatorCoordinate.fromLngLat([0, 0]),
  createScene: createBikeScene,
  onReady(value) {
    scene = value;
    if (current) scene.setData(current.items);
  },
  onRendered() { document.body.dataset.ready = 'true'; },
});
map.once('style.load', () => {
  map.setProjection({ type: 'mercator' });
  map.addLayer(layer);
});
function nearest(point) {
  let result;
  let distance = 25;
  for (const item of current?.items ?? []) {
    const mercator = maplibregl.MercatorCoordinate.fromLngLat([item.longitude, item.latitude], bikeAltitude(item));
    const projected = layer.projectMercator(mercator);
    if (!projected) continue;
    const next = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (next < distance) { distance = next; result = item; }
  }
  return result;
}
function showDetails(item, point) {
  tooltip.replaceChildren();
  if (!item) { tooltip.hidden = true; return; }
  const title = document.createElement('strong');
  title.textContent = item.name;
  const values = document.createElement('p');
  values.textContent = `${item.bikes} bikes · ${item.docks} empty docks`;
  const timestamp = document.createElement('p');
  timestamp.textContent = `Station reported ${formatTime(item.reportedAt)}`;
  tooltip.append(title, values, timestamp);
  if (pinned) {
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => { pinned = false; tooltip.hidden = true; });
    tooltip.append(close);
  }
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8, Math.min(point.x + 16, innerWidth - 280))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(point.y + 16, innerHeight - tooltip.offsetHeight - 12))}px`;
}
map.on('mousemove', ({ point }) => {
  if (pinned) return;
  const item = nearest(point);
  map.getCanvas().style.cursor = item ? 'pointer' : '';
  showDetails(item, point);
});
map.on('click', ({ point }) => {
  const item = nearest(point);
  pinned = Boolean(item);
  showDetails(item, point);
});
map.on('movestart', () => { pinned = false; tooltip.hidden = true; });
map.getCanvas().addEventListener('mouseleave', () => { if (!pinned) tooltip.hidden = true; });
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden && !pending) {
    const remaining = Math.max(0, (current?.refreshAfter ?? 60_000) - (Date.now() - lastAttempt));
    timer = setTimeout(refreshData, remaining);
  }
});
window.addEventListener('pagehide', (event) => {
  clearTimeout(timer);
  if (event.persisted) return;
  stopped = true;
  controller?.abort();
  gui.destroy();
  map.remove();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  map.resize();
  refreshData();
});
await firstLoad;
