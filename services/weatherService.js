// Owner: member 1
// The server fetches the weather at most once every 15 minutes and keeps it in memory.
// Thousands of readers -> still only ~4 calls per hour to the external API.
const { WEATHER_CACHE_MS } = require('../config/constants');

// eslint-disable-next-line no-unused-vars
let cache = { data: null, fetchedAt: 0 };

async function getWeather() {
  // TODO(member 1):
  //  - if cache is fresher than WEATHER_CACHE_MS return cache.data
  //  - else fetch() from OpenWeatherMap with process.env.WEATHER_API_KEY, keep only the fields we show
  //  - if the external service fails: log it and return the last cached data (or null) - never crash the page
  return null;
}

module.exports = { getWeather, WEATHER_CACHE_MS };
