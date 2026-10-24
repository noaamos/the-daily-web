// Owner: member 1
// Article page: "more articles you may like". Uses the public feed API that already exists (GET /api/articles):
// first the newest articles of the same category, and if there are fewer than WANT, the newest of the others.
// The current article is never shown. Cards are built with textContent (never innerHTML). If anything fails,
// the section simply stays hidden: the article page works without it.
(function () {
  const section = document.getElementById('related');
  if (!section) return;

  const currentId = section.dataset.articleId;
  const category = section.dataset.category;
  const grid = section.querySelector('.related-grid');
  const WANT = 3;

  async function load(query) {
    const res = await fetch('/api/articles' + query);
    if (!res.ok) throw new Error('feed request failed');
    return (await res.json()).articles;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Same structure and classes as a card in the home page feed
  function renderCard(article) {
    const card = el('article', 'card');
    card.dataset.category = article.category;
    const link = el('a', 'card-link');
    link.href = '/articles/' + article.id;

    const media = el('div', 'card-media');
    if (article.imageUrl) {
      const img = el('img', 'card-image');
      img.src = article.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.width = 800;
      img.height = 450;
      media.append(img);
    }
    const body = el('div', 'card-body');
    body.append(
      el('span', 'cat-label card-category', article.categoryLabel),
      el('h3', 'card-title', article.title),
      el('p', 'card-summary', article.summary),
    );
    link.append(media, body);
    card.append(link);
    return card;
  }

  (async function () {
    try {
      let picks = (await load('?category=' + encodeURIComponent(category))).filter((a) => a.id !== currentId).slice(0, WANT);
      if (picks.length < WANT) {
        const others = (await load('')).filter((a) => a.id !== currentId && !picks.some((p) => p.id === a.id));
        picks = picks.concat(others.slice(0, WANT - picks.length));
      }
      if (!picks.length) return;
      grid.replaceChildren(...picks.map(renderCard));
      section.hidden = false;
    } catch (err) {
      /* no recommendations: leave the section hidden */
    }
  }());
}());
