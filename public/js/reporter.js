// Owner: member 3
// Vanilla JS + fetch() only. No page reloads.
// "My articles" dashboard: the reporter's own articles with their status and a "load more" button.
(function () {
  const rowsEl = document.getElementById('article-rows');
  const statusEl = document.getElementById('list-status');
  const moreBtn = document.getElementById('load-more');
  if (!rowsEl) return; // not the dashboard page

  const state = { nextPage: 1, loading: false };

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

  async function fetchPage(page) {
    const res = await fetch(`/reporter/api/articles?page=${page}`);
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הטעינה נכשלה');
    return data;
  }

  function buildRow(a) {
    const meta = el('div', { class: 'row-meta' }, [
      el('span', { class: 'cat-chip', 'data-category': a.category, text: a.categoryLabel }),
      el('span', { text: `עודכן ${formatDate(a.updatedAt)}` }),
    ]);
    return el('li', { class: 'article-row', dataset: { id: a.id } }, [
      el('div', { class: 'row-main' }, [el('span', { class: 'row-title', text: a.title }), meta]),
      el('span', { class: `badge badge-${a.status}`, text: a.statusLabel }),
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

  moreBtn.addEventListener('click', loadPage);
  loadPage();
})();
