// Shared image URL validation for reporter and editor forms.
// Accepts only HTTP(S) URLs with valid hostnames; rejects invalid or relative URLs.
// Validates URL format only; the browser preview checks if the image loads.
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
