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

## Google Drive storage and Action Taken (Reports)
No Google Apps Script or Google Sheets is used any more. Supabase is the backend; every user's documents live in their own Google Drive.
- **Edge Function `drive`** (`supabase/functions/drive`, deployed with verify_jwt off because it authenticates itself): Google OAuth (scope `drive.file`), encrypted refresh tokens (AES-256-GCM), upload / view / download / delete, disconnect. The browser never sees a Google token, and documents are streamed through the function after an ownership check (no public Drive links).
- **Drive layout** (created on demand): `Dispatch_Register/Reports/Report_<year>-<no>/Supporting_Documents`, `.../Inquiries/Inquiry_<n>/Action_Documents`, `.../Main_Document`.
- **Reports**: folder button per row opens *Action Taken / Inquiries* (unlimited inquiries per report, each with its own documents) and *Supporting Documents* (PDF/JPG/JPEG/PNG, 10 MB each, batch upload with progress). Header cloud icon = Drive connection settings (connect, reconnect, disconnect).
- Metadata only is stored in Supabase (`dispatch_documents`, `dispatch_inquiries`, `google_drive_connections`). The browser cannot insert or edit document rows; only the Edge Function can, after a real upload. A failed database write removes the Drive file again.
- **Email**: when a dispatch is saved, the Edge Function emails each selected office (office + personal address) through the Brevo transactional API, attaching the report's main file (read from the user's Drive). The sender is one Brevo-verified address (shown as "<user name> via Dispatch Register") and the user's Gmail is the reply-to. Per-office status (`sent` / `failed` / `no_email`) is kept in `dispatch_recipients`; the envelope button in Reports retries only offices not yet emailed. Supporting and inquiry documents are not emailed.
- Deleting a document moves the Drive file to the user's Drive Trash and marks the record deleted. Disconnecting keeps every record and file.

### One-time setup
1. Google Cloud console: create a project, enable **Google Drive API**, configure the OAuth consent screen (External; scopes `openid`, `email`, `.../auth/drive.file`; these are non-sensitive, so **Publish app** to "In production" with no Google review - in Testing mode Google expires refresh tokens after 7 days), create an **OAuth client ID (Web application)** with redirect URI `https://<project-ref>.supabase.co/functions/v1/drive`.
2. Supabase secrets (Edge Functions > Secrets): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY` (run `openssl rand -base64 32`; never change it after users connect), `APP_URL` (the GitHub Pages URL of the app, ending with `/`), `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (a sender verified in Brevo), optional `BREVO_SENDER_NAME`.
3. Run the two SQL files in `supabase/migrations/` (already applied to the sandbox project).
- Tests: `node tests/inquiries.js` (UI, jsdom), `deno test --allow-all tests/drive-fn.test.ts` (Edge Function with mocked Supabase and Google).

## Not included

## Sandbox status (branch `supabase-sandbox`)
- Backend: separate Supabase project "Diary dispatch Module" (not connected to any other module).
- `main` is the original Google Apps Script version, untouched.
- Tests: `tests/smoke.js` (run `npm i jsdom@24 && node tests/smoke.js`) exercises login, first-login screens, admin tab and dispatch submit against a mocked backend. Database rules (per-user isolation, recipient scopes, admin-only functions) were tested directly in Supabase.
