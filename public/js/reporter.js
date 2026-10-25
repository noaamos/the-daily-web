// Owner: member 3
// Vanilla JS + fetch() only. No page reloads.
// "My articles" dashboard: the reporter's own articles with their status, status filter chips and a "load more" button.
(function () {
  const rowsEl = document.getElementById('article-rows');
  const statusEl = document.getElementById('list-status');
  const moreBtn = document.getElementById('load-more');
  const newBtn = document.getElementById('new-article');
  const formEl = document.getElementById('new-article-form');
  const categoryEl = document.getElementById('new-category');
  const titleEl = document.getElementById('new-title');
  const errorEl = document.getElementById('new-error');
  const submitBtn = document.getElementById('new-submit');
  const cancelBtn = document.getElementById('new-cancel');
  const chipsEl = document.getElementById('status-filter');
  const unsentEl = document.getElementById('unsent-filter');
  if (!rowsEl) return; // not the dashboard page

  const VALID_STATUSES = ['draft', 'returned', 'pending', 'published'];
  // status: '' = all articles. unsent: only published articles with changes that were not submitted.
  // requestId: an answer that arrives after a newer request is ignored.
  const state = { nextPage: 1, loading: false, creating: false, status: '', unsent: false, requestId: 0 };

  // After submitting an article the edit page sends the reporter here with ?submitted=1: show a short notice, once
  const flashEl = document.getElementById('flash');
  const params = new URLSearchParams(window.location.search);
  if (flashEl && params.get('submitted') === '1') {
    flashEl.hidden = false;
    params.delete('submitted');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }

  // Builds an element without innerHTML, so text written by a reporter can never inject HTML or scripts
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

  const formatDate = (iso) => new Date(iso).toLocaleString('he-IL', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  // One place for talking to the server: sends JSON, and turns an error answer into a thrown Error
  async function api(method, url, body) {
    const options = { method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      throw new Error('אין חיבור לשרת. נסו שוב.'); // fetch() fails with an English browser message when the server cannot be reached
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
    return data;
  }

  function listUrl(page) {
    const query = new URLSearchParams({ page });
    if (state.status) query.set('status', state.status);
    if (state.unsent) query.set('unsent', '1');
    return `/reporter/api/articles?${query}`;
  }

  // the numbers on the chips and next to the checkbox (they do not depend on the filter)
  function updateCounts(counts) {
    document.querySelectorAll('[data-count]').forEach((node) => { node.textContent = counts[node.dataset.count]; });
  }

  function buildRow(a) {
    const meta = el('div', { class: 'row-meta' }, [
      el('span', { class: 'cat-chip', 'data-category': a.category, text: a.categoryLabel }),
      el('span', { text: `עודכן ${formatDate(a.updatedAt)}` }),
    ]);
    // only an article that can be edited gets a link; the server decides this (`editable`)
    const title = a.editable
      ? el('a', { class: 'row-title', href: `/reporter/articles/${a.id}/edit`, text: a.title })
      : el('span', { class: 'row-title', text: a.title });
    const main = [title, meta];
    // an article the editor sent back: a short preview of the note (the full text is on the edit page)
    if (a.editorNote) main.push(el('p', { class: 'row-note', text: `הערת העורך: ${a.editorNote}` }));
    // the status, and for an article that is live: whether this is an update, or has changes that were not submitted
    const badges = [el('span', { class: `badge badge-${a.status}`, text: a.statusLabel })];
    if (a.isUpdate) badges.push(el('span', { class: 'badge badge-update', title: 'עדכון לכתבה שכבר פורסמה', text: 'עדכון' }));
    if (a.unsentChanges) badges.push(el('span', { class: 'badge badge-unsent', text: 'יש שינויים שלא הוגשו' }));
    return el('li', { class: 'article-row', dataset: { id: a.id } }, [
      el('div', { class: 'row-main' }, main),
      el('div', { class: 'row-badges' }, badges),
    ]);
  }

  // reset = true: start again from page 1 (the filter changed): the rows are replaced when the answer arrives.
  // reset = false: append the next page ("load more").
  async function load(reset) {
    if (!reset && state.loading) return; // ignore a second click on "load more" while a request is running
    const mine = ++state.requestId;
    state.loading = true;
    moreBtn.disabled = true;
    if (reset) {
      moreBtn.hidden = true;
      if (!rowsEl.children.length) { statusEl.textContent = 'טוען...'; statusEl.hidden = false; }
    }
    const page = reset ? 1 : state.nextPage;
    try {
      const data = await api('GET', listUrl(page));
      if (mine !== state.requestId) return; // a newer request has taken over
      state.nextPage = page + 1; // only after success, so a failed request can simply be retried
      if (reset) rowsEl.replaceChildren();
      data.articles.forEach((a) => rowsEl.append(buildRow(a)));
      updateCounts(data.counts);
      moreBtn.hidden = !data.hasMore;
      statusEl.hidden = rowsEl.children.length > 0;
      if (!rowsEl.children.length) {
        statusEl.textContent = data.counts.total === 0 ? 'עדיין אין כתבות. לחצו על "כתבה חדשה" כדי להתחיל.' : 'אין כתבות במצב הזה.';
      }
    } catch (err) {
      if (mine !== state.requestId) return;
      if (reset) rowsEl.replaceChildren(); // do not leave the rows of another filter under the error
      statusEl.textContent = 'טעינת הכתבות נכשלה. נסו שוב או רעננו את הדף.';
      statusEl.hidden = false;
    } finally {
      if (mine === state.requestId) {
        state.loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  // ---- filters: status chips, and the "unsent changes" checkbox ----
  // Unsent changes only exist on published articles, so the checkbox is available for "all" and "published" only
  const unsentAllowed = () => state.status === '' || state.status === 'published';

  // Shows the current filter (chips, checkbox) and keeps it in the address, so a refresh or a shared link keeps it
  function syncFilters() {
    chipsEl.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.status === state.status;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    if (!unsentAllowed()) state.unsent = false;
    unsentEl.checked = state.unsent;
    unsentEl.disabled = !unsentAllowed();
    unsentEl.closest('.check-filter').classList.toggle('is-disabled', unsentEl.disabled);
    const url = new URL(window.location.href);
    if (state.status) url.searchParams.set('status', state.status); else url.searchParams.delete('status');
    if (state.unsent) url.searchParams.set('unsent', '1'); else url.searchParams.delete('unsent');
    window.history.replaceState(null, '', url);
  }

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.status = chip.dataset.status;
    syncFilters();
    load(true);
  });
  unsentEl.addEventListener('change', () => {
    state.unsent = unsentEl.checked;
    syncFilters();
    load(true);
  });

  // ---- new article form ----
  function showForm(show) {
    formEl.hidden = !show;
    newBtn.setAttribute('aria-expanded', String(show));
    if (show) {
      categoryEl.focus();
    } else {
      formEl.reset();
      errorEl.hidden = true;
    }
  }

  function showFormError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  async function createArticle(event) {
    event.preventDefault();
    if (state.creating) return; // ignore a second submit while the request is running
    if (!categoryEl.value) return showFormError('יש לבחור קטגוריה');
    state.creating = true;
    submitBtn.disabled = true;
    errorEl.hidden = true;
    try {
      const article = await api('POST', '/reporter/api/articles', { category: categoryEl.value, title: titleEl.value });
      // go straight to the edit page; the buttons stay locked until the browser leaves this page
      window.location.assign(`/reporter/articles/${article.id}/edit`);
    } catch (err) {
      showFormError(err.message);
      state.creating = false;
      submitBtn.disabled = false;
    }
  }

  newBtn.addEventListener('click', () => showForm(formEl.hidden));
  cancelBtn.addEventListener('click', () => showForm(false));
  formEl.addEventListener('submit', createArticle);
  moreBtn.addEventListener('click', () => load(false));

  // The filter from the address (?status=returned&unsent=1). A value that is not a status is ignored: the page shows
  // everything, and syncFilters() removes the unknown value from the address.
  state.status = VALID_STATUSES.includes(params.get('status')) ? params.get('status') : '';
  state.unsent = params.get('unsent') === '1';
  syncFilters();
  load(true);
})();
