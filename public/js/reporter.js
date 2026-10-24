// Owner: member 3
// Vanilla JS + fetch() only. No page reloads.
// "My articles" dashboard: the reporter's own articles with their status and a "load more" button.
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
  if (!rowsEl) return; // not the dashboard page

  const state = { nextPage: 1, loading: false, creating: false };

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

  const fetchPage = (page) => api('GET', `/reporter/api/articles?page=${page}`);

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

  async function loadPage() {
    if (state.loading) return; // ignore a second click while a request is running
    state.loading = true;
    moreBtn.disabled = true;
    try {
      const data = await fetchPage(state.nextPage);
      state.nextPage += 1; // only after success, so a failed request can simply be retried
      data.articles.forEach((a) => rowsEl.append(buildRow(a)));
      moreBtn.hidden = !data.hasMore;
      statusEl.hidden = rowsEl.children.length > 0;
      if (!rowsEl.children.length) statusEl.textContent = 'עדיין אין כתבות. לחצו על "כתבה חדשה" כדי להתחיל.';
    } catch (err) {
      statusEl.textContent = 'טעינת הכתבות נכשלה. נסו שוב או רעננו את הדף.';
      statusEl.hidden = false;
    } finally {
      state.loading = false;
      moreBtn.disabled = false;
    }
  }

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
  moreBtn.addEventListener('click', loadPage);
  loadPage();
})();
