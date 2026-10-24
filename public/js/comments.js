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

  // Editor only: the buttons are shown for convenience. The server decides (PUT / DELETE need the editor role),
  // so changing this attribute in the browser only leads to a 403 message.
  const isEditor = section.dataset.isEditor === '1';

  // Builds one <button> (used for the editor's actions)
  function makeButton(label, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  // Builds one <li> for a comment. Only textContent is used for data that came from users.
  function renderComment(comment) {
    const li = document.createElement('li');
    li.className = 'comment';
    li.dataset.id = comment._id;
    showView(li, comment);
    return li;
  }

  // The normal view of a comment (also the way back after editing); `comment` is the last version the server sent
  function showView(li, comment) {
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

    li.replaceChildren(header, text);

    if (isEditor) {
      const status = document.createElement('p');
      status.className = 'comment-status';
      status.setAttribute('role', 'status');

      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const editBtn = makeButton('עריכה', 'btn-outline comment-action');
      const deleteBtn = makeButton('מחיקה', 'btn-outline comment-action comment-delete');
      editBtn.addEventListener('click', () => showEditForm(li, comment));
      deleteBtn.addEventListener('click', () => deleteComment(li, comment, [editBtn, deleteBtn], status));
      actions.append(editBtn, deleteBtn);
      li.append(actions, status);
    }
  }

  // Editor: replaces the comment with a small form (name + text). Values are set with .value, never as HTML.
  function showEditForm(li, comment) {
    const form = document.createElement('form');
    form.className = 'comment-edit';
    form.noValidate = true;

    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = NAME_MAX;
    name.dir = 'auto';
    name.value = comment.authorName;
    name.setAttribute('aria-label', 'שם');

    const text = document.createElement('textarea');
    text.rows = 4;
    text.maxLength = TEXT_MAX;
    text.dir = 'auto';
    text.value = comment.text;
    text.setAttribute('aria-label', 'תגובה');

    const saveBtn = makeButton('שמירה', 'btn-accent comment-action');
    saveBtn.type = 'submit';
    const cancelBtn = makeButton('ביטול', 'btn-outline comment-action');
    const status = document.createElement('p');
    status.className = 'comment-status';
    status.setAttribute('role', 'status');

    const footer = document.createElement('div');
    footer.className = 'comment-actions';
    footer.append(saveBtn, cancelBtn);
    form.append(name, text, footer, status);
    li.replaceChildren(form);
    text.focus();

    cancelBtn.addEventListener('click', () => showView(li, comment));

    // PUT /api/comments/:id { authorName, text } -> the updated comment
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saveBtn.disabled) return;
      const authorName = name.value.trim();
      const newText = text.value.trim();
      if (!authorName || authorName.length > NAME_MAX) return setStatus(status, 'יש להזין שם (עד ' + NAME_MAX + ' תווים)', true);
      if (!newText || newText.length > TEXT_MAX) return setStatus(status, 'יש להזין תגובה (עד ' + TEXT_MAX + ' תווים)', true);

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      setStatus(status, 'שומר…');
      try {
        const res = await fetch('/api/comments/' + encodeURIComponent(comment._id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorName, text: newText }),
        });
        if (res.status === 404) { // somebody already deleted it
          li.remove();
          updateEmptyMessage();
          setStatus(listStatus, 'התגובה כבר לא קיימת (נמחקה).', true);
          return;
        }
        if (!res.ok) {
          setStatus(status, await readError(res), true); // the typed text stays in the form
        } else {
          showView(li, await res.json());
          setStatus(li.querySelector('.comment-status'), 'התגובה עודכנה.');
          return;
        }
      } catch (err) {
        setStatus(status, 'לא ניתן לשמור את התגובה. בדקו את החיבור לאינטרנט.', true);
      }
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    });
  }

  // Editor: DELETE /api/comments/:id (204), after a confirm()
  async function deleteComment(li, comment, buttons, status) {
    if (!window.confirm('למחוק את התגובה של ' + comment.authorName + '?\nאי אפשר לשחזר אותה.')) return;
    buttons.forEach((b) => { b.disabled = true; });
    setStatus(status, 'מוחק…');
    try {
      const res = await fetch('/api/comments/' + encodeURIComponent(comment._id), { method: 'DELETE' });
      if (res.ok || res.status === 404) { // 404: already gone, the list should not show it either
        li.remove();
        updateEmptyMessage();
        if (listEl.children.length > 0) setStatus(listStatus, res.ok ? 'התגובה נמחקה.' : 'התגובה כבר לא קיימת (נמחקה).');
        return;
      }
      setStatus(status, await readError(res), true);
    } catch (err) {
      setStatus(status, 'לא ניתן למחוק את התגובה. בדקו את החיבור לאינטרנט.', true);
    }
    buttons.forEach((b) => { b.disabled = false; });
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
