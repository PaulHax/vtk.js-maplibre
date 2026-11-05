import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

test.use({ viewport: { width: 1000, height: 800 } });

async function volumePixels(page) {
  const screenshot = await page.locator('#map canvas').screenshot({
    mask: [page.locator('.panel'), page.locator('.maplibregl-ctrl')],
    maskColor: '#e5edef',
  });
  const { data } = PNG.sync.read(screenshot);
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const high = Math.max(data[index], data[index + 1], data[index + 2]);
    const low = Math.min(data[index], data[index + 1], data[index + 2]);
    if (high - low > 60 && high > 70) count += 1;
  }
  return count;
}

function changedPixels(before, after) {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  expect([second.width, second.height]).toEqual([first.width, first.height]);
  let changed = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    const difference = Math.abs(first.data[index] - second.data[index])
      + Math.abs(first.data[index + 1] - second.data[index + 1])
      + Math.abs(first.data[index + 2] - second.data[index + 2]);
    if (difference > 30) changed += 1;
  }
  return changed;
}

async function openStorm(page, path = '/storm/?basemap=blank') {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Storm cross-section' })).toBeVisible();
  await expect(page.locator('#status')).toBeEmpty();
  await expect(page.getByLabel('Cut position', { exact: true })).toBeEnabled();
  await expect(page.locator('canvas')).toHaveCount(2);
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(300);
}

test('the landing page opens the storm and preserves the query and hash', async ({ page }) => {
  await openStorm(page, '/?basemap=blank&source=landing#radar');
  await expect(page).toHaveURL(/\/storm\/\?basemap=blank&source=landing#radar$/);
  await expect(page.getByRole('link', { name: 'See bikes example', exact: true })).toBeVisible();
});

test('the cut updates the radar volume and linked image slice', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStorm(page);
  const cut = page.getByLabel('Cut position', { exact: true });
  await cut.fill('-20');
  await expect(page.locator('#cut-value')).toHaveText('20 km S');
  await cut.fill('2');
  await expect(page.locator('#cut-value')).toHaveText('2 km N');
  await cut.press('ArrowUp');
  await expect(page.locator('#cut-value')).toHaveText('3 km N');
  await cut.press('ArrowDown');
  await expect(page.locator('#cut-value')).toHaveText('2 km N');
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(300);
  const before = await volumePixels(page);
  const sliceBefore = await page.locator('#slice canvas').screenshot();

  await cut.fill('37');
  await expect(page.locator('#cut-value')).toHaveText('37 km N');
  await expect.poll(async () => changedPixels(sliceBefore, await page.locator('#slice canvas').screenshot())).toBeGreaterThan(100);
  await expect.poll(() => volumePixels(page)).toBeLessThan(before);
  await page.screenshot({ path: testInfo.outputPath('storm-cut.png') });

  await cut.fill('60');
  await expect(page.locator('#cut-value')).toHaveText('60 km N');
  await expect.poll(() => volumePixels(page)).toBeLessThan(before * 0.25);

  await cut.fill('2');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(300);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test('the storm volume and controls fit a mobile viewport', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openStorm(page);
  for (const control of [
    page.locator('.panel'),
    page.getByLabel('Cut position', { exact: true }),
    page.locator('#slice'),
    page.getByRole('button', { name: 'Reset view', exact: true }),
    page.locator('.cross-link'),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  }
  await page.screenshot({ path: testInfo.outputPath('storm-mobile.png') });
  expect(errors).toEqual([]);
});
