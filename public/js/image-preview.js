// Owner: member 3
// Reporter edit page: shows the picture behind the "image link" field, so a link that does not work is noticed before
// the article is submitted. Only a valid http:// or https:// address is ever loaded (the server accepts nothing
// else); any other text is explained by the red hint under the field. Runs on read-only pages too.
(function () {
  const input = document.getElementById('f-image');
  const box = document.getElementById('image-preview');
  if (!input || !box) return;
  const img = document.getElementById('image-preview-img');
  const statusEl = document.getElementById('image-preview-status');

  const isImageLink = window.isImageLink; // the rule is shared with the server's, see image-link.js
  const TYPING_DELAY_MS = 500; // wait until the reporter stops typing, so half a link is not loaded
  let timer;
  let attempt = 0; // a newer link makes the answer of an older one irrelevant

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', Boolean(isError));
    statusEl.hidden = !text;
  }

  function hideAll() {
    box.hidden = true;
    img.hidden = true;
    img.removeAttribute('src');
  }

  function update() {
    const mine = ++attempt;
    const link = input.value.trim();
    if (!link || !isImageLink(link)) return hideAll(); // nothing to show

    box.hidden = false;
    img.hidden = true;
    img.removeAttribute('src');
    showStatus('טוען תצוגה מקדימה...');
    const probe = new Image(); // loaded off-screen first, so the box never shows a broken-picture icon
    probe.onload = () => {
      if (mine !== attempt) return;
      img.src = link; // already in the browser cache
      img.hidden = false;
      showStatus('');
    };
    probe.onerror = () => {
      if (mine !== attempt) return;
      showStatus('התמונה לא נטענה. בדקו שהקישור נכון ושהוא מוביל ישירות לקובץ תמונה.', true);
    };
    probe.src = link;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const link = input.value.trim();
    if (link && isImageLink(link)) timer = setTimeout(update, TYPING_DELAY_MS); // wait for the end of the typing, then load
    else update(); // nothing valid to show: the old picture must not stay on screen
  });
  update();
})();
