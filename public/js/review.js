// Owner: member 4
// Vanilla JS + fetch() only. Review page actions: edit, approve, return with a note, delete.
(function () {
  const page = document.querySelector('.review-page');
  if (!page) return;
  const id = page.dataset.articleId;
  const $ = (sel) => document.getElementById(sel);
  const toastEl = $('toast');
  const base = `/editor/api/articles/${id}`;

  let toastTimer;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', Boolean(isError));
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
    return data;
  }

  // Run an action with its button disabled; on success show a message and reload (the page is rendered on the server)
  // onError: optional, called with the error (the edit form uses it to write the server's reason next to the buttons)
  async function run(button, request, successMessage, after, onError) {
    button.disabled = true;
    try {
      await request();
      toast(successMessage);
      setTimeout(after || (() => location.reload()), 700);
    } catch (err) {
      toast(err.message, true);
      if (onError) onError(err);
      button.disabled = false;
    }
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  // ---- delete (available for every status) ----
  $('delete-btn').addEventListener('click', (e) => {
    if (!confirm('למחוק את הכתבה, התגובות והסטטיסטיקות שלה? אי אפשר לבטל.')) return;
    run(e.currentTarget, () => api('DELETE', base), 'הכתבה נמחקה', () => { location.href = '/editor'; });
  });

  // the rest only exists for articles waiting for approval
  if (!$('approve-btn')) return;

  $('approve-btn').addEventListener('click', (e) => {
    run(e.currentTarget, () => api('POST', `${base}/approve`), 'הכתבה אושרה ופורסמה');
  });

  // ---- return for fixes ----
  const returnBox = $('return-box');
  $('return-btn').addEventListener('click', () => {
    returnBox.hidden = false;
    $('return-note').focus();
  });
  $('return-cancel').addEventListener('click', () => { returnBox.hidden = true; showError($('return-error'), ''); });
  $('return-send').addEventListener('click', (e) => {
    const note = $('return-note').value.trim();
    if (!note) { showError($('return-error'), 'חובה לכתוב הערה לכתב'); $('return-note').focus(); return; }
    showError($('return-error'), '');
    run(e.currentTarget, () => api('POST', `${base}/return`, { note }), 'הכתבה הוחזרה לכתב');
  });

  // ---- edit the submitted content ----
  const form = $('edit-form');
  const versions = $('versions');
  $('edit-btn').addEventListener('click', () => {
    form.hidden = false;
    versions.hidden = true;
    $('f-title').focus();
  });
  // The three fields the server insists on (title, text, a valid image link): each has a red line under it
  const fieldErrors = { 'f-title': 'title-error', 'f-body': 'body-error', 'f-image': 'image-error' };
  function clearFieldError(fieldId) {
    $(fieldId).classList.remove('invalid');
    $(fieldId).removeAttribute('aria-invalid');
    $(fieldErrors[fieldId]).hidden = true; // the message itself is written in the page (views/editor/review.ejs)
  }
  function markInvalid(fieldId) {
    $(fieldId).classList.add('invalid');
    $(fieldId).setAttribute('aria-invalid', 'true');
    $(fieldErrors[fieldId]).hidden = false;
  }
  Object.keys(fieldErrors).forEach((fieldId) => {
    $(fieldId).addEventListener('input', () => { clearFieldError(fieldId); showError($('edit-error'), ''); });
  });
  $('edit-cancel').addEventListener('click', () => {
    form.hidden = true;
    versions.hidden = false;
    showError($('edit-error'), '');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      title: form.title.value,
      summary: form.summary.value,
      body: form.body.value,
      imageUrl: form.imageUrl.value,
    };
    showError($('edit-error'), '');
    // The same checks as the server (the form is long, so the message is shown right at the field)
    const image = payload.imageUrl.trim();
    const problems = [];
    if (!payload.title.trim()) problems.push('f-title');
    if (!payload.body.trim()) problems.push('f-body');
    if (image && !window.isImageLink(image)) problems.push('f-image');
    Object.keys(fieldErrors).forEach(clearFieldError);
    if (problems.length) {
      problems.forEach(markInvalid);
      $(problems[0]).scrollIntoView({ block: 'center', behavior: 'smooth' });
      $(problems[0]).focus();
      return;
    }
    run(form.querySelector('[type="submit"]'), () => api('PUT', `${base}/draft`, payload), 'השינויים נשמרו', undefined,
      (err) => showError($('edit-error'), err.message));
  });
})();
