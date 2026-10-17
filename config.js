// Rita Arrangers — app configuration.
// server: true  → the live site on Vercel. Records are kept in your Google Sheet through the
//                 site's server functions (/api), and the PIN is asked every time the app opens.
//                 PIN, Apps Script URL and server key are Vercel environment variables:
//                 APP_PIN, APPS_SCRIPT_URL, API_SECRET (see README → "Vercel environment variables").
// server: false → local development only; data stays in this browser.
window.RA_CONFIG = {
  server: true,
};
