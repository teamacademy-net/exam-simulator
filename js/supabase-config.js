// Supabase connection settings.
// Paste the two values from your Supabase project (see the setup guide, step 2).
// Both are SAFE to publish: the publishable key only works within the
// security rules created by supabase/setup.sql.
// NEVER put the "secret" or "service_role" key in this file.
window.SUPABASE_CONFIG = {
  url: 'PASTE_YOUR_PROJECT_URL_HERE',              // looks like https://abcdefghijkl.supabase.co
  publishableKey: 'PASTE_YOUR_PUBLISHABLE_KEY_HERE' // starts with sb_publishable_ (or a long "anon" key starting eyJ)
};
