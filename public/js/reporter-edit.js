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
  const blockReasonEl = document.getElementById('submit-block-reason'); // next to the buttons: why submitting is not possible
  const backLink = document.querySelector('.back-link a');
  const submitBtn = document.getElementById('submit-btn');
  const discardBtn = document.getElementById('discard-btn'); // only on a published article
  const fieldset = form && form.querySelector('fieldset');
  if (!page || !form || !saveBtn) return; // read-only page: nothing to do

  const DEBOUNCE_MS = 1500;                    // quiet time after the last keystroke
  const MAX_WAIT_MS = 10000;                   // while typing goes on, save at least this often
  const RETRY_MS = [2000, 5000, 10000];        // wait before retrying a failed save (the last one repeats)
  const KEEPALIVE_MAX_BYTES = 60000;           // browsers refuse "keepalive" requests above ~64KB

  // The same rule as the server (services/imageLink.js): http:// or https:// and a real host name.
  // "http://", "https://", "http://exa mple.com" and "http://." are not links.
  function isImageLink(text) {
    if (!/^https?:\/\//i.test(text)) return false;
    try {
      const { protocol, hostname } = new URL(text);
      return (protocol === 'http:' || protocol === 'https:') && /[a-z0-9]/i.test(hostname) && !/[\s%]/.test(hostname);
    } catch (e) {
      return false;
    }
  }

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
    lastSavedAt: page.dataset.savedAt || null, // when the server last saved this draft (null: never saved yet)
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
  // So an invalid link is not sent: the last valid one is kept. While the link is invalid the article cannot be
  // submitted: otherwise it would go to the editor with the OLD link, not the one that is typed in the field.
  const imageLinkIsBad = () => f.imageUrl.value.trim() !== '' && !isImageLink(f.imageUrl.value.trim());

  // The submit button is off while a submit/discard is running, and while the image link is invalid
  function refreshSubmitButton() {
    if (!submitBtn) return;
    submitBtn.disabled = submitting || imageLinkIsBad();
    submitBtn.title = imageLinkIsBad() ? 'אי אפשר להגיש כל עוד קישור התמונה לא תקין' : '';
  }

  // Shows or hides everything that belongs to an invalid image link: the hint, the red field, the reason next to the buttons
  function updateImageHint() {
    const bad = imageLinkIsBad();
    imageHintEl.hidden = !bad;
    f.imageUrl.setAttribute('aria-invalid', String(bad));
    if (blockReasonEl) blockReasonEl.hidden = !bad;
    refreshSubmitButton();
  }

  function payloadFor(snap) {
    const payload = JSON.parse(snap);
    const image = payload.imageUrl.trim();
    payload.imageUrl = !image || isImageLink(image) ? image : state.lastValidImage;
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
        state.lastSavedAt = data.savedAt;
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

  // POST to one of the article's action endpoints (submit, discard); an error answer becomes a thrown Error
  async function postAction(action, failMessage) {
    let res;
    try {
      res = await fetch(`/reporter/api/articles/${page.dataset.articleId}/${action}`, { method: 'POST' });
    } catch (e) {
      throw new Error('אין חיבור לשרת. נסו שוב.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || failMessage);
    return data;
  }
  const sendSubmit = () => postAction('submit', 'ההגשה נכשלה');

  // Save first, then submit: the server must hold the newest text before the article goes to the editor
  async function submitForApproval() {
    if (submitting) return;
    if (imageLinkIsBad()) { // the button is off in this case; this is the second guard
      updateImageHint();
      f.imageUrl.focus();
      return;
    }
    const isUpdate = page.dataset.status === 'published'; // an update of an article that is live
    const question = isUpdate
      ? 'להגיש את העדכון לאישור העורך?\nהציבור ימשיך לראות את הגרסה הקודמת עד שהעורך יאשר. אחרי ההגשה אי אפשר לערוך עד שהעורך יחזיר או יאשר.'
      : 'להגיש את הכתבה לאישור העורך?\nאחרי ההגשה אי אפשר לערוך אותה עד שהעורך יחזיר אותה או יאשר.';
    if (!window.confirm(question)) return;
    submitting = true;
    submitBtn.disabled = true;
    saveBtn.disabled = true;
    if (discardBtn) discardBtn.disabled = true;
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
      refreshSubmitButton();
      saveBtn.disabled = false;
      if (discardBtn) discardBtn.disabled = false;
      fieldset.disabled = false;
    }
  }

  // "Cancel changes" (a published article only): the draft goes back to what the public sees
  async function discardChanges() {
    if (submitting) return;
    if (!window.confirm('לבטל את כל השינויים ולחזור לגרסה שפורסמה?\nמה שכתבת מאז הפרסום יימחק.')) return;
    submitting = true;
    submitBtn.disabled = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    fieldset.disabled = true;
    clearTimers(); // no autosave may run after the draft was reset
    state.stopped = true;
    showStatus('מבטל שינויים...');
    try {
      while (state.saving) await inflight; // a save that is already running has to finish first
      await postAction('discard', 'ביטול השינויים נכשל');
      window.location.reload(); // the page is filled again from the server
    } catch (err) {
      showStatus(err.message, true);
      state.stopped = false;
      submitting = false;
      refreshSubmitButton();
      saveBtn.disabled = false;
      discardBtn.disabled = false;
      fieldset.disabled = false;
    }
  }

  // ---- reacting to the reporter ----
  form.addEventListener('input', () => { // typing, paste, cut and the category list all fire "input"
    updateImageHint();
    schedule();
  });

  // When there is nothing to send (the autosave already did it) the button would look dead: confirm the saved state
  // for a moment instead, then go back to the normal status text
  const CONFIRM_MS = 2500;
  function confirmSaved() {
    // An invalid image link is never sent to the server, so "everything is saved" would not be true
    const bad = imageLinkIsBad();
    const confirmation = bad
      ? 'נשמר, אבל קישור התמונה לא תקין ולא נשמר'
      : `הכול שמור ✓${state.lastSavedAt ? ` (${timeText(state.lastSavedAt)})` : ''}`;
    showStatus(confirmation, bad);
    setTimeout(() => { if (statusEl.textContent === confirmation) showStatus(lastSavedText); }, CONFIRM_MS);
  }

  // The "save now" button (and Enter in the title field): an extra, the autosave works without it
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.stopped = false; // a manual click may try again after an error (e.g. after logging in again)
    state.retries = 0;
    if (!isDirty() && !state.saving) confirmSaved();
    else flush();
  });

  if (submitBtn) submitBtn.addEventListener('click', submitForApproval);
  if (discardBtn) discardBtn.addEventListener('click', discardChanges);

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
