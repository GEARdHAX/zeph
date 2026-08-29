// Single source of truth for brand strings. "zeph." (lowercase, period) is the
// wordmark shown wherever the product name is rendered as text; "zeph" (no
// period) is used where a period would read oddly (e.g. mid-sentence,
// concatenated with punctuation). Both fall back to these literals when the
// env vars aren't set — VITE_SITE_TITLE/VITE_SITE_BRAND names are kept as-is
// (only their default values changed) so existing deployments' env files
// still work.
export default {
  url: import.meta.env.VITE_BACKEND_URL,
  demo: import.meta.env.VITE_DEMO === 'true',
  appName: import.meta.env.VITE_SITE_TITLE || 'zeph.',
  brand: import.meta.env.VITE_SITE_BRAND || 'zeph.',
  shortName: 'zeph',
  wordmark: 'zeph.',
  showCredits: import.meta.env.VITE_SHOW_CREDITS === 'true',
};
