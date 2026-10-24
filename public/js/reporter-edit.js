// Owner: member 3
// Vanilla JS + fetch() only. No page reloads.
// Edit page: sends the form to the server (PUT draft). The "save" button is temporary: task 4 replaces it with autosave.
(function () {
  const page = document.querySelector('.edit-page');
  const form = document.getElementById('edit-form');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('save-status');
  if (!page || !form || !saveBtn) return; // read-only page: nothing to do

  const articleId = page.dataset.articleId;
  let saving = false;

  const timeText = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  if (page.dataset.savedAt) showStatus(`נשמר לאחרונה ב-${timeText(page.dataset.savedAt)}`);

  // The values of all fields, in the shape the server expects
  function readForm() {
    const f = form.elements;
    return {
      category: f.category.value,
      title: f.title.value,
      summary: f.summary.value,
      body: f.body.value,
      imageUrl: f.imageUrl.value,
    };
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return; // ignore a second click while a save is running
    saving = true;
    saveBtn.disabled = true;
    showStatus('שומר...');
    try {
      const res = await fetch(`/reporter/api/articles/${articleId}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readForm()),
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok) throw new Error(data.error || 'השמירה נכשלה');
      showStatus(`נשמר ב-${timeText(data.savedAt)}`);
    } catch (err) {
      // fetch() itself fails with a TypeError when the server cannot be reached
      showStatus(err instanceof TypeError ? 'אין חיבור לשרת. נסו שוב.' : err.message, true);
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  form.addEventListener('submit', save);
})();
