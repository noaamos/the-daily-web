// Owner: member 2
// Vanilla JS + fetch() only. No page reloads.
// Article page comments: load the list, add a new comment without reloading, show the 3-per-minute limit message.
// User text is always shown with textContent (never as HTML), so a comment like "<script>" is just displayed as text.

(function () {
  const section = document.getElementById('comments');
  if (!section) return;

  const articleId = section.dataset.articleId;
  const apiUrl = '/api/comments/' + encodeURIComponent(articleId);

  const listEl = document.getElementById('comment-list');
  const listStatus = document.getElementById('comment-list-status');
  const form = document.getElementById('comment-form');
  const nameInput = document.getElementById('comment-name');
  const textInput = document.getElementById('comment-text');
  const submitBtn = form.querySelector('button[type="submit"]');
  const formStatus = document.getElementById('comment-form-status');

  const NAME_MAX = 50;   // same limits as the server (controllers/commentController.js)
  const TEXT_MAX = 1000;
  const dateFormat = new Intl.DateTimeFormat('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  let waitTimer = null; // countdown while the rate limit is active

  // Shows a message under the list / form. isError -> red text.
  function setStatus(el, message, isError) {
    el.textContent = message;
    el.classList.toggle('is-error', Boolean(isError));
  }

  // Builds one <li> for a comment. Only textContent is used for data that came from users.
  function renderComment(comment) {
    const li = document.createElement('li');
    li.className = 'comment';

    const header = document.createElement('p');
    header.className = 'comment-meta';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.dir = 'auto'; // the page is RTL, but a name / comment may be written in English
    author.textContent = comment.authorName;

    const time = document.createElement('time');
    const date = new Date(comment.createdAt);
    time.dateTime = date.toISOString();
    time.textContent = dateFormat.format(date);

    header.append(author, ' · ', time);

    const text = document.createElement('p');
    text.className = 'comment-text';
    text.dir = 'auto';
    text.textContent = comment.text;

    li.append(header, text);
    return li;
  }

  function updateEmptyMessage() {
    if (listEl.children.length === 0) setStatus(listStatus, 'אין עדיין תגובות. היו הראשונים להגיב!');
    else setStatus(listStatus, '');
  }

  // Reads { error } from the server's JSON response, or returns a general message
  async function readError(res) {
    try {
      const body = await res.json();
      if (body && body.error) return body.error;
    } catch (e) { /* response was not JSON */ }
    return 'אירעה שגיאה. נסו שוב מאוחר יותר.';
  }

  // GET /api/comments/:articleId -> { comments: [...] } (oldest first)
  async function loadComments() {
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        setStatus(listStatus, await readError(res), true);
        return;
      }
      const data = await res.json();
      listEl.replaceChildren(...data.comments.map(renderComment));
      updateEmptyMessage();
    } catch (err) {
      setStatus(listStatus, 'לא ניתן לטעון את התגובות. בדקו את החיבור לאינטרנט.', true);
    }
  }

  // After a 429: keep the button disabled and count down until the server allows a new comment
  function startWaiting(seconds, message) {
    clearInterval(waitTimer);
    let left = seconds;
    submitBtn.disabled = true;
    setStatus(formStatus, message, true);

    waitTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setStatus(formStatus, 'אפשר יהיה לפרסם תגובה שוב בעוד ' + left + ' שניות.', true);
        return;
      }
      clearInterval(waitTimer);
      submitBtn.disabled = false;
      setStatus(formStatus, 'אפשר לפרסם תגובה שוב.');
    }, 1000);
  }

  // POST /api/comments/:articleId { authorName, text } -> 201 + the new comment
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const authorName = nameInput.value.trim();
    const text = textInput.value.trim();

    // Quick check in the browser; the server checks again
    if (!authorName || authorName.length > NAME_MAX) {
      setStatus(formStatus, 'יש להזין שם (עד ' + NAME_MAX + ' תווים)', true);
      nameInput.focus();
      return;
    }
    if (!text || text.length > TEXT_MAX) {
      setStatus(formStatus, 'יש להזין תגובה (עד ' + TEXT_MAX + ' תווים)', true);
      textInput.focus();
      return;
    }

    submitBtn.disabled = true;
    setStatus(formStatus, 'שולח…');

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName, text }),
      });

      if (res.status === 429) {
        // Rate limit - the typed text stays in the form so nothing is lost
        const body = await res.json().catch(() => ({}));
        const seconds = Number(body.retryAfter) || Number(res.headers.get('Retry-After')) || 60;
        startWaiting(seconds, body.error || 'אפשר יהיה לפרסם תגובה שוב בעוד ' + seconds + ' שניות.');
        return;
      }

      if (!res.ok) {
        setStatus(formStatus, await readError(res), true);
        submitBtn.disabled = false;
        return;
      }

      const comment = await res.json();
      listEl.append(renderComment(comment));
      updateEmptyMessage();
      textInput.value = '';   // keep the name for the next comment
      setStatus(formStatus, 'התגובה פורסמה!');
      submitBtn.disabled = false;
    } catch (err) {
      setStatus(formStatus, 'לא ניתן לשלוח את התגובה. בדקו את החיבור לאינטרנט.', true);
      submitBtn.disabled = false;
    }
  });

  loadComments();
}());
