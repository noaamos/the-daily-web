// The one rule for an image link in the browser, shared by the reporter's edit page (reporter-edit.js,
// image-preview.js) and the editor's edit form (review.js). It is the same rule as the server's
// (services/imageLink.js): http:// or https:// and a real host name.
// "http://", "https://", "http://exa mple.com" and "http://." are not links. Load this file before the others.
window.isImageLink = function isImageLink(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === 'http:' || protocol === 'https:') && /[a-z0-9]/i.test(hostname) && !/[\s%]/.test(hostname);
  } catch (e) {
    return false;
  }
};
