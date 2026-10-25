// Editor user management: search, create, edit, and delete users via /api/users.
// Uses fetch() without page reloads and textContent to prevent HTML injection.
(function () {
  const page = document.querySelector('.users-page');
  if (!page) return;

  const currentUserId = page.dataset.currentUserId; // the logged-in editor (from the view, no extra API)
  const $ = (id) => document.getElementById(id);

  const rowsEl = $('user-rows');
  const statusEl = $('users-status');
  const searchInput = $('user-search');
  const newBtn = $('new-user-btn');
  const toastEl = $('toast');

  const form = $('user-form');
  const formTitle = $('user-form-title');
  const formError = $('user-form-error');
  const saveBtn = $('user-save');
  const fields = {
    username: $('u-username'),
    displayName: $('u-display'),
    role: $('u-role'),
    password: $('u-password'),
  };
  const roleNote = $('u-role-note');
  const passwordNote = $('u-password-note');

  // Same rules as controllers/userController.js - the server checks again
  const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
  const PASSWORD_MIN = 6;
  const DISPLAY_NAME_MAX = 50;
  const ROLE_LABELS = { reporter: 'כתב', editor: 'עורך' };
  const SEARCH_DELAY_MS = 300;

  let editing = null;   // the user being edited, or null when creating a new one
  let requestId = 0;    // ignore answers of old searches that arrive late

  // ---- small helpers ----
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
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

  // fetch + JSON. DELETE answers 204 with no body, so the body is read only when there is one.
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
    return data;
  }

  const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---- list ----
  function buildRow(u) {
    const isSelf = u._id === currentUserId;

    const name = el('span', { class: 'user-name', text: u.displayName });
    const title = el('p', { class: 'row-title' }, [name]);
    if (isSelf) title.append(' ', el('span', { class: 'user-self', text: '(את/ה)' }));

    const meta = el('div', { class: 'row-meta' }, [
      el('span', { class: 'user-username', text: '@' + u.username }),
      el('span', { text: 'נוצר ' + dateFormat.format(new Date(u.createdAt)) }),
    ]);

    const badge = el('span', { class: 'badge badge-' + u.role, text: ROLE_LABELS[u.role] || u.role });

    const editBtn = el('button', { type: 'button', class: 'btn-outline', text: 'עריכה' });
    editBtn.addEventListener('click', () => openForm(u));

    const deleteBtn = el('button', { type: 'button', class: 'btn-outline btn-danger', text: 'מחיקה' });
    if (isSelf) {
      deleteBtn.disabled = true;
      deleteBtn.title = 'לא ניתן למחוק את המשתמש המחובר';
    }
    deleteBtn.addEventListener('click', () => removeUser(u, deleteBtn));

    return el('li', { class: 'article-row' }, [
      el('div', { class: 'row-main' }, [title, meta]),
      el('div', { class: 'row-status' }, [badge]),
      el('div', { class: 'row-actions' }, [editBtn, deleteBtn]),
    ]);
  }

  // GET /api/users?q= -> { users: [...] }
  async function loadUsers() {
    const id = ++requestId;
    const q = searchInput.value.trim();
    statusEl.textContent = 'טוען...';
    statusEl.hidden = false;
    try {
      const data = await api('GET', '/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      if (id !== requestId) return; // a newer search already started
      rowsEl.replaceChildren(...data.users.map(buildRow));
      if (data.users.length) statusEl.hidden = true;
      else statusEl.textContent = q ? 'לא נמצאו משתמשים מתאימים לחיפוש' : 'אין משתמשים במערכת';
    } catch (err) {
      if (id !== requestId) return;
      statusEl.textContent = err.message;
      toast(err.message, true);
    }
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, SEARCH_DELAY_MS);
  });

  // ---- create / edit form ----
  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  // user = null -> new user, otherwise edit that user
  function openForm(user) {
    editing = user;
    const isSelf = Boolean(user) && user._id === currentUserId;

    formTitle.textContent = user ? 'עריכת משתמש: ' + user.displayName : 'משתמש חדש';
    fields.username.value = user ? user.username : '';
    fields.displayName.value = user ? user.displayName : '';
    fields.role.value = user ? user.role : 'reporter';
    fields.password.value = '';

    // The server does not allow changing your own role
    fields.role.disabled = isSelf;
    roleNote.hidden = !isSelf;
    passwordNote.textContent = user ? 'השאירו ריק כדי לא לשנות את הסיסמה' : 'לפחות ' + PASSWORD_MIN + ' תווים';

    showFormError('');
    form.hidden = false;
    fields.username.focus();
  }

  function closeForm() {
    form.hidden = true;
    editing = null;
    fields.password.value = '';
    showFormError('');
  }

  newBtn.addEventListener('click', () => openForm(null));
  const cancelBtn = $('user-cancel');
  cancelBtn.addEventListener('click', closeForm);

  // Reads the form. Returns { body } with the fields to send, or { error } with a Hebrew message.
  function readForm() {
    const username = fields.username.value.trim().toLowerCase();
    const displayName = fields.displayName.value.trim();
    const role = fields.role.value;
    const password = fields.password.value;

    if (!USERNAME_RE.test(username)) return { error: 'שם משתמש: 3-30 תווים, אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון' };
    if (!displayName || displayName.length > DISPLAY_NAME_MAX) return { error: 'יש להזין שם תצוגה (עד ' + DISPLAY_NAME_MAX + ' תווים)' };
    if ((!editing || password) && password.length < PASSWORD_MIN) return { error: 'הסיסמה חייבת להכיל לפחות ' + PASSWORD_MIN + ' תווים' };

    if (!editing) return { body: { username, displayName, role, password } };

    // Edit: send only what changed (PUT /api/users/:id updates only the sent fields)
    const body = {};
    if (username !== editing.username) body.username = username;
    if (displayName !== editing.displayName) body.displayName = displayName;
    if (!fields.role.disabled && role !== editing.role) body.role = role;
    if (password) body.password = password;
    return { body };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { body, error } = readForm();
    if (error) {
      showFormError(error);
      return;
    }
    if (editing && Object.keys(body).length === 0) {
      closeForm();
      toast('לא בוצעו שינויים');
      return;
    }

    saveBtn.disabled = true;
    cancelBtn.disabled = true; // closing the form mid-save would hide the result of the request
    showFormError('');
    try {
      if (editing) {
        await api('PUT', '/api/users/' + encodeURIComponent(editing._id), body);
        toast('השינויים נשמרו');
      } else {
        await api('POST', '/api/users', body);
        toast('המשתמש נוצר');
      }
      closeForm();
      loadUsers();
    } catch (err) {
      showFormError(err.message); // e.g. 409 "שם המשתמש כבר קיים במערכת"
      toast(err.message, true);
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  // ---- delete ----
  async function removeUser(u, button) {
    if (!confirm('למחוק את המשתמש "' + u.displayName + '" (@' + u.username + ')? אי אפשר לבטל.')) return;
    button.disabled = true;
    try {
      await api('DELETE', '/api/users/' + encodeURIComponent(u._id)); // 204, no body
      if (editing && editing._id === u._id) closeForm();
      toast('המשתמש נמחק');
      loadUsers();
    } catch (err) {
      toast(err.message, true); // e.g. 409 "לא ניתן למחוק משתמש שיש לו כתבות במערכת"
      button.disabled = false;
    }
  }

  loadUsers();
}());
