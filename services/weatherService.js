// Owner: member 1
// The server fetches the weather at most once every WEATHER_CACHE_MS (5 minutes) and keeps it in memory.
// Thousands of readers -> still only ~12 calls per hour to the external API.
// Data older than WEATHER_MAX_AGE_MS (15 minutes, the requirement) is never returned, even when the service is down.
const { WEATHER_CACHE_MS, WEATHER_MAX_AGE_MS } = require('../config/constants');
const logger = require('../config/logger');

const API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const REQUEST_TIMEOUT_MS = 5000;        // don't let a slow external service hold our users
const RETRY_AFTER_ERROR_MS = 60 * 1000; // after a failure, wait a minute before trying again

let cache = { data: null, fetchedAt: 0 };
let lastErrorAt = 0;
let inFlight = null; // the request currently running, shared by everyone who asks meanwhile

// Keep only the fields the widget shows
function toWidgetData(json) {
  return {
    city: json.name,
    temp: Math.round(json.main.temp),
    feelsLike: Math.round(json.main.feels_like),
    humidity: json.main.humidity,
    wind: Math.round(json.wind.speed * 3.6), // m/s -> km/h
    description: json.weather[0].description,
    icon: json.weather[0].icon,
  };
}

async function fetchFromApi() {
  const params = new URLSearchParams({
    q: process.env.WEATHER_CITY || 'Tel Aviv',
    units: 'metric',
    lang: 'he',
    appid: process.env.WEATHER_API_KEY,
  });
  const res = await fetch(`${API_URL}?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenWeatherMap responded ${res.status}`);
  return toWidgetData(await res.json());
}

function withMeta() {
  const age = Date.now() - cache.fetchedAt;
  if (!cache.data || age >= WEATHER_MAX_AGE_MS) return null; // too old to show: better no weather than old weather
  return {
    ...cache.data,
    updatedAt: new Date(cache.fetchedAt).toISOString(),
    expiresInMs: WEATHER_MAX_AGE_MS - age, // the page hides the data after this long, without trusting its own clock
  };
}

/**
 * Returns { ...weather, updatedAt, expiresInMs } or null when there is no weather younger than 15 minutes.
 * Never throws - the page must work even when the weather service is down.
 */
async function getWeather() {
  const now = Date.now();
  const isFresh = cache.data && now - cache.fetchedAt < WEATHER_CACHE_MS;
  const recentlyFailed = now - lastErrorAt < RETRY_AFTER_ERROR_MS;
  if (isFresh || recentlyFailed) return withMeta();

  if (!process.env.WEATHER_API_KEY) {
    logger.warn('WEATHER_API_KEY is missing in .env - weather widget disabled');
    lastErrorAt = now;
    return withMeta();
  }

  // If 1000 readers arrive right when the cache expires, only the first one sends a request;
  // the others wait for that same request instead of sending 999 more.
  if (!inFlight) {
    inFlight = fetchFromApi()
      .then((data) => {
        cache = { data, fetchedAt: Date.now() };
      })
      .catch((err) => {
        lastErrorAt = Date.now();
        logger.error(`Weather fetch failed: ${err.message}`);
      })
      .finally(() => {
        inFlight = null;
      });
  }
  await inFlight;
  return withMeta();
}

module.exports = { getWeather };
