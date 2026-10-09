// Owner: member 1
// Weather widget in the sidebar. Data comes from our own server (/api/weather), never directly
// from OpenWeatherMap - so the API key stays secret and the server's 15-minute cache is used.
(function () {
  const widget = document.getElementById('weather-widget');
  if (!widget) return;
  const body = widget.querySelector('.weather-body');
  const REFRESH_MS = 15 * 60 * 1000;
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
    if (w.stale) updated.textContent += ' (ייתכן שהנתונים אינם עדכניים)';

    body.replaceChildren(main, el('p', 'weather-desc', w.description), el('p', 'weather-city', w.city), details, updated);
  }

  async function load() {
    try {
      const res = await fetch('/api/weather');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      render(data);
    } catch (err) {
      body.replaceChildren(el('p', 'muted', 'מזג האוויר לא זמין כרגע'));
    }
  }

  load();
  setInterval(load, REFRESH_MS); // keep it fresh for readers who leave the page open
})();
