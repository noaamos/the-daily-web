// A few response headers that make browsers a little safer. (Without the `helmet` package: only what is needed here.)
//   nosniff        - the browser must trust the Content-Type we send, and never guess that a file is a script
//   X-Frame-Options - no other site may show our pages inside an <iframe> (clickjacking)
//   Referrer-Policy - other sites (image hosts, fonts) only learn our domain, never the full address of the page
module.exports = function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
};
