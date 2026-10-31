# One-time setup: Google Drive + Brevo + Supabase secrets

## 1. Google Cloud (Drive only)
1. console.cloud.google.com -> New project `Dispatch Register`.
2. APIs & Services -> Library -> enable **Google Drive API**.
3. Google Auth Platform -> Branding: app name, support email, home page `https://mwaqas3341-aeo.github.io/Dispatch-Register/`,
   privacy link `.../privacy.html`, terms link `.../terms.html`, authorized domain `github.io`, developer email. Save.
4. Data Access -> scopes: `openid`, `.../auth/userinfo.email`, `.../auth/drive.file` only.
5. Audience -> **Publish app** (status must be "In production"; Testing mode expires tokens after 7 days).
6. Clients -> Create client -> Web application. Authorized redirect URI (exact):
   `https://btjtojkhiwemcnssdoih.supabase.co/functions/v1/drive`
   Copy the Client ID and Client secret.

## 2. Brevo
1. Senders, Domains & Dedicated IPs -> Senders -> add and verify one sender address.
2. SMTP & API -> API Keys -> generate a key (`xkeysib-...`). Turn off Authorised-IP blocking (Security).

## 3. Supabase -> Edge Functions -> Secrets
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY` (`openssl rand -base64 32`; never change later),
`APP_URL` (the app address ending with `/`), `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (optional).

## 4. Test
Connect Drive from the cloud icon, save a dispatch with a PDF to an office you control, check the email and the Drive folders.
