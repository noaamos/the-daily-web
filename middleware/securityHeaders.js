// Basic security headers without Helmet:
// nosniff: prevents MIME-type sniffing.
// X-Frame-Options: prevents clickjacking via iframes.
// Referrer-Policy: limits referrer information to the domain.
module.exports = function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
};
