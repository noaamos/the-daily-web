// Owner: member 3
// Vanilla JS + fetch() only. No page reloads.
// Edit page autosave: the form is sent to the server a moment after the reporter stops typing.
// Rules: only one request at a time, the newest version always wins, and nothing typed is ever thrown away.
(function () {
  const page = document.querySelector('.edit-page');
  const form = document.getElementById('edit-form');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('save-status');
  const imageHintEl = document.getElementById('image-hint');
  const backLink = document.querySelector('.back-link a');
  const submitBtn = document.getElementById('submit-btn');
  const fieldset = form && form.querySelector('fieldset');
  if (!page || !form || !saveBtn) return; // read-only page: nothing to do

  const DEBOUNCE_MS = 1500;                    // quiet time after the last keystroke
  const MAX_WAIT_MS = 10000;                   // while typing goes on, save at least this often
  const RETRY_MS = [2000, 5000, 10000];        // wait before retrying a failed save (the last one repeats)
  const KEEPALIVE_MAX_BYTES = 60000;           // browsers refuse "keepalive" requests above ~64KB
  const IMAGE_OK = /^https?:\/\//i;

  const url = `/reporter/api/articles/${page.dataset.articleId}/draft`;
  const f = form.elements;

  // everything the reporter typed, as one string: comparing two snapshots tells whether anything changed
  const snapshot = () => JSON.stringify({
    category: f.category.value, title: f.title.value, summary: f.summary.value, body: f.body.value, imageUrl: f.imageUrl.value,
  });

  const state = {
    saving: false,
    stopped: false,                       // true after an error that retrying cannot fix
    leaveAnyway: false,
    retries: 0,
    savedSnapshot: snapshot(),            // what the server has (the page was filled from the server)
    lastValidImage: f.imageUrl.value.trim(),
  };
  let debounceTimer = null;
  let maxTimer = null;
  let retryTimer = null;
  let inflight = Promise.resolve();
  let lastSavedText = '';

  const timeText = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  if (page.dataset.savedAt) {
    lastSavedText = `נשמר לאחרונה ב-${timeText(page.dataset.savedAt)}`;
    showStatus(lastSavedText);
  }

  const isDirty = () => snapshot() !== state.savedSnapshot;

  function clearTimers() {
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
    clearTimeout(retryTimer);
    debounceTimer = maxTimer = retryTimer = null;
  }

  // A half-typed image link ("htt") would make the server reject the whole draft, title and text included.
  // So an invalid link is not sent: the last valid one is kept, and a hint is shown next to the field.
  function updateImageHint() {
    const value = f.imageUrl.value.trim();
    imageHintEl.hidden = !value || IMAGE_OK.test(value);
  }

  function payloadFor(snap) {
    const payload = JSON.parse(snap);
    const image = payload.imageUrl.trim();
    payload.imageUrl = !image || IMAGE_OK.test(image) ? image : state.lastValidImage;
    return payload;
  }

  function failure(message, flags) {
    return Object.assign(new Error(message), flags);
  }

  // Sends one draft. The error it throws says what to do next: .fatal = stop, .retry = try again later
  async function send(payload) {
    let res;
    try {
      res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) {
      throw failure('אין חיבור לשרת', { retry: true }); // fetch() fails with a TypeError when the server cannot be reached
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.ok) return data;
    if ([401, 403, 404, 409].includes(res.status)) throw failure(data.error || 'אי אפשר לשמור את הכתבה', { fatal: true });
    if (res.status >= 500) throw failure(data.error || 'שגיאה בשרת', { retry: true });
    throw failure(res.status === 413 ? 'התוכן ארוך מדי לשמירה' : (data.error || 'השמירה נכשלה'), { retry: false });
  }

  function handleFailure(err) {
    if (err.fatal) {
      state.stopped = true;
      showStatus(`${err.message}. השמירה האוטומטית נעצרה.`, true);
    } else if (err.retry) {
      const wait = RETRY_MS[Math.min(state.retries, RETRY_MS.length - 1)];
      state.retries += 1;
      showStatus(`${err.message}. מנסים שוב בעוד ${wait / 1000} שניות.`, true);
      retryTimer = setTimeout(save, wait);
    } else {
      showStatus(`לא נשמר: ${err.message}`, true); // the next change will try again
    }
  }

  // Saves the current content now. Never runs two requests at the same time.
  function save() {
    clearTimers();
    if (state.stopped || state.saving || !isDirty()) return Promise.resolve();
    state.saving = true;
    showStatus('שומר...');
    const sent = snapshot(); // exactly what is being sent; anything typed from now on is newer
    const payload = payloadFor(sent);
    inflight = send(payload)
      .then((data) => {
        state.savedSnapshot = sent;
        state.lastValidImage = payload.imageUrl;
        state.retries = 0;
        lastSavedText = `נשמר אוטומטית ב-${timeText(data.savedAt)}`;
        showStatus(lastSavedText);
      }, handleFailure)
      .then(() => {
        state.saving = false;
        // typed while the request was running -> send the newer version (a pending retry already covers failures)
        if (!state.stopped && !retryTimer && snapshot() !== sent) schedule();
      });
    return inflight;
  }

  // Runs on every change: waits for a quiet moment, but never longer than MAX_WAIT_MS
  function schedule() {
    if (state.stopped) return;
    if (!isDirty()) { // typed something and undid it
      clearTimers();
      showStatus(lastSavedText);
      return;
    }
    showStatus('יש שינויים שעדיין לא נשמרו...');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(save, DEBOUNCE_MS);
    if (!maxTimer) maxTimer = setTimeout(save, MAX_WAIT_MS);
  }

  // Waits for the running request, then sends what is still missing. True when the server has everything.
  async function flush() {
    while (state.saving) await inflight;
    if (isDirty() && !state.stopped) await save();
    return !isDirty();
  }

  // ---- submitting for approval ----
  let submitting = false;

  async function sendSubmit() {
    let res;
    try {
      res = await fetch(`/reporter/api/articles/${page.dataset.articleId}/submit`, { method: 'POST' });
    } catch (e) {
      throw new Error('אין חיבור לשרת. נסו שוב.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'ההגשה נכשלה');
    return data;
  }

  // Save first, then submit: the server must hold the newest text before the article goes to the editor
  async function submitForApproval() {
    if (submitting) return;
    if (!window.confirm('להגיש את הכתבה לאישור העורך?\nאחרי ההגשה אי אפשר לערוך אותה עד שהעורך יחזיר אותה או יאשר.')) return;
    submitting = true;
    submitBtn.disabled = true;
    saveBtn.disabled = true;
    fieldset.disabled = true; // nothing can be typed while the article is being sent
    showStatus('שומר ושולח לאישור...');
    try {
      state.stopped = false; // a new attempt, even after an earlier autosave error
      state.retries = 0;
      if (!(await flush())) throw new Error('לא הצלחנו לשמור את השינויים האחרונים, לא ניתן להגיש עכשיו');
      await sendSubmit();
      state.stopped = true; // the article belongs to the editor now: no more autosaves, no leave warning
      clearTimers();
      window.location.assign('/reporter?submitted=1'); // the controls stay locked until the browser leaves the page
    } catch (err) {
      showStatus(err.message, true);
      submitting = false;
      submitBtn.disabled = false;
      saveBtn.disabled = false;
      fieldset.disabled = false;
    }
  }

  // ---- reacting to the reporter ----
  form.addEventListener('input', () => { // typing, paste, cut and the category list all fire "input"
    updateImageHint();
    schedule();
  });

  // The "save now" button (and Enter in the title field): an extra, the autosave works without it
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.stopped = false; // a manual click may try again after an error (e.g. after logging in again)
    state.retries = 0;
    flush();
  });

  if (submitBtn) submitBtn.addEventListener('click', submitForApproval);

  // Going back to the list: finish saving first, so the list shows the newest data
  if (backLink) {
    backLink.addEventListener('click', async (event) => {
      if (state.leaveAnyway || (!isDirty() && !state.saving)) return; // nothing to save: normal navigation
      event.preventDefault();
      const ok = state.stopped || await flush();
      if (ok) {
        window.location.assign(backLink.href);
        return;
      }
      state.leaveAnyway = true;
      showStatus('השינויים האחרונים לא נשמרו. לחיצה נוספת על "חזרה" תעזוב את הדף בלי לשמור.', true);
    });
  }

  // Closing, reloading or leaving with something unsaved: the browser asks the reporter first
  window.addEventListener('beforeunload', (event) => {
    if (!state.stopped && (isDirty() || state.saving)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // Last chance while the page is closing: a "keepalive" request survives the page. Too big for that -> the warning above.
  window.addEventListener('pagehide', () => {
    if (state.stopped || !isDirty()) return;
    const body = JSON.stringify(payloadFor(snapshot()));
    if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return;
    fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  });

  // The network is back: do not wait for the next retry timer
  window.addEventListener('online', () => {
    if (retryTimer) save();
  });

  // Tab hidden / phone locked: save right away, the page may never come back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });

  updateImageHint();
})();
