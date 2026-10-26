# Dispatch Register

Frontend (this repo, GitHub Pages) + Supabase backend. Supabase stores users, the register, recipients and file **links** only. Files live in each user's own Google Drive.

- **Login:** CNIC + password (Supabase Auth). Users are created by the administrator; the initial password is the CNIC and must be changed at first login.
- **First login:** the user confirms their own Gmail, then sees a "Permissions Needed" screen (upload files, create one folder). Google asks once.
- **Files:** a small Apps Script page (`apps-script/`) runs *as the signed-in Google user* and saves the file in that user's Drive, folder "Dispatch Register Files". Scope: `drive.file` only. No Google Cloud console project, no test-user list.
- **Numbering:** assigned by the database per user per calendar year (`fn_create_dispatch`).
- **Recipients:** added by users for their own district / tehsil / wing and shared with users in that scope.
- **Admin:** the Admin tab creates users, resets passwords, suspends accounts, and imports the school list and old dispatch records (dry run first).

## One-time setup of the uploader
1. script.google.com -> New project. Paste `Code.gs`, add an HTML file named `Uploader` with `Uploader.html`, and replace the manifest with `appsscript.json` (Project Settings -> show manifest).
2. Deploy -> New deployment -> Web app: Execute as **User accessing the web app**, Who has access **Anyone with Google account**.
3. Copy the `/exec` URL into `UPLOADER_URL` in `index.html`.

## Repo layout
- `index.html` - the whole frontend (GitHub Pages)
- `compression.js` - no longer used (the uploader shrinks images itself)
- `apps-script/` - Google Apps Script uploader (you deploy it; see steps above)
- `supabase/functions/` - Edge Functions `admin-users`, `change-password`
- `supabase/schema.sql` - reference copy of the database schema

## Not included
Emailing dispatches to offices. It would need a Gmail-sending permission for every user (an extra Google warning screen), so it is left out until requested.

## Sandbox status (branch `supabase-sandbox`)
- Backend: separate Supabase project "Diary dispatch Module" (not connected to any other module).
- `main` is the original Google Apps Script version, untouched.
- Tests: `tests/smoke.js` (run `npm i jsdom@24 && node tests/smoke.js`) exercises login, first-login screens, admin tab and dispatch submit against a mocked backend. Database rules (per-user isolation, recipient scopes, admin-only functions) were tested directly in Supabase.
