// Owner: member 1
// Weather widget in the sidebar. Data comes from our own server (/api/weather), never directly
// from OpenWeatherMap - so the API key stays secret and the server's cache is used.
// The data shown is never older than 15 minutes: the server says how long it may still be shown (expiresInMs),
// and the widget replaces it with "not available" when that time is over (a tab left open, or the service is down).
(function () {
  const widget = document.getElementById('weather-widget');
  if (!widget) return;
  const body = widget.querySelector('.weather-body');
  const REFRESH_MS = 5 * 60 * 1000; // same as the server's cache: asking more often would only get the same answer
  let expireTimer;
  const timeFormat = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

  // Small helper: create an element with a class and text (textContent - safe from XSS)
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function detail(label, value) {
    const li = el('li');
    li.append(el('span', null, label), el('strong', null, value));
    return li;
  }

  function render(w) {
    const main = el('div', 'weather-main');
    const icon = el('img', 'weather-icon');
    icon.src = 'https://openweathermap.org/img/wn/' + encodeURIComponent(w.icon) + '@2x.png';
    icon.alt = '';
    icon.width = 64;
    icon.height = 64;
    main.append(icon, el('span', 'weather-temp', w.temp + '°'));

    const details = el('ul', 'weather-details');
    details.append(
      detail('מרגיש כמו', w.feelsLike + '°'),
      detail('לחות', w.humidity + '%'),
      detail('רוח', w.wind + ' קמ"ש')
    );

    const updated = el('p', 'weather-updated', 'עודכן ב-' + timeFormat.format(new Date(w.updatedAt)));

    body.replaceChildren(main, el('p', 'weather-desc', w.description), el('p', 'weather-city', w.city), details, updated);
  }

  function showUnavailable() {
    body.replaceChildren(el('p', 'muted', 'מזג האוויר לא זמין כרגע'));
  }

  async function load() {
    clearTimeout(expireTimer);
    try {
      const res = await fetch('/api/weather', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      render(data);
      expireTimer = setTimeout(showUnavailable, data.expiresInMs); // do not keep showing it after it is too old
    } catch (err) {
      showUnavailable();
    }
  }

  load();
  setInterval(load, REFRESH_MS); // keep it fresh for readers who leave the page open
  // A tab in the background (or a sleeping computer) may have missed its timers: check again when it comes back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
})();
