# Dispatch Register

Frontend (this repo, GitHub Pages) + Supabase backend.

- **Login:** CNIC + password (Supabase Auth). Users are created by the administrator; the initial password is the CNIC and must be changed at first login.
- **First login:** each user confirms their own Gmail and grants Google Drive access once (`drive.file` scope). Attachments are saved in the user's own Drive; only the file reference is stored in Supabase.
- **Numbering:** assigned by the database per user per calendar year (`fn_create_dispatch`), never by the browser.
- **Recipients:** added by users for their own district / tehsil / wing and shared with users in that scope.
- **Admin:** the Admin tab creates users, resets passwords and suspends accounts through the `admin-users` Edge Function.

No secrets are stored in this repo. The Supabase publishable key in `index.html` is public by design; access is enforced by Row Level Security.

Google Cloud setup required: add the scope `.../auth/drive.file` to the OAuth consent screen, add every user's Gmail as a test user while the app is in Testing mode, and keep the GitHub Pages origin under "Authorized JavaScript origins".
