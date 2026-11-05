# VTK.js + MapLibre

Two examples combine VTK.js visualization with a MapLibre map. MapLibre owns
the map camera and navigation; VTK.js renders an archived radar volume or live
bike availability columns on the same WebGL2 canvas. The storm's linked image
slice uses a separate small canvas.

| Example | Data | Display |
| --- | --- | --- |
| [Storm cross-section](https://PaulHax.github.io/vtk.js-maplibre/storm/) | Archived NOAA/NWS KTLX radar scan from May 20, 2013 | A volume and linked vertical slice show radar reflectivity; one slider moves the cut. |
| [NYC bike availability](https://PaulHax.github.io/vtk.js-maplibre/bikes/) | Current Citi Bike station reports | Column height shows available bikes; color shows bikes as a fraction of station capacity. |

In the storm example, move **Cut position** from south to north to clip the
volume and inspect the matching slice. In the bike example, hover or tap near
a column's center for station values and timestamp. Pan, zoom, right-drag to
tilt, or use **Reset view**. Follow **See bikes example** or **See storm example**
to switch pages. The expandable **Developer notes** panel explains the
integration.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open the address printed by Vite to reach the storm example at `/storm/`.
The bike example is at `/bikes/`. Both pages share integration code. There is
no application framework or backend.

```sh
npm run build
npm run preview
```

The production files are written to `dist/`. Relative assets support hosting
under a repository path. The included workflow deploys `main` when the
repository's Pages source is set to GitHub Actions.

## Data and visual encodings

The storm page loads a prepared static volume bundled with the site.
[src/data.js](src/data.js) loads Citi Bike reports directly in the browser
without configured API keys. It uses versioned feed URLs and validates records
before passing them to [src/scene.js](src/scene.js).

- **Storm:** the [original KTLX Level II scan](https://unidata-nexrad-level2.s3.amazonaws.com/2013/05/20/KTLX/KTLX20130520_201643_V06.gz)
  was acquired near Oklahoma City from 20:16:43 to 20:20:50 UTC on May 20,
  2013. NOAA/NWS supplied the observations, archived by NSF Unidata. This is
  a historical scan acquired over about four minutes. Py-ART interpolates
  reflectivity in dBZ onto a 128×128×48 local Mercator grid covering 80×80 km
  and altitudes from 0 to 15 km above mean sea level. The browser downloads
  [reflectivity.bin](public/storm/reflectivity.bin), an uncompressed 786,432-byte
  image with no client decompression step. For nonzero bytes,
  `dBZ = byte × 0.5 − 32.5`; zero marks missing coverage. Levels below the
  radar's 388 m altitude are also masked. This is a conservative altitude
  floor, not a terrain mask. Height is exaggerated three times in both views.
  Reflectivity below 20 dBZ is transparent in the 3D volume; the slice also
  shows weaker echoes. Missing coverage means unknown, not clear air.
  [Metadata](public/storm/metadata.json) records the source checksum,
  projection, grid spacing, encoding, and interpolation settings.
- **Bikes:** the [Citi Bike GBFS 2.3 directory](https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json)
  provides the current `station_information` and `station_status` URLs. The
  loader joins them by station ID, selects the NYC and Bronx regions, and
  includes stations that are installed and accepting rentals and returns.
  Reports more than 15 minutes older than the feed timestamp are omitted.
  Columns have a 12-meter radius and use 4 meters of height per available bike;
  zero bikes produce a 1-meter disc. Color runs from orange at 0% availability
  to teal at 100%, using station capacity or bikes plus empty docks when
  capacity is unavailable. Automatic refreshes are at least 60 seconds apart,
  respecting a longer feed TTL; station information is cached for an hour.
  Data is provided by [Citi Bike](https://citibikenyc.com/system-data), subject
  to its [Data Sharing Policy](https://citibikenyc.com/data-sharing-policy).

Bike feed availability and reporting delays depend on the provider. A failed
refresh keeps the last received data and displays an error. The page shows
the feed timestamp and labels feeds older than five minutes.

To reproduce the storm asset, create a Python virtual environment and run:

```sh
python -m pip install arm_pyart==2.1.1 numpy==2.2.6 pyproj==3.7.1
python tools/prepare-storm.py
```

[tools/prepare-storm.py](tools/prepare-storm.py) downloads the exact archived
scan into the system temporary directory, checks its checksum, and writes the
volume and metadata to `public/storm/`. It uses Barnes2 interpolation with a
radius of influence that grows with distance, excluding masked and invalid radar
gates. Interpolation does not make every voxel a direct measurement. No
clutter, terrain, or precipitation-type correction is applied. See
[Helmus and Collis (2016)](https://doi.org/10.5334/jors.119) for Py-ART.

## How the integration works

- [src/vtkLayer.js](src/vtkLayer.js) creates `vtkOpenGLRenderWindow` with
  MapLibre's canvas and `manageCanvas: false`, obtaining its existing WebGL2
  context without taking ownership of canvas resizing.
- MapLibre supplies the camera matrices and schedules frames. Geographic
  coordinates are converted to Web Mercator, with glyph dimensions adjusted
  for latitude. The custom layer sets VTK's view and projection matrices.
- VTK preserves the host color and depth buffers. The layer establishes the
  GL state needed for drawing, clears VTK's shader-binding cache, then returns
  control to MapLibre. The layer draws after the basemap layers and labels.
- [src/storm.js](src/storm.js) loads one `vtkImageData` shared by the volume
  and slice. [src/stormScene.js](src/stormScene.js) uses `vtkVolumeMapper`,
  reflectivity color and opacity functions, and one clipping plane.
  [src/stormSlice.js](src/stormSlice.js) uses `vtkImageMapper` in a separate
  inset view. The slider updates the clipping plane and slice index together.
- [src/scene.js](src/scene.js) uses a cylinder source, a glyph mapper, and one
  actor for bikes. Feed refreshes replace point positions, component scales,
  and direct RGB colors. [src/main.js](src/main.js) handles bike refresh,
  navigation, and tooltips.
- [src/controls.js](src/controls.js) creates a [lil-gui](https://lil-gui.georgealways.com/)
  panel for each example. The storm has a cut-position slider and reset action;
  the bike page has refresh and reset actions.

Dependencies are pinned to published packages: VTK.js 38.0.4, MapLibre GL JS
6.16.0, gl-matrix 3.4.4, and lil-gui 0.21.0.

## Scope

The examples cover a radar volume and opaque bike columns over a flat Web
Mercator basemap. The volume demonstration does not support occlusion by 3D terrain or
extruded map buildings. Globe projection, terrain placement, and additional
transparent map layers need further integration work. Sharing a canvas and
depth buffer does not by itself establish those behaviors.

Bike tooltip selection finds the nearest projected column center within 25 CSS
pixels. It does not intersect the mesh or use full VTK picking. After WebGL
context loss, reload the page. The custom layer establishes the state needed
for these scenes; it is not a general GL-state preservation library.

## Basemap and browser checks

The basemap uses [OpenFreeMap Positron](https://openfreemap.org/). Preserve the
visible OpenMapTiles and OpenStreetMap attribution. Tiles, fonts, and sprites
require network access. Append `?basemap=blank` to any example to skip map
service requests; the storm page still loads its bundled volume, and bike feed
requests still run. An initial style-fetch failure also uses this blank
background.

```sh
npx playwright install chromium
npm test
```

Browser checks use controlled basemaps and mocked bike feeds so assertions do
not depend on changing public data. They inspect screenshots and visible UI
behavior. Live feed availability is separate from these deterministic checks.

## Credits

Canvas ownership support was released through
[Kitware/vtk-js#3555](https://github.com/Kitware/vtk-js/pull/3555), following
integration work in [Kitware/vtk-js#3453](https://github.com/Kitware/vtk-js/pull/3453).
The bike visualization is also inspired by deck.gl's
[ColumnLayer](https://deck.gl/docs/api-reference/layers/column-layer).

The storm contains NOAA/NWS radar data distributed through the
[NEXRAD open-data archive](https://registry.opendata.aws/noaa-nexrad/), with
gridding performed using Py-ART. This visualization is not a NOAA or NWS product.
See the [radar data notice](public/storm/NOTICE.txt) for reuse terms, attribution,
and the dataset citation.

Demo code is BSD-3-Clause. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt).
