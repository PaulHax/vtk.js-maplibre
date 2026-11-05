const BIKE_DISCOVERY_URL = 'https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json';
const INFO_CACHE_MS = 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;
// NYC and Bronx region IDs from Citi Bike's system_regions feed.
const NYC_REGIONS = new Set(['71', '185']);
let bikeFeeds;
let stationInformation;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) => finite(value) && value > 0 && value <= 8.64e15;
const secondsTimestamp = (value) => finite(value) && timestamp(value * 1000);
const count = (value) => Number.isInteger(value) && value >= 0;
const coordinates = (longitude, latitude) => finite(longitude) && finite(latitude)
  && Math.abs(longitude) <= 180 && Math.abs(latitude) < 85.051129;

async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
  return response.json();
}

async function discoverBikeFeeds(signal) {
  if (bikeFeeds && Date.now() < bikeFeeds.expiresAt) return bikeFeeds.urls;
  const discovery = await fetchJSON(BIKE_DISCOVERY_URL, signal);
  const feeds = discovery?.data?.en?.feeds;
  if (!Array.isArray(feeds)) throw new Error('The bike feed directory has an unexpected format.');
  const urls = Object.fromEntries(['station_information', 'station_status'].map((name) => {
    const value = feeds.find((feed) => feed.name === name)?.url;
    const url = typeof value === 'string' ? new URL(value) : null;
    if (url?.protocol !== 'https:') throw new Error(`The bike feed directory is missing ${name}.`);
    return [name, url.href];
  }));
  bikeFeeds = { urls, expiresAt: Date.now() + INFO_CACHE_MS };
  return urls;
}

async function loadStationInformation(url, signal) {
  if (stationInformation?.url === url && Date.now() < stationInformation.expiresAt) return stationInformation.stations;
  const feed = await fetchJSON(url, signal);
  if (!Array.isArray(feed?.data?.stations)) throw new Error('The bike station directory has an unexpected format.');
  const stations = new Map(feed.data.stations
    .filter((station) => typeof station.station_id === 'string' && typeof station.name === 'string'
      && NYC_REGIONS.has(String(station.region_id)) && coordinates(station.lon, station.lat))
    .map((station) => [station.station_id, {
      id: station.station_id,
      name: station.name,
      longitude: station.lon,
      latitude: station.lat,
      capacity: count(station.capacity) ? station.capacity : null,
    }]));
  stationInformation = { url, stations, expiresAt: Date.now() + INFO_CACHE_MS };
  return stations;
}

export async function loadBikes({ signal } = {}) {
  const urls = await discoverBikeFeeds(signal);
  const [stations, status] = await Promise.all([
    loadStationInformation(urls.station_information, signal),
    fetchJSON(urls.station_status, signal),
  ]);
  if (!Array.isArray(status?.data?.stations) || !secondsTimestamp(status.last_updated)) {
    throw new Error('The bike status feed has an unexpected format.');
  }
  const items = status.data.stations.flatMap((station) => {
    const info = stations.get(station.station_id);
    if (!info || station.is_installed !== 1 || station.is_renting !== 1 || station.is_returning !== 1
      || !count(station.num_bikes_available) || !count(station.num_docks_available)
      || !secondsTimestamp(station.last_reported) || status.last_updated - station.last_reported > 15 * 60) return [];
    return [{
      ...info,
      bikes: station.num_bikes_available,
      docks: station.num_docks_available,
      capacity: info.capacity > 0 ? info.capacity : station.num_bikes_available + station.num_docks_available,
      reportedAt: station.last_reported * 1000,
    }];
  });
  return {
    items,
    updatedAt: status.last_updated * 1000,
    refreshAfter: finite(status.ttl) && status.ttl > 0 ? Math.max(REFRESH_MS, status.ttl * 1000) : REFRESH_MS,
  };
}
