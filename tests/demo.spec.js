import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const NOW = Date.UTC(2026, 10, 5, 18);
const discoveryURL = 'https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json';
const informationURL = 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json';
const statusURL = 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json';
const blankStyle = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5edef' } }] };

async function mockBikeFeeds(page) {
  const state = { refreshed: false, offline: false, age: 0 };
  await page.clock.setFixedTime(NOW);
  await page.route('https://tiles.openfreemap.org/styles/positron', (route) => route.fulfill({ json: blankStyle }));
  await page.route(discoveryURL, (route) => state.offline ? route.abort('failed') : route.fulfill({ json: {
    version: '2.3', last_updated: NOW / 1000, ttl: 60,
    data: { en: { feeds: [{ name: 'station_information', url: informationURL }, { name: 'station_status', url: statusURL }] } },
  } }));
  await page.route(informationURL, (route) => route.fulfill({ json: {
    version: '2.3', last_updated: NOW / 1000, ttl: 60,
    data: { stations: [
      { station_id: 'sample-station', name: 'Example station', lon: -73.987, lat: 40.729, capacity: 50, region_id: '71' },
      { station_id: 'old-station', name: 'Old station report', lon: -73.987, lat: 40.729, capacity: 50, region_id: '71' },
    ] },
  } }));
  await page.route(statusURL, (route) => state.offline ? route.abort('failed') : route.fulfill({ json: {
    version: '2.3', last_updated: (NOW - state.age) / 1000 + (state.refreshed ? 60 : 0), ttl: 60,
    data: { stations: [
      { station_id: 'sample-station', num_bikes_available: state.refreshed ? 45 : 2,
        num_docks_available: state.refreshed ? 5 : 48, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: (NOW - state.age) / 1000 },
      { station_id: 'old-station', num_bikes_available: 50,
        num_docks_available: 0, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: (NOW - state.age) / 1000 - 16 * 60 },
    ] },
  } }));
  return state;
}

async function renderedGlyph(page) {
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  const screenshot = await canvas.screenshot({
    mask: [page.locator('.panel'), page.locator('.maplibregl-ctrl'), page.locator('#tooltip')],
    maskColor: '#e5edef',
  });
  const { width, height, data } = PNG.sync.read(screenshot);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const high = Math.max(data[offset], data[offset + 1], data[offset + 2]);
      const low = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      if (high - low > 55 && high > 70) {
        count += 1;
        sumX += x;
        sumY += y;
      }
    }
  }
  return {
    count,
    x: bounds.x + sumX / count * bounds.width / width,
    y: bounds.y + sumY / count * bounds.height / height,
  };
}

async function expectRendered(page) {
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect.poll(async () => (await renderedGlyph(page)).count).toBeGreaterThan(20);
}

async function openGlyphDetails(page) {
  const glyph = await renderedGlyph(page);
  await page.mouse.click(glyph.x, glyph.y);
  await expect(page.locator('#tooltip')).toBeVisible();
}

test('bike refresh changes visible geometry and failed refresh retains it', async ({ page }) => {
  const state = await mockBikeFeeds(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/bikes/?basemap=blank');
  await expect(page.getByRole('heading', { name: 'NYC bike availability' })).toBeVisible();
  await expect(page.locator('#count')).toHaveText('1 stations');
  await expectRendered(page);
  await openGlyphDetails(page);
  await expect(page.locator('#tooltip')).toContainText('2 bikes');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const before = await renderedGlyph(page);

  state.refreshed = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#updated')).toHaveAttribute('datetime', new Date(NOW + 60_000).toISOString());
  await expect.poll(async () => (await renderedGlyph(page)).count).toBeGreaterThan(before.count * 2);
  await openGlyphDetails(page);
  await expect(page.locator('#tooltip')).toContainText('45 bikes');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const refreshed = await renderedGlyph(page);

  state.offline = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Refresh failed. Showing the last received data.');
  await expect(page.locator('#count')).toHaveText('1 stations');
  await expect(page.locator('#updated')).toHaveAttribute('datetime', new Date(NOW + 60_000).toISOString());
  await expect.poll(async () => (await renderedGlyph(page)).count).toBe(refreshed.count);
  await openGlyphDetails(page);
  await expect(page.locator('#tooltip')).toContainText('45 bikes');
  expect(errors).toEqual([]);
});

test('initial feed failure recovers and a dated feed remains visibly labeled', async ({ page }) => {
  const state = await mockBikeFeeds(page);
  state.offline = true;
  state.age = 20 * 60_000;
  await page.goto('/bikes/?basemap=blank');
  await expect(page.locator('#status')).toHaveText('Live feed unavailable. Try refreshing.');
  await expect.poll(async () => (await renderedGlyph(page)).count).toBe(0);
  state.offline = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#count')).toHaveText('1 stations');
  await expect(page.locator('#updated')).toContainText('Older feed');
  await expect(page.locator('#status')).toBeEmpty();
  await expectRendered(page);
});

test('bike controls fit mobile and both examples link to each other', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockBikeFeeds(page);
  state.refreshed = true;
  await page.goto('/bikes/?basemap=blank');
  await expect(page.getByRole('heading', { name: 'NYC bike availability' })).toBeVisible();
  await expectRendered(page);
  for (const control of [
    page.locator('.panel'),
    page.getByRole('button', { name: 'Refresh', exact: true }),
    page.getByRole('button', { name: 'Reset view', exact: true }),
    page.locator('.cross-link'),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  }
  await page.getByText('Developer notes', { exact: true }).click();
  await expect(page.getByText('One shared WebGL canvas, using', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'See storm example', exact: true }).click();
  await expect(page).toHaveURL(/\/storm\/$/);
  await expect(page.getByRole('heading', { name: 'Storm cross-section' })).toBeVisible();
  await expect(page.locator('#status')).toBeEmpty();
  await expect(page.getByLabel('Cut position', { exact: true })).toBeEnabled();
  await expect(page.locator('canvas')).toHaveCount(2);
  await page.getByRole('link', { name: 'See bikes example', exact: true }).click();
  await expect(page).toHaveURL(/\/bikes\/$/);
  await expect(page.getByRole('heading', { name: 'NYC bike availability' })).toBeVisible();
  await expectRendered(page);
});

test('live geometry renders while basemap tiles are still loading', async ({ page }) => {
  await mockBikeFeeds(page);
  let releaseTiles;
  const tilesReady = new Promise((resolve) => { releaseTiles = resolve; });
  const responses = [];
  const tile = new PNG({ width: 256, height: 256 });
  tile.data.fill(255);
  const image = PNG.sync.write(tile);
  await page.route('https://tiles.openfreemap.org/styles/positron', (route) => route.fulfill({ json: {
    ...blankStyle,
    sources: { basemap: { type: 'raster', tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'], tileSize: 256 } },
    layers: [...blankStyle.layers, { id: 'basemap', type: 'raster', source: 'basemap' }],
  } }));
  await page.route('https://tiles.example.test/**', async (route) => {
    const response = tilesReady.then(() => route.fulfill({ contentType: 'image/png', body: image }));
    responses.push(response);
    await response;
  });
  try {
    const requested = page.waitForRequest('https://tiles.example.test/**');
    await page.goto('/bikes/');
    await requested;
    await expect(page.locator('#count')).toHaveText('1 stations');
    await expectRendered(page);
  } finally {
    releaseTiles();
    await Promise.all(responses);
  }
});
