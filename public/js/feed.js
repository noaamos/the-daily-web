// Owner: member 1
// Home page feed: infinite scroll + search / filter / sort, all without reloading the page.

(function () {
  const form = document.getElementById('feed-controls');
  const feedEl = document.getElementById('feed');
  const statusEl = document.getElementById('feed-status');
  const sentinel = document.getElementById('feed-sentinel');
  const template = document.getElementById('card-template');
  const inputs = {
    q: document.getElementById('q'),
    category: document.getElementById('category'),
    viewed: document.getElementById('viewed'),
    sort: document.getElementById('sort'),
  };
  const frontEl = document.getElementById('front');
  const latestEl = document.getElementById('front-latest'); // sidebar "latest news", shown and hidden together with the front page
  const feedTitle = document.getElementById('feed-title');
  const navLinks = document.querySelectorAll('.category-nav a[data-category]');

  const SEARCH_DELAY_MS = 350;
  const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

  // "לפני 5 דקות" / "לפני שעתיים" for the last day, a full date after that.
  // (Intl.RelativeTimeFormat gives odd Hebrew like "לפני דקה (1)", so we write the phrases ourselves.)
  function formatPublished(date) {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    const hours = Math.floor(minutes / 60);
    if (minutes < 1) return 'עכשיו';
    if (minutes === 1) return 'לפני דקה';
    if (minutes < 60) return 'לפני ' + minutes + ' דקות';
    if (hours === 1) return 'לפני שעה';
    if (hours === 2) return 'לפני שעתיים';
    if (hours < 24) return 'לפני ' + hours + ' שעות';
    return dateFormat.format(date);
  }

  // Everything the feed needs to remember between requests
  const state = {
    page: 0,          // last page that was loaded
    hasMore: true,
    loading: false,
    snapshot: null,   // returned by the server with page 1, sent back with the next pages
    controller: null, // AbortController of the request in flight
  };

  function currentFilters() {
    return {
      q: inputs.q.value.trim(),
      category: inputs.category.value,
      viewed: inputs.viewed.value,
      sort: inputs.sort.value,
    };
  }

  function buildUrl(page) {
    const params = new URLSearchParams({ page });
    const filters = currentFilters();
    Object.keys(filters).forEach((key) => {
      if (filters[key]) params.set(key, filters[key]);
    });
    if (state.snapshot) params.set('snapshot', state.snapshot);
    return '/api/articles?' + params.toString();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function renderCard(article) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.category = article.category; // CSS picks the tag color from this
    const markRead = () => {
      card.classList.add('is-read');
      card.querySelector('.card-read-badge').hidden = false;
    };
    if (article.viewed) markRead();
    // Mark right away on click, so it's already marked when the user comes back with the Back button
    card.querySelector('.card-link').addEventListener('click', markRead);
    card.querySelector('.card-link').href = '/articles/' + article.id;
    const img = card.querySelector('.card-image');
    if (article.imageUrl) img.src = article.imageUrl;
    else img.remove();
    card.querySelector('.card-category').textContent = article.categoryLabel;
    card.querySelector('.card-title').textContent = article.title;
    card.querySelector('.card-summary').textContent = article.summary;
    card.querySelector('.card-author').textContent = article.author;
    const time = card.querySelector('.card-date');
    time.dateTime = article.publishedAt;
    time.textContent = formatPublished(new Date(article.publishedAt));
    return card;
  }

  async function loadNextPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const controller = new AbortController();
    state.controller = controller;
    setStatus('טוען כתבות...');
    // Old cards stay on screen while a new search loads; CSS dims them (aria-busy)
    if (state.page === 0 && feedEl.children.length) feedEl.setAttribute('aria-busy', 'true');

    try {
      const res = await fetch(buildUrl(state.page + 1), { signal: controller.signal });
      const data = await res.json();
      if (controller !== state.controller) return; // replaced by a newer search while we waited
      if (!res.ok) throw new Error(data.error || 'שגיאה בטעינת הכתבות');

      const fragment = document.createDocumentFragment();
      data.articles.forEach((article) => fragment.appendChild(renderCard(article)));
      if (state.page === 0) {
        // First page of a new search / filter: swap the old cards for the new ones in one step (no empty flash)
        feedEl.replaceChildren(fragment);
        if (feedTitle.getBoundingClientRect().top < 0) feedTitle.scrollIntoView({ block: 'start' });
      } else {
        feedEl.appendChild(fragment);
      }

      state.page = data.page;
      state.hasMore = data.hasMore;
      state.snapshot = data.snapshot;

      if (feedEl.children.length === 0) setStatus('לא נמצאו כתבות מתאימות');
      else if (!state.hasMore) setStatus('אין כתבות נוספות');
      else setStatus('');
    } catch (err) {
      if (err.name === 'AbortError') return; // a newer search replaced this request - ignore it
      setStatus(err.message || 'שגיאה בטעינת הכתבות', true);
      state.hasMore = false;
      showRetry();
    } finally {
      // Only the current request may clear the flag - an old aborted one must not touch the new one's state
      if (controller === state.controller) {
        state.loading = false;
        feedEl.removeAttribute('aria-busy');
      }
    }

    // The screen may still not be full (e.g. a tall monitor) - keep loading until it is
    if (controller === state.controller && state.hasMore && isSentinelVisible()) loadNextPage();
  }

  function showRetry() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'נסו שוב';
    btn.addEventListener('click', () => {
      state.hasMore = true;
      loadNextPage();
    });
    statusEl.append(' ', btn);
  }

  // Keep the rest of the page in sync with the filters:
  //  - the URL (/?category=sports&q=...) so Back / refresh / sharing a link keep the same results
  //  - the "front page" section is shown only when no search or filter is active
  //  - the active category in the category bar
  function syncPage() {
    const filters = currentFilters();
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.viewed !== 'all') params.set('viewed', filters.viewed);
    if (filters.sort !== 'date') params.set('sort', filters.sort);
    const query = params.toString();
    history.replaceState(null, '', query ? '/?' + query : '/');

    const hideFront = Boolean(filters.q || filters.category || filters.viewed !== 'all');
    if (frontEl) frontEl.hidden = hideFront;
    if (latestEl) latestEl.hidden = hideFront;
    navLinks.forEach((link) => link.classList.toggle('active', link.dataset.category === filters.category));
  }

  // Start over from page 1 - called whenever search / filter / sort changes
  function resetFeed() {
    syncPage();
    if (state.controller) state.controller.abort();
    state.page = 0;
    state.hasMore = true;
    state.loading = false;
    state.snapshot = null;
    loadNextPage(); // the first page replaces the cards that are on screen once it arrives
  }

  function isSentinelVisible() {
    return sentinel.getBoundingClientRect().top < window.innerHeight + 400;
  }

  // Infinite scroll: load the next page when the sentinel (below the last card) gets near the screen
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadNextPage();
  }, { rootMargin: '400px' });
  observer.observe(sentinel);

  // Search waits until the user stops typing, so we don't send a request on every key
  let searchTimer;
  inputs.q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(resetFeed, SEARCH_DELAY_MS);
  });
  ['category', 'viewed', 'sort'].forEach((name) => inputs[name].addEventListener('change', resetFeed));

  // Enter in the search box must not reload the page
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    resetFeed();
  });

  // Category bar: on the home page, filter without reloading (on other pages the links navigate normally)
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return; // let "open in new tab" work
      e.preventDefault();
      inputs.category.value = link.dataset.category;
      resetFeed();
      if (link.dataset.category) feedTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Server-rendered dates in the front section: show "לפני 3 שעות" for recent articles
  document.querySelectorAll('time[data-relative]').forEach((time) => {
    time.textContent = formatPublished(new Date(time.dateTime));
  });

  loadNextPage();
})();
