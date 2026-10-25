// The one rule for the "image link" of an article, used when a reporter saves a draft and when an editor edits one.
// (The reporter's edit page checks the same rule in the browser, in public/js/reporter-edit.js and image-preview.js.)
// A link is accepted when it starts with http:// or https:// AND is a real address: it must have a host name with at
// least one letter or digit. So "http://", "https://", "http:///", "http://exa mple.com" and "http://." are refused,
// like javascript:, data:, ftp: and relative paths. The server never opens the link; this only keeps nonsense out
// of the database. Whether the picture really loads is shown to the reporter by the preview.
function isValidImageLink(text) {
  if (typeof text !== 'string' || !/^https?:\/\//i.test(text)) return false;
  try {
    const { protocol, hostname } = new URL(text);
    // no space or % in the host: Chrome turns a space into %20 and accepts it, Node refuses it - both must agree
    return (protocol === 'http:' || protocol === 'https:') && /[a-z0-9]/i.test(hostname) && !/[\s%]/.test(hostname);
  } catch (err) {
    return false; // not a valid address (for example a space inside the host name)
  }
}

module.exports = { isValidImageLink };
