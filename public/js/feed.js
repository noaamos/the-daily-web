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
  const feedTitle = document.getElementById('feed-title');
  const navLinks = document.querySelectorAll('.category-nav a[data-category]');

  const SEARCH_DELAY_MS = 350;
  const BUSY_DELAY_MS = 400; // a new search shows "loading" only if it takes longer than this
  const EAGER_CARDS = 8;     // the first cards of a new search: their pictures are loaded before the cards replace the old ones
  const IMAGE_WAIT_MS = 1500; // ...but a slow picture never holds the new results back longer than this
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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

  // eager: load the picture now (cards that are not in the page yet are otherwise lazy and would not start loading)
  // instant: no slide-in of its own (a whole new result list fades in as one, see swap in loadNextPage)
  function renderCard(article, eager, instant) {
    // importNode (not cloneNode): elements of a <template> belong to an inert document, where pictures never start loading
    const card = document.importNode(template.content.firstElementChild, true);
    card.dataset.category = article.category; // CSS picks the tag color from this
    if (instant) card.classList.add('no-enter');
    const markRead = () => {
      card.classList.add('is-read');
      card.querySelector('.card-read-badge').hidden = false;
    };
    if (article.viewed) markRead();
    // Mark right away on click, so it's already marked when the user comes back with the Back button
    card.querySelector('.card-link').addEventListener('click', markRead);
    card.querySelector('.card-link').href = '/articles/' + article.id;
    const img = card.querySelector('.card-image');
    if (article.imageUrl) {
      if (eager) img.loading = 'eager';
      img.src = article.imageUrl;
    } else img.remove();
    card.querySelector('.card-category').textContent = article.categoryLabel;
    card.querySelector('.card-title').textContent = article.title;
    card.querySelector('.card-summary').textContent = article.summary;
    card.querySelector('.card-author').textContent = article.author;
    const time = card.querySelector('.card-date');
    time.dateTime = article.publishedAt;
    time.textContent = formatPublished(new Date(article.publishedAt));
    return card;
  }

  // Resolves when the pictures of these cards are loaded (or failed), but never waits longer than `ms`
  function imagesReady(cards, ms) {
    const images = cards.map((card) => card.querySelector('.card-image')).filter((img) => img && !img.complete);
    if (!images.length) return Promise.resolve();
    const loaded = images.map((img) => new Promise((done) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }));
    return Promise.race([Promise.all(loaded), new Promise((done) => setTimeout(done, ms))]);
  }

  // The front page section is hidden while a search / filter is active (the sidebar boxes always stay).
  // It changes together with the cards, so a new search switches the page in one step instead of in stages.
  function applyFrontVisibility() {
    if (state.hideFront === undefined) return; // nothing was searched yet: keep what the server rendered
    if (frontEl) frontEl.hidden = state.hideFront;
  }

  async function loadNextPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const controller = new AbortController();
    state.controller = controller;
    // A new search / filter keeps the old cards on screen. "Loading" (status text + dimmed cards, see aria-busy in CSS)
    // is shown only when the answer is slow, so a quick search just swaps the cards without any flicker.
    const replacing = state.page === 0 && feedEl.children.length > 0;
    let busyTimer;
    if (replacing) {
      busyTimer = setTimeout(() => {
        feedEl.setAttribute('aria-busy', 'true');
        setStatus('טוען כתבות...');
      }, BUSY_DELAY_MS);
    } else {
      setStatus('טוען כתבות...');
    }

    try {
      const res = await fetch(buildUrl(state.page + 1), { signal: controller.signal });
      const data = await res.json();
      if (controller !== state.controller) return; // replaced by a newer search while we waited
      if (!res.ok) throw new Error(data.error || 'שגיאה בטעינת הכתבות');

      const cards = data.articles.map((article, i) => renderCard(article, replacing && i < EAGER_CARDS, replacing));
      // New search / filter: the old cards stay until the pictures of the first new cards are loaded,
      // so the swap shows finished cards, not empty grey boxes that fill in one by one
      if (replacing) {
        await imagesReady(cards.slice(0, EAGER_CARDS), IMAGE_WAIT_MS);
        if (controller !== state.controller) return; // replaced by a newer search while the pictures loaded
      }
      const fragment = document.createDocumentFragment();
      cards.forEach((card) => fragment.appendChild(card));
      if (state.page === 0) {
        // First page of a new search / filter: swap the old cards for the new ones in one step (no empty flash)
        const swap = () => {
          applyFrontVisibility();
          feedEl.replaceChildren(fragment);
          if (feedTitle.getBoundingClientRect().top < 0) feedTitle.scrollIntoView({ block: 'start' });
        };
        if (replacing && document.startViewTransition && !reducedMotion.matches) {
          // The browser cross-fades the old page into the new one (see ::view-transition in CSS) instead of cutting
          feedEl.removeAttribute('aria-busy');
          await document.startViewTransition(swap).updateCallbackDone;
          if (controller !== state.controller) return; // replaced by a newer search during the fade
        } else {
          swap();
        }
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
      if (state.page === 0) applyFrontVisibility();
      setStatus(err.message || 'שגיאה בטעינת הכתבות', true);
      state.hasMore = false;
      showRetry();
    } finally {
      clearTimeout(busyTimer);
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
  //  - the "front page" section is hidden while a search or filter is active. Only the search box and the category bar
  //    change it (updateFront). The dropdowns in "כל הכתבות" leave it as it is: the user is already down in the feed,
  //    and hiding the section above would make the whole page jump
  //  - the active category in the category bar
  function syncPage(updateFront) {
    const filters = currentFilters();
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.viewed !== 'all') params.set('viewed', filters.viewed);
    if (filters.sort !== 'date') params.set('sort', filters.sort);
    const query = params.toString();
    history.replaceState(null, '', query ? '/?' + query : '/');

    if (updateFront) state.hideFront = Boolean(filters.q || filters.category || filters.viewed !== 'all'); // applied when the results arrive
    navLinks.forEach((link) => link.classList.toggle('active', link.dataset.category === filters.category));
  }

  // Start over from page 1 - called whenever search / filter / sort changes
  // updateFront: false for the dropdowns in "כל הכתבות" (the front page section stays as it is)
  function resetFeed(updateFront = true) {
    syncPage(updateFront);
    if (state.controller) state.controller.abort();
    state.page = 0;
    state.hasMore = true;
    state.loading = false;
    state.snapshot = null;
    return loadNextPage(); // the first page replaces the cards that are on screen once it arrives
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
  ['category', 'viewed', 'sort'].forEach((name) => inputs[name].addEventListener('change', () => resetFeed(false)));

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
      resetFeed(); // no scrolling: the page stays where it is, only the front section above is hidden or shown
    });
  });

  // Server-rendered dates in the front section: show "לפני 3 שעות" for recent articles
  document.querySelectorAll('time[data-relative]').forEach((time) => {
    time.textContent = formatPublished(new Date(time.dateTime));
  });

  loadNextPage();
})();
