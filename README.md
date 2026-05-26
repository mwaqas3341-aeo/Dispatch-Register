# Dispatch Register — GitHub Pages Edition

This is the **GitHub Pages front-end** for the Dispatch Register system.
It talks to a **separate Google Apps Script REST API** (the `gas-api/ApiCode.gs` file)
while leaving your original GAS web app **completely unchanged**.

---

## Architecture

```
[GitHub Pages — index.html]
       │  fetch() POST  (no CORS preflight — uses text/plain body)
       ▼
[GAS REST API — ApiCode.gs]   ← NEW, separate GAS project
       │
       ├── Validates Google ID Token (tokeninfo endpoint)
       ├── Reads/writes user Sheets in developer's Drive
       └── Sends emails via GmailApp (from developer's Gmail)

[Original GAS Web App — Code.gs]   ← UNTOUCHED, still works for all existing users
```

**Key differences from the original GAS version:**

| Feature | Original GAS Web App | GitHub Pages Version |
|---|---|---|
| Auth | Google session (automatic) | Google Sign-In (ID Token) |
| Spreadsheet location | User's own Drive | Developer's Drive (per-user folder) |
| Email sender | User's Gmail | Developer's Gmail |
| Frontend URL | `script.google.com/...` | `yourusername.github.io/...` |

---

## Step 1 — Create a Google Cloud OAuth Client ID

> This is needed so GitHub Pages can show the Google Sign-In button.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing one linked to your GAS)
3. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in App name, support email, developer email
   - Scopes: add `openid`, `email`, `profile` (no Drive/Gmail scopes needed — API handles those)
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Name: `Dispatch Register GitHub Pages`
   - Authorised JavaScript origins — add ALL of these:
     ```
     https://yourusername.github.io
     http://localhost
     http://localhost:3000
     ```
   - Authorised redirect URIs — leave blank (we use One Tap, not redirect)
5. Click **Create** → copy the **Client ID** (looks like `123456-abc.apps.googleusercontent.com`)

---

## Step 2 — Deploy the GAS REST API

1. Go to [script.google.com](https://script.google.com) and click **New Project**
2. Name it: `Dispatch Register API`
3. Delete the default `Code.gs` content
4. Paste the contents of `gas-api/ApiCode.gs` (from this repo) into it
5. At the top of the file, fill in:
   ```javascript
   var ADMIN_EMAIL  = 'your-real-email@gmail.com';
   var MASTER_SS_ID = '1Iv4XDnS8XBSSzFmJxFQ4R00kx0WppBVtkic6mJujJOc'; // keep your existing ID
   ```
6. Click **Deploy → New deployment**
   - Type: **Web app**
   - Description: `v1`
   - Execute as: **Me (your Google account)**  ← IMPORTANT
   - Who has access: **Anyone**               ← IMPORTANT
7. Click **Deploy** → **Authorize** (grant Drive, Sheets, Gmail access)
8. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

---

## Step 3 — Configure index.html

Open `index.html` and find the CONFIG block near the top of the `<script>` section:

```javascript
// ═══════════════════════════════════════════
//  ★ EDIT THESE TWO VALUES ★
// ═══════════════════════════════════════════
var GAS_API_URL      = 'PASTE_YOUR_GAS_WEBAPP_URL_HERE';
var GOOGLE_CLIENT_ID = 'PASTE_YOUR_OAUTH_CLIENT_ID_HERE';
```

Replace both placeholder strings with the values from Steps 1 and 2.

---

## Step 4 — Push to GitHub Pages

```bash
git init
git add .
git commit -m "Initial Dispatch Register GitHub Pages"
git remote add origin https://github.com/yourusername/dispatch-register.git
git push -u origin main
```

Then in your GitHub repo:
- Go to **Settings → Pages**
- Source: **Deploy from a branch** → `main` → `/ (root)`
- Click **Save**

Your site will be live at `https://yourusername.github.io/dispatch-register/`

---

## Notes & Limitations

- **Token expiry**: The Google ID token lasts ~1 hour. The app will prompt re-sign-in automatically.
- **Email sender**: Emails are sent from the **developer's** Gmail, not each user's Gmail.
- **Data storage**: All spreadsheets are created in the **developer's** Google Drive, inside a folder `Dispatch Register Users/<user-email>/`. This is intentional — it avoids needing Drive access on each user's account.
- **Existing users unaffected**: The original `Code.gs` / GAS Web App is not touched at all.
- **CORS**: Works because the fetch body is sent as `text/plain` (no `Content-Type: application/json` header), which avoids CORS preflight. GAS responds with `Access-Control-Allow-Origin: *`.
- **Privacy**: The developer can access all user spreadsheets (since they're in developer's Drive). Make sure all users are aware of this if deploying for others.

---

## File Structure

```
dispatch-github-pages/
├── .nojekyll            ← disables Jekyll
├── README.md            ← this file
├── index.html           ← GitHub Pages frontend
└── gas-api/
    └── ApiCode.gs       ← paste into new GAS project
```
