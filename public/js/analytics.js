// Owner: member 4
// Vanilla JS + fetch() only. No page reloads.
// Impact Analytics: pick an article, see its views over time (Chart.js), with a marker at every publish/update
// and a before/after comparison around the selected publish.
(function () {
  const page = document.querySelector('.analytics-page');
  if (!page || typeof Chart === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const searchEl = $('article-search');
  const resultsEl = $('picker-results');
  const emptyEl = $('chart-empty');
  const sectionEl = $('chart-section');
  const canvas = $('views-chart');

  const HOUR = 60 * 60 * 1000;
  const WINDOW_HOURS = 24; // how far before / after a publish we compare
  const COLOR_BEFORE = '#7A93B8';
  const COLOR_AFTER = '#E4572E';
  const RANGES = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, all: Infinity };

  const state = { articleId: '', title: '', series: [], publishes: [], selected: -1, range: 'all', chart: null };

  // ---- helpers ----
  const hourStart = (ms) => Math.floor(ms / HOUR) * HOUR;
  const fmtDateTime = (ms) => new Date(ms).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ms) => new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  const fmtNum = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 1 });
  const publishLabel = (i) => (i === 0 ? 'פרסום ראשון' : `עדכון ${i}`);

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  async function getJson(url) {
    const res = await fetch(url);
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הטעינה נכשלה');
    return data;
  }

  // ---- data ----
  // The server returns only hours that had views. Fill the quiet hours with 0 so the line is accurate.
  function buildSeries(buckets) {
    if (!buckets.length) return [];
    const byHour = new Map(buckets.map((b) => [hourStart(new Date(b.t).getTime()), b.count]));
    const start = hourStart(new Date(buckets[0].t).getTime());
    const end = hourStart(Date.now());
    const series = [];
    for (let t = start; t <= end; t += HOUR) series.push({ x: t, y: byHour.get(t) || 0 });
    return series;
  }

  // Average views per hour in the 24h before / after a publish.
  // The hour that contains the publish is skipped (it is partly before, partly after) and so is the current,
  // still unfinished, hour.
  function compare(publishMs) {
    const pivot = hourStart(publishMs);
    const lastComplete = hourStart(Date.now()) - HOUR;
    const seriesStart = state.series.length ? state.series[0].x : Infinity;
    const stat = (from, to) => {
      const pts = state.series.filter((p) => p.x >= from && p.x <= to && p.x >= seriesStart);
      const sum = pts.reduce((s, p) => s + p.y, 0);
      return { hours: pts.length, avg: pts.length ? sum / pts.length : null };
    };
    return {
      before: stat(pivot - WINDOW_HOURS * HOUR, pivot - HOUR),
      after: stat(pivot + HOUR, Math.min(pivot + WINDOW_HOURS * HOUR, lastComplete)),
    };
  }

  // ---- chart ----
  // Draws a dashed vertical line + label at every publish time (selected one is emphasised).
  const markersPlugin = {
    id: 'publishMarkers',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      ctx.font = '600 12px Heebo, Arial, sans-serif';
      ctx.textAlign = 'center';
      state.publishes.forEach((t, i) => {
        if (t < scales.x.min || t > scales.x.max) return;
        const x = scales.x.getPixelForValue(t);
        const selected = i === state.selected;
        ctx.strokeStyle = selected ? COLOR_AFTER : 'rgba(228, 87, 46, 0.55)';
        ctx.lineWidth = selected ? 2.5 : 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();

        ctx.setLineDash([]);
        const label = publishLabel(i);
        const w = ctx.measureText(label).width + 12;
        const y = chartArea.top + 4 + (i % 2) * 20; // stagger so close markers don't overlap
        ctx.fillStyle = selected ? COLOR_AFTER : '#fff';
        ctx.strokeStyle = COLOR_AFTER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(x - w / 2, y, w, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = selected ? '#fff' : COLOR_AFTER;
        ctx.fillText(label, x, y + 13);
      });
      ctx.restore();
    },
  };

  function visibleRange() {
    if (!state.series.length) return { min: 0, max: 1 };
    const first = state.series[0].x;
    const max = state.series[state.series.length - 1].x + HOUR;
    return { min: Math.max(first, max - RANGES[state.range]), max };
  }

  function tickLabel(v, step) {
    return step >= 24 * HOUR ? fmtDay(v) : `${fmtDay(v)} ${new Date(v).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function renderChart() {
    const { min, max } = visibleRange();
    const span = max - min;
    const step = span <= 24 * HOUR ? 3 * HOUR : span <= 7 * 24 * HOUR ? 24 * HOUR : Math.ceil(span / (8 * 24 * HOUR)) * 24 * HOUR;
    const data = state.series.filter((p) => p.x >= min && p.x <= max); // only visible points -> y axis fits the view
    const pivot = state.selected >= 0 ? state.publishes[state.selected] : null;

    const dataset = {
      data,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.25,
      borderColor: COLOR_BEFORE,
      segment: { borderColor: (c) => (pivot !== null && c.p1.parsed.x > pivot ? COLOR_AFTER : COLOR_BEFORE) },
    };
    const options = {
      parsing: false,
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => fmtDateTime(items[0].parsed.x),
            label: (item) => `${fmtNum(item.parsed.y)} צפיות`,
          },
        },
      },
      scales: {
        x: { type: 'linear', min, max, ticks: { stepSize: step, maxRotation: 0, callback: (v) => tickLabel(v, step) }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'צפיות בשעה' } },
      },
    };

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, { type: 'line', data: { datasets: [dataset] }, options, plugins: [markersPlugin] });
  }

  // ---- summary + publish list ----
  function renderSummary() {
    const textEl = $('summary-text');
    const statsEl = $('summary-stats');
    const noteEl = $('summary-note');
    statsEl.hidden = true;
    noteEl.hidden = true;
    if (state.selected < 0) {
      textEl.textContent = state.publishes.length ? 'בחרו נקודת פרסום.' : 'לכתבה הזו עדיין אין נקודות פרסום.';
      return;
    }
    const label = publishLabel(state.selected);
    const { before, after } = compare(state.publishes[state.selected]);
    if (!after.hours) {
      textEl.textContent = `${label}: עדיין לא עבר מספיק זמן מהפרסום כדי להשוות.`;
      return;
    }
    if (!before.hours) {
      textEl.textContent = `${label}: אין נתוני צפיות לפני הפרסום, ולכן אי אפשר להשוות.`;
      $('avg-before').textContent = '—';
      $('avg-after').textContent = fmtNum(after.avg);
      $('change').textContent = '—';
      $('change').className = 'change';
      statsEl.hidden = false;
      return;
    }
    textEl.textContent = `${label} - ${fmtDateTime(state.publishes[state.selected])}`;
    $('avg-before').textContent = fmtNum(before.avg);
    $('avg-after').textContent = fmtNum(after.avg);
    const changeEl = $('change');
    if (before.avg === 0) {
      changeEl.textContent = '—';
      changeEl.className = 'change';
    } else {
      const pct = ((after.avg - before.avg) / before.avg) * 100;
      changeEl.textContent = `${pct > 0 ? '+' : ''}${fmtNum(pct)}%`;
      changeEl.className = `change ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}`;
    }
    statsEl.hidden = false;
    const partial = [];
    if (before.hours < WINDOW_HOURS) partial.push(`${before.hours} שעות לפני`);
    if (after.hours < WINDOW_HOURS) partial.push(`${after.hours} שעות אחרי`);
    noteEl.textContent = partial.length
      ? `ההשוואה על חלון חלקי (${partial.join(', ')}) - היא מתייחסת רק לנתונים שקיימים.`
      : `ההשוואה על ${WINDOW_HOURS} שעות לפני ואחרי הפרסום (השעה שבה פורסם והשעה הנוכחית לא נספרות).`;
    noteEl.hidden = false;
  }

  function renderPublishList() {
    const list = $('publish-list');
    list.replaceChildren();
    state.publishes.forEach((t, i) => {
      const btn = el('button', { type: 'button', class: 'publish-item' + (i === state.selected ? ' active' : ''), 'aria-pressed': String(i === state.selected) }, [
        el('span', { class: 'publish-name', text: publishLabel(i) }),
        el('span', { class: 'muted', text: fmtDateTime(t) }),
      ]);
      btn.addEventListener('click', () => selectPublish(i));
      list.append(el('li', {}, [btn]));
    });
  }

  function selectPublish(i) {
    state.selected = i;
    renderPublishList();
    renderSummary();
    renderChart();
  }

  // ---- picking an article ----
  async function selectArticle(id) {
    emptyEl.textContent = 'טוען נתונים...';
    emptyEl.hidden = false;
    sectionEl.hidden = true;
    try {
      const stats = await getJson(`/editor/api/articles/${id}/stats`);
      state.articleId = id;
      state.title = stats.title;
      state.series = buildSeries(stats.buckets);
      state.publishes = stats.publishes.map((p) => new Date(p).getTime()).sort((a, b) => a - b);
      state.selected = state.publishes.length ? state.publishes.length - 1 : -1; // default: latest update

      $('chart-title').textContent = stats.title;
      $('chart-total').textContent = `סך הכל ${stats.total.toLocaleString('he-IL')} צפיות · ${state.publishes.length} נקודות פרסום`;
      canvas.setAttribute('aria-label', `גרף צפיות לאורך זמן לכתבה: ${stats.title}`);

      if (!state.series.length) {
        emptyEl.textContent = 'עדיין אין נתוני צפיות לכתבה הזו.';
        return;
      }
      emptyEl.hidden = true;
      sectionEl.hidden = false;
      renderPublishList();
      renderSummary();
      renderChart();

      const url = new URL(location.href);
      url.searchParams.set('article', id);
      history.replaceState(null, '', url);
      resultsEl.querySelectorAll('.picker-item').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    } catch (err) {
      emptyEl.textContent = err.message;
    }
  }

  let searchRequest = 0;
  async function search(q) {
    const mine = ++searchRequest;
    try {
      const params = new URLSearchParams({ status: 'published' });
      if (q) params.set('q', q);
      const data = await getJson(`/editor/api/articles?${params}`);
      if (mine !== searchRequest) return;
      resultsEl.replaceChildren();
      if (!data.articles.length) {
        resultsEl.append(el('li', { class: 'muted', text: 'לא נמצאו כתבות.' }));
        return;
      }
      data.articles.forEach((a) => {
        const btn = el('button', { type: 'button', class: 'picker-item' + (a.id === state.articleId ? ' active' : '') }, [
          el('span', { class: 'picker-title', text: a.title }),
          el('span', { class: 'muted small', text: `${a.categoryLabel} · ${a.viewCount.toLocaleString('he-IL')} צפיות` }),
        ]);
        btn.dataset.id = a.id;
        btn.addEventListener('click', () => selectArticle(a.id));
        resultsEl.append(el('li', {}, [btn]));
      });
      if (data.hasMore) resultsEl.append(el('li', { class: 'muted small', text: 'יש עוד כתבות - צמצמו עם חיפוש לפי כותרת.' }));
    } catch (err) {
      if (mine === searchRequest) resultsEl.replaceChildren(el('li', { class: 'error', text: err.message }));
    }
  }

  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(searchEl.value.trim()), 250);
  });

  $('range-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn || !state.series.length) return;
    state.range = btn.dataset.range;
    document.querySelectorAll('#range-buttons .chip').forEach((c) => c.classList.toggle('active', c === btn));
    renderChart();
  });

  search('');
  if (page.dataset.initialArticle) selectArticle(page.dataset.initialArticle);
})();
