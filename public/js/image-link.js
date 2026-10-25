// Shared image URL validation for reporter and editor forms.
// Requires HTTP(S) and a valid hostname, matching server-side validation.
// Load before reporter-edit.js, image-preview.js, and review.js.
window.isImageLink = function isImageLink(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === 'http:' || protocol === 'https:') && /[a-z0-9]/i.test(hostname) && !/[\s%]/.test(hostname);
  } catch (e) {
    return false;
  }
};
