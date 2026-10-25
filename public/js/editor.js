// Editor dashboard: article list with status filters and load more.
// Approvals and returns are handled on the article review page.
(function () {
  const rowsEl = document.getElementById('article-rows');
  const statusEl = document.getElementById('list-status');
  const moreBtn = document.getElementById('load-more');
  const chipsEl = document.getElementById('status-filter');
  const toastEl = document.getElementById('toast');
  if (!rowsEl) return; // not the dashboard page

  const VALID_STATUSES = ['draft', 'pending', 'returned', 'published'];
  const state = { status: '', page: 1, hasMore: false, requestId: 0 };

  // ---- small helpers ----
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  let toastTimer;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', Boolean(isError));
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  // "3 hours ago" for recent changes, a short date for older ones
  const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
  function timeAgo(iso) {
    const diff = (new Date(iso) - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'ממש עכשיו';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  }

  // ---- API ----
  async function api(method, url) {
    const res = await fetch(url, { method });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
    return data;
  }

  // ---- rendering ----
  function updateCounts(counts) {
    document.querySelectorAll('[data-count]').forEach((span) => {
      const n = counts[span.dataset.count];
      span.textContent = typeof n === 'number' ? `(${n})` : '';
    });
  }

  function buildRow(a) {
    const title = el('a', { class: 'row-title', href: `/editor/articles/${a.id}`, text: a.title });
    const heading = el('div', {}, [title]);
    const meta = el('div', { class: 'row-meta' }, [
      el('span', { text: a.author }),
      el('span', { class: 'ed-cat', 'data-category': a.category, text: a.categoryLabel }),
      el('span', { title: new Date(a.updatedAt).toLocaleString('he-IL'), text: `עודכן ${timeAgo(a.updatedAt)}` }),
    ]);

    // badges sit together in the status column, vertically centered in the row
    const badges = el('div', { class: 'row-badges' }, [el('span', { class: `badge badge-${a.status}`, text: a.statusLabel })]);
    if (a.isUpdate) badges.append(el('span', { class: 'badge badge-update', title: 'עדכון לכתבה שכבר פורסמה, ממתין לאישור', text: 'עדכון' }));
    const status = el('div', { class: 'row-status' }, [badges]);
    if (a.status === 'published') status.append(el('span', { class: 'row-views', text: `${a.viewCount.toLocaleString('he-IL')} צפיות` }));

    // one main button: "review" when the article needs the editor, otherwise just "view"
    const isPending = a.status === 'pending';
    const main = el('a', { class: isPending ? 'btn-accent' : 'btn-outline', href: `/editor/articles/${a.id}`, text: isPending ? 'בדיקה' : 'צפייה' });

    const menu = el('div', { class: 'more-menu' });
    if (a.hasPublished) menu.append(el('a', { href: `/editor/analytics?article=${a.id}`, text: 'סטטיסטיקות' }));
    const del = el('button', { type: 'button', class: 'danger', text: 'מחיקה' });
    del.addEventListener('click', async () => {
      if (!confirm(`למחוק את "${a.title}"? אי אפשר לבטל.`)) return;
      try {
        await api('DELETE', `/editor/api/articles/${a.id}`);
        toast('הכתבה נמחקה');
        load(true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    menu.append(del);
    const more = el('details', { class: 'more' }, [el('summary', { 'aria-label': 'עוד פעולות', text: '⋯' }), menu]);

    return el('li', { class: 'article-row', dataset: { id: a.id } }, [
      el('div', { class: 'row-main' }, [heading, meta]),
      status,
      el('div', { class: 'row-actions' }, [main, more]),
    ]);
  }

  // close an open "more" menu when clicking elsewhere
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.more[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  // ---- loading ----
  // reset = true: start again from page 1 (filter changed / after a delete); false: append the next page
  async function load(reset) {
    const myRequest = ++state.requestId; // ignore answers that arrive after a newer request
    if (reset) {
      state.page = 1;
      moreBtn.hidden = true;
      statusEl.textContent = 'טוען...';
      statusEl.hidden = false;
    }
    const params = new URLSearchParams({ page: state.page });
    if (state.status) params.set('status', state.status);
    try {
      const data = await api('GET', `/editor/api/articles?${params}`);
      if (myRequest !== state.requestId) return;
      if (reset) rowsEl.replaceChildren();
      data.articles.forEach((a) => rowsEl.append(buildRow(a)));
      updateCounts(data.counts);
      state.hasMore = data.hasMore;
      moreBtn.hidden = !data.hasMore;
      statusEl.hidden = rowsEl.children.length > 0;
      if (!rowsEl.children.length) statusEl.textContent = 'אין כתבות במצב הזה.';
    } catch (err) {
      if (myRequest !== state.requestId) return;
      statusEl.textContent = 'טעינת הכתבות נכשלה. נסו לרענן את הדף.';
      statusEl.hidden = false;
      toast(err.message, true);
    }
  }

  function setStatus(status) {
    state.status = VALID_STATUSES.includes(status) ? status : '';
    chipsEl.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.status === state.status;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    const url = new URL(location.href);
    if (state.status) url.searchParams.set('status', state.status);
    else url.searchParams.delete('status');
    history.replaceState(null, '', url);
  }

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setStatus(chip.dataset.status);
    load(true);
  });

  moreBtn.addEventListener('click', () => {
    state.page += 1;
    load(false);
  });

  setStatus(new URLSearchParams(location.search).get('status'));
  load(true);
})();
