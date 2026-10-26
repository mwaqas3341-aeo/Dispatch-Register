# Dispatch Register

Frontend (this repo, GitHub Pages) + Supabase backend. No Google services are used.

- **Login:** CNIC + password (Supabase Auth). Users are created by the administrator; the initial password is the CNIC and must be changed at first login.
- **Permissions screen:** shown once per user (upload files, create folders, private storage). Consent is recorded in the database and enforced by the storage policies.
- **Files:** stored in a private Supabase Storage bucket, one folder per user, then one folder per dispatch. Only the owner can open them (short-lived signed links).
- **Numbering:** assigned by the database per user per calendar year (`fn_create_dispatch`), never by the browser.
- **Recipients:** added by users for their own district / tehsil / wing and shared with users in that scope.
- **Admin:** the Admin tab creates users, resets passwords and suspends accounts through the `admin-users` Edge Function.

No secrets are stored here. The Supabase publishable key in `index.html` is public by design; access is enforced by Row Level Security.
