// Owner: member 4
// Vanilla JS + fetch() only. No page reloads.
// Editor dashboard: status filter, article list with "load more", approve / return / delete actions.
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

  const formatDate = (iso) => new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ---- API ----
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const notReady = res.status === 501;
      const err = new Error(notReady ? 'הפעולה טרם מומשה בשרת' : (data.error || 'הפעולה נכשלה'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---- rendering ----
  function updateCounts(counts) {
    document.querySelectorAll('[data-count]').forEach((span) => {
      const n = counts[span.dataset.count];
      span.textContent = typeof n === 'number' ? `(${n})` : '';
    });
  }

  function actionButton(label, cls, onClick) {
    const btn = el('button', { type: 'button', class: cls, text: label });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildReturnForm(article, actionsCell) {
    const textarea = el('textarea', { 'aria-label': 'הערה לכתב', placeholder: 'מה צריך לתקן?', maxlength: '1000' });
    const error = el('p', { class: 'field-error', hidden: '' });
    const send = actionButton('שליחה', 'btn-accent', async () => {
      const note = textarea.value.trim();
      if (!note) {
        error.textContent = 'חובה לכתוב הערה לכתב';
        error.hidden = false;
        textarea.focus();
        return;
      }
      error.hidden = true;
      send.disabled = true;
      try {
        await api('POST', `/editor/api/articles/${article.id}/return`, { note });
        toast('הכתבה הוחזרה לכתב');
        load(true);
      } catch (err) {
        toast(err.message, true);
        send.disabled = false;
      }
    });
    const cancel = actionButton('ביטול', 'btn-outline', () => form.remove());
    const form = el('div', { class: 'return-form' }, [el('div', { style: 'flex:1' }, [textarea, error]), send, cancel]);
    actionsCell.append(form);
    textarea.focus();
  }

  function buildRow(a) {
    const actions = el('div', { class: 'row-actions' });
    const actionsCell = el('td', { class: 'col-actions' }, [actions]);

    actions.append(el('a', { class: 'btn-outline', href: `/editor/articles/${a.id}`, text: a.status === 'pending' ? 'בדיקה' : 'צפייה' }));
    if (a.status === 'pending') {
      actions.append(
        actionButton('אישור', 'btn-accent', async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('POST', `/editor/api/articles/${a.id}/approve`);
            toast('הכתבה אושרה ופורסמה');
            load(true);
          } catch (err) {
            toast(err.message, true);
            e.currentTarget.disabled = false;
          }
        }),
        actionButton('החזרה לתיקונים', 'btn-outline', () => {
          if (!actionsCell.querySelector('.return-form')) buildReturnForm(a, actionsCell);
        }),
      );
    }
    actions.append(actionButton('מחיקה', 'btn-outline btn-danger', async () => {
      if (!confirm(`למחוק את "${a.title}"? אי אפשר לבטל.`)) return;
      try {
        await api('DELETE', `/editor/api/articles/${a.id}`);
        toast('הכתבה נמחקה');
        load(true);
      } catch (err) {
        toast(err.message, true);
      }
    }));

    const titleLink = el('a', { href: `/editor/articles/${a.id}`, text: a.title });
    const titleCell = el('td', { class: 'col-title' }, [titleLink]);
    if (a.isUpdate) titleCell.append(el('span', { class: 'badge badge-update', text: 'עדכון לכתבה שפורסמה' }));

    return el('tr', { dataset: { id: a.id } }, [
      titleCell,
      el('td', { class: 'col-meta', 'data-label': 'כתב', text: a.author }),
      el('td', { 'data-label': 'קטגוריה' }, [el('span', { class: 'ed-cat', 'data-category': a.category, text: a.categoryLabel })]),
      el('td', { 'data-label': 'מצב' }, [el('span', { class: `badge badge-${a.status}`, text: a.statusLabel })]),
      el('td', { class: 'col-meta', 'data-label': 'עודכן', text: formatDate(a.updatedAt) }),
      el('td', { class: 'col-meta', 'data-label': 'צפיות', text: a.viewCount.toLocaleString('he-IL') }),
      actionsCell,
    ]);
  }

  // ---- loading ----
  // reset = true: start again from page 1 (filter changed / after an action); false: append the next page
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
