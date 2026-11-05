#!/usr/bin/env python3
"""Prepare the archived KTLX scan with arm_pyart==2.1.1, numpy==2.2.6, pyproj==3.7.1."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import tempfile
from urllib.request import urlretrieve

import numpy as np
import pyart
from pyproj import Proj, __version__ as pyproj_version

SOURCE_FILE = 'KTLX20130520_201643_V06.gz'
SOURCE_URL = f'https://unidata-nexrad-level2.s3.amazonaws.com/2013/05/20/KTLX/{SOURCE_FILE}'
SOURCE_SHA256 = '772e01b154a5c966982a6d0aa2fc78bc64f08a9b77165b74dc02d7aa5aa69275'
EARTH_RADIUS = 6371008.8
SHAPE = (48, 128, 128)  # z, y, x
LIMITS = ((0, 15000), (-20000, 60000), (-50000, 30000))


def prepare(output, source):
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        urlretrieve(SOURCE_URL, source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source checksum does not match the archived scan.')
    radar = pyart.io.read_nexrad_archive(str(source), include_fields=['reflectivity'])
    latitude = float(radar.latitude['data'][0])
    longitude = float(radar.longitude['data'][0])
    latitude_radians = math.radians(latitude)
    projection = {
        'proj': 'merc', 'R': EARTH_RADIUS, 'lat_ts': latitude, 'lon_0': longitude,
        'x_0': 0,
        'y_0': -EARTH_RADIUS * math.cos(latitude_radians) * math.log(math.tan(math.pi / 4 + latitude_radians / 2)),
        'units': 'm',
    }
    gatefilter = pyart.filters.GateFilter(radar)
    gatefilter.exclude_transition()
    gatefilter.exclude_masked('reflectivity')
    gatefilter.exclude_invalid('reflectivity')
    grid = pyart.map.grid_from_radars(
        (radar,), grid_shape=SHAPE, grid_limits=LIMITS,
        grid_origin=(latitude, longitude), grid_origin_alt=0,
        grid_projection=projection, fields=['reflectivity'], gatefilters=gatefilter,
        weighting_function='Barnes2', roi_func='dist_beam', min_radius=700,
        nb=1.0, bsp=1.0, map_roi=False,
    )
    reflectivity = grid.fields['reflectivity']['data']
    valid = ~np.ma.getmaskarray(reflectivity) & np.isfinite(reflectivity.data)
    valid &= grid.z['data'][:, None, None] >= float(radar.altitude['data'][0])
    encoded = np.zeros(SHAPE, dtype=np.uint8)
    encoded[valid] = 1 + np.rint((np.clip(reflectivity.data[valid], -32, 95) + 32) * 2).astype(np.uint8)
    payload = encoded.tobytes(order='C')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'reflectivity.bin').write_bytes(payload)

    axes = [grid.x['data'], grid.y['data'], grid.z['data']]
    inverse = Proj(projection)
    west, south = inverse(LIMITS[2][0], LIMITS[1][0], inverse=True)
    east, north = inverse(LIMITS[2][1], LIMITS[1][1], inverse=True)
    clock = datetime.fromisoformat(radar.time['units'].split('since ')[1].replace('Z', '+00:00'))
    timestamps = [clock + timedelta(seconds=float(value)) for value in [radar.time['data'][0], radar.time['data'][-1]]]
    iso = lambda value: value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    metadata = {
        'title': 'Oklahoma City radar reflectivity',
        'radar': 'KTLX',
        'timestamp': iso(timestamps[0]), 'start': iso(timestamps[0]), 'end': iso(timestamps[1]),
        'dataFile': 'reflectivity.bin',
        'dimensions': list(reversed(SHAPE)),
        'origin': [float(axis[0]) for axis in axes],
        'spacing': [float(axis[1] - axis[0]) for axis in axes],
        'mapOrigin': [longitude, latitude],
        'source': {
            'url': SOURCE_URL, 'file': SOURCE_FILE, 'sha256': SOURCE_SHA256,
            'provider': 'NOAA/National Weather Service, archived by NSF Unidata',
            'documentation': 'https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar',
            'attribution': 'Contains NOAA/NWS radar data. This visualization is not a NOAA or NWS product.',
        },
        'data': {
            'type': 'Uint8Array', 'order': 'x-fastest, then y, then z',
            'uncompressedBytes': len(payload), 'compression': 'none',
            'sha256': hashlib.sha256(payload).hexdigest(),
        },
        'encoding': {'missing': 0, 'offset': -32.5, 'scale': 0.5, 'formula': 'dBZ = value * 0.5 - 32.5 for value > 0', 'units': 'dBZ'},
        'coordinates': {
            'geographicOrigin': [longitude, latitude],
            'radarAltitudeMeters': float(radar.altitude['data'][0]),
            'projection': projection,
            'description': 'Local spherical Mercator, scaled to meters at radar latitude; x east, y north. z is altitude above mean sea level.',
            'maplibreEarthRadiusMeters': EARTH_RADIUS,
            'bounds': [[west, south], [east, north]],
        },
        'processing': {
            'software': {'arm_pyart': pyart.__version__, 'numpy': np.__version__, 'pyproj': pyproj_version},
            'method': 'Barnes2 interpolation of dBZ, distance/beam radius of influence, minimum radius 700 m, nb=1, bsp=1.',
            'mask': 'Masked, invalid and antenna-transition gates are excluded. Grid points with no contributing observations or below radar altitude (388 m MSL) remain byte 0.',
            'quantization': '0.5 dBZ steps; values clipped to [-32, 95] dBZ. No reflectivity threshold is applied to the stored volume.',
            'validVoxels': int(valid.sum()),
            'missingVoxels': int((~valid).sum()),
            'rangeDbz': [float(reflectivity[valid].min()), float(reflectivity[valid].max())],
            'clippedVoxels': int(np.sum(valid & ((reflectivity.data < -32) | (reflectivity.data > 95)))),
            'limitations': 'One archived scan acquired over about four minutes. Interpolation is not a direct measurement at every voxel. No clutter, terrain or precipitation-type correction is performed. Missing coverage does not mean clear air.',
            'citation': 'Helmus and Collis (2016), doi:10.5334/jors.119',
        },
    }
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'bytes': len(payload), 'validVoxels': int(valid.sum()), 'rangeDbz': metadata['processing']['rangeDbz']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public' / 'storm')
    parser.add_argument('--source', type=Path, default=Path(tempfile.gettempdir()) / SOURCE_FILE)
    args = parser.parse_args()
    prepare(args.output, args.source)
