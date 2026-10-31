// Dispatch Register - Google Drive gateway (Supabase Edge Function, deploy with verify_jwt = false).
// The browser never sees Google tokens. Each user's files live in THEIR OWN Google Drive (scope drive.file).
//   POST ?a=start       -> { url }  Google consent URL (state saved server-side)
//   GET  ?code&state    -> OAuth callback: stores encrypted refresh token, creates Dispatch_Register/Reports, redirects to APP_URL
//   POST ?a=upload      -> multipart (file, kind, dispatch_id, inquiry_id?)  uploads to the user's Drive, then records metadata
//   POST ?a=file        -> { id, download? } streams the file after an ownership check
//   POST ?a=delete      -> { id } trashes the Drive file, then marks the record deleted
//   POST ?a=disconnect  -> revokes the token and keeps all report/document metadata
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENC_KEY (base64, 32 bytes), APP_URL.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MAX_BYTES = 10 * 1024 * 1024;
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const ROOT_NAME = "Dispatch_Register";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, msg: string, public code?: string) { super(msg); }
}
const RECONNECT = () => new HttpError(409, "Your Google Drive connection has expired or was revoked. Please reconnect Google Drive.", "DRIVE_RECONNECT");

const env = (k: string) => { const v = Deno.env.get(k); if (!v) throw new HttpError(500, `Server is missing ${k}`); return v; };
const db = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// ---------- token encryption (AES-256-GCM) ----------
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u: Uint8Array) => btoa(String.fromCharCode(...u));
async function aesKey() {
  const raw = b64d(env("TOKEN_ENC_KEY"));
  if (raw.length !== 32) throw new HttpError(500, "TOKEN_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64e(out);
}
async function decrypt(enc: string) {
  const all = b64d(enc);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(), all.slice(12));
  return new TextDecoder().decode(pt);
}

// ---------- auth ----------
async function authUser(req: Request, admin: ReturnType<typeof db>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Please sign in again.");
  const { data: me } = await admin.from("user_profiles")
    .select("id, full_name, status, gmail_address, must_change_password").eq("id", data.user.id).maybeSingle();
  if (!me || me.status !== "active" || me.must_change_password) throw new HttpError(403, "Account not active");
  return me as { id: string; full_name: string; gmail_address: string | null };
}

// ---------- Google ----------
const redirectUri = () => `${env("SUPABASE_URL")}/functions/v1/drive`;
async function googleToken(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), ...params }),
  });
  return { ok: r.ok, body: await r.json().catch(() => ({})) as Record<string, string> };
}
async function accessToken(admin: ReturnType<typeof db>, userId: string) {
  const { data: c } = await admin.from("google_drive_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!c || c.connection_status !== "connected" || !c.refresh_token_enc) throw RECONNECT();
  const t = await googleToken({ grant_type: "refresh_token", refresh_token: await decrypt(c.refresh_token_enc) });
  if (!t.ok) {
    if (t.body.error === "invalid_grant") {
      await admin.from("google_drive_connections").update({ connection_status: "needs_reconnect", updated_at: new Date().toISOString() }).eq("user_id", userId);
      throw RECONNECT();
    }
    throw new HttpError(502, "Google could not refresh access. Try again shortly.");
  }
  return { token: t.body.access_token, conn: c };
}
const gh = (token: string) => ({ Authorization: `Bearer ${token}` });
async function gjson(r: Response, what: string) {
  if (r.status === 401) throw RECONNECT();
  if (!r.ok) throw new HttpError(502, `Google Drive error while ${what} (${r.status})`);
  return await r.json();
}
async function findOrCreateFolder(token: string, name: string, parent: string) {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parent}' in parents and trashed=false`;
  const list = await gjson(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: gh(token) }), "finding a folder");
  if (list.files?.length) return list.files[0].id as string;
  const made = await gjson(await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { ...gh(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  }), "creating a folder");
  return made.id as string;
}
async function ensureRoot(token: string, admin: ReturnType<typeof db>, userId: string, stored: string | null) {
  if (stored) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${stored}?fields=id,trashed`, { headers: gh(token) });
    if (r.ok && !(await r.json()).trashed) return stored;
  }
  const root = await findOrCreateFolder(token, ROOT_NAME, "root");
  await admin.from("google_drive_connections").update({ root_folder_id: root, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return root;
}

// ---------- validation ----------
function sniff(b: Uint8Array): string | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const safeSeg = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");

async function handleStart(req: Request, admin: ReturnType<typeof db>) {
  const me = await authUser(req, admin);
  if (!me.gmail_address) throw new HttpError(400, "Confirm your Gmail address first.");
  const state = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  await admin.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  const { error } = await admin.from("oauth_states").insert({ state, user_id: me.id });
  if (error) throw new HttpError(500, "Could not start the connection.");
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", state, login_hint: me.gmail_address,
  });
  return json({ url });
}

async function handleCallback(url: URL, admin: ReturnType<typeof db>) {
  const back = (ok: boolean, msg = "") => Response.redirect(`${env("APP_URL")}?drive=${ok ? "connected" : "error"}${msg ? "&m=" + encodeURIComponent(msg) : ""}`, 302);
  try {
    if (url.searchParams.get("error")) return back(false, "Google access was not granted.");
    const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
    const { data: st } = await admin.from("oauth_states").select("user_id, created_at").eq("state", state).maybeSingle();
    if (!st || Date.now() - new Date(st.created_at).getTime() > 10 * 60_000) return back(false, "Connection link expired. Please try again.");
    await admin.from("oauth_states").delete().eq("state", state);
    const { data: me } = await admin.from("user_profiles").select("id, gmail_address, status").eq("id", st.user_id).maybeSingle();
    if (!me || me.status !== "active") return back(false, "Account not active.");
    const t = await googleToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    if (!t.ok || !t.body.access_token) return back(false, "Google rejected the sign-in. Please try again.");
    if (!String(t.body.scope || "").includes("auth/drive.file")) return back(false, "Drive permission was not granted. Please tick the permission box and try again.");
    if (!t.body.refresh_token) return back(false, "Google did not return offline access. Remove the app at myaccount.google.com/permissions and reconnect.");
    const ui = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: gh(t.body.access_token) })).json();
    const email = String(ui.email || "").toLowerCase();
    if (!email || email !== String(me.gmail_address || "").toLowerCase())
      return back(false, `This Google account (${email || "unknown"}) is not your confirmed Gmail (${me.gmail_address}).`);
    const root = await findOrCreateFolder(t.body.access_token, ROOT_NAME, "root");
    await findOrCreateFolder(t.body.access_token, "Reports", root);
    const now = new Date().toISOString();
    const { error } = await admin.from("google_drive_connections").upsert({
      user_id: me.id, google_email: email, refresh_token_enc: await encrypt(t.body.refresh_token), root_folder_id: root,
      connection_status: "connected", connected_at: now, updated_at: now });
    if (error) return back(false, "Could not save the connection.");
    await admin.from("user_profiles").update({ consent_given_at: now, drive_folder_id: root }).eq("id", me.id);
    return back(true);
  } catch (e) { return back(false, (e as Error).message); }
}

async function handleUpload(req: Request, admin: ReturnType<typeof db>) {
  const me = await authUser(req, admin);
  if (Number(req.headers.get("content-length") || 0) > MAX_BYTES + 100_000) throw new HttpError(413, "File is larger than 10 MB.");
  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || ""), dispatchId = String(form.get("dispatch_id") || ""), inquiryId = String(form.get("inquiry_id") || "");
  if (!(file instanceof File)) throw new HttpError(400, "No file received.");
  if (!["main", "supporting", "inquiry"].includes(kind)) throw new HttpError(400, "Invalid document type.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "File is larger than 10 MB.");
  if (file.size === 0) throw new HttpError(400, "File is empty.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) throw new HttpError(415, "Only PDF, JPG and PNG files are allowed.");
  if (file.type && !["application/pdf", "image/jpeg", "image/png", "image/jpg"].includes(file.type)) throw new HttpError(415, "Only PDF, JPG and PNG files are allowed.");

  const { data: d } = await admin.from("dispatch_register").select("id, dispatch_no, dispatch_year, status")
    .eq("id", dispatchId).eq("user_id", me.id).maybeSingle();
  if (!d || d.status !== "active") throw new HttpError(404, "Report not found.");
  let inq: { id: string; inquiry_no: number } | null = null;
  if (kind === "inquiry") {
    const { data } = await admin.from("dispatch_inquiries").select("id, inquiry_no")
      .eq("id", inquiryId).eq("dispatch_id", d.id).eq("user_id", me.id).eq("record_status", "active").maybeSingle();
    if (!data) throw new HttpError(404, "Inquiry not found.");
    inq = data;
  }
  const rep = `Report_${d.dispatch_year}-${String(d.dispatch_no).padStart(4, "0")}`;
  const parts = ["Reports", rep, ...(kind === "inquiry" ? ["Inquiries", `Inquiry_${inq!.inquiry_no}`, "Action_Documents"] : kind === "main" ? ["Main_Document"] : ["Supporting_Documents"])].map(safeSeg);

  const { token, conn } = await accessToken(admin, me.id);
  let folder = await ensureRoot(token, admin, me.id, conn.root_folder_id);
  for (const p of parts) folder = await findOrCreateFolder(token, p, folder);

  const base = (file.name || "file").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9 _-]+/g, "_").slice(0, 60) || "file";
  const stored = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 6)}_${base}.${EXT[mime]}`;
  const boundary = "dr" + crypto.randomUUID().replace(/-/g, "");
  const meta = JSON.stringify({ name: stored, parents: [folder], mimeType: mime });
  const enc = new TextEncoder();
  const body = new Blob([enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`), bytes, enc.encode(`\r\n--${boundary}--`)]);
  const up = await gjson(await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size", {
    method: "POST", headers: { ...gh(token), "Content-Type": `multipart/related; boundary=${boundary}` }, body }), "uploading");

  const { data: row, error } = await admin.from("dispatch_documents").insert({
    dispatch_id: d.id, user_id: me.id, file_name: (file.name || stored).slice(0, 200), mime_type: mime, file_size: bytes.length,
    drive_file_id: up.id, drive_folder_id: folder, drive_path: parts.join("/"), source: "user_drive", doc_kind: kind, inquiry_id: inq ? inq.id : null,
  }).select("id, file_name, mime_type, file_size, created_at").single();
  if (error || !row) {   // never leave a Drive file without a record
    await fetch(`https://www.googleapis.com/drive/v3/files/${up.id}`, { method: "DELETE", headers: gh(token) }).catch(() => {});
    throw new HttpError(500, "The file could not be recorded, so the upload was cancelled.");
  }
  return json({ success: true, document: { ...row, uploader: me.full_name } });
}

async function ownedDoc(admin: ReturnType<typeof db>, userId: string, id: string) {
  const { data } = await admin.from("dispatch_documents").select("id, user_id, drive_file_id, mime_type, file_name, status")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data || !data.drive_file_id || data.status === "deleted") throw new HttpError(404, "Document not found.");
  return data as { id: string; drive_file_id: string; mime_type: string; file_name: string; status: string };
}

async function handleFile(req: Request, admin: ReturnType<typeof db>) {
  const me = await authUser(req, admin);
  const { id, download } = await req.json();
  const doc = await ownedDoc(admin, me.id, String(id));
  const { token } = await accessToken(admin, me.id);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.drive_file_id}?alt=media`, { headers: gh(token) });
  if (r.status === 404) {
    await admin.from("dispatch_documents").update({ status: "missing" }).eq("id", doc.id);
    throw new HttpError(410, "This file is no longer in your Google Drive.");
  }
  if (r.status === 401) throw RECONNECT();
  if (!r.ok) throw new HttpError(502, "Google Drive could not return the file.");
  const fname = encodeURIComponent(doc.file_name);
  return new Response(r.body, { headers: { ...cors, "Content-Type": doc.mime_type, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${fname}` } });
}

async function handleDelete(req: Request, admin: ReturnType<typeof db>) {
  const me = await authUser(req, admin);
  const { id } = await req.json();
  const doc = await ownedDoc(admin, me.id, String(id));
  if (doc.status !== "missing") {
    const { token } = await accessToken(admin, me.id);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.drive_file_id}`, {
      method: "PATCH", headers: { ...gh(token), "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    if (r.status === 401) throw RECONNECT();
    if (!r.ok && r.status !== 404) throw new HttpError(502, "Google Drive could not delete the file; nothing was changed.");
  }
  const { error } = await admin.from("dispatch_documents").update({ status: "deleted" }).eq("id", doc.id);
  if (error) throw new HttpError(500, "File was moved to Drive trash but the record could not be updated. Try again.");
  return json({ success: true });
}

async function handleDisconnect(req: Request, admin: ReturnType<typeof db>) {
  const me = await authUser(req, admin);
  const { data: c } = await admin.from("google_drive_connections").select("refresh_token_enc").eq("user_id", me.id).maybeSingle();
  if (c?.refresh_token_enc) {
    try { await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: await decrypt(c.refresh_token_enc) }) }); } catch { /* best effort */ }
  }
  await admin.from("google_drive_connections").update({ connection_status: "disconnected", refresh_token_enc: "", updated_at: new Date().toISOString() }).eq("user_id", me.id);
  await admin.from("user_profiles").update({ consent_given_at: null }).eq("id", me.id);
  return json({ success: true });   // reports, document metadata and Drive files are left untouched
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = db(), url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.has("state")) return await handleCallback(url, admin);
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    switch (url.searchParams.get("a")) {
      case "start": return await handleStart(req, admin);
      case "upload": return await handleUpload(req, admin);
      case "file": return await handleFile(req, admin);
      case "delete": return await handleDelete(req, admin);
      case "disconnect": return await handleDisconnect(req, admin);
      default: throw new HttpError(404, "Unknown action");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: "Unexpected server error" }, 500);
  }
});
