// Edge Function test with mocked Supabase REST/Auth and mocked Google. Run: deno test --allow-all tests/drive-fn.test.ts
const SB = "https://proj.supabase.co";
Deno.env.set("SUPABASE_URL", SB); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
Deno.env.set("GOOGLE_CLIENT_ID", "cid"); Deno.env.set("GOOGLE_CLIENT_SECRET", "sec"); Deno.env.set("APP_URL", "https://app.example/");
Deno.env.set("TOKEN_ENC_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

let handler!: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; };

const T: Record<string, any[]> = {
  user_profiles: [{ id: "u1", full_name: "User One", status: "active", gmail_address: "one@gmail.com", must_change_password: false },
                  { id: "u2", full_name: "User Two", status: "active", gmail_address: "two@gmail.com", must_change_password: false }],
  dispatch_register: [{ id: "d1", user_id: "u1", dispatch_no: 7, dispatch_year: 2026, status: "active" }],
  recipients: [{ id: "r1", email_office: "deo@example.pk", email_personal: "deo.personal@example.pk" }, { id: "r2", email_office: null, email_personal: null }],
  dispatch_recipients: [{ id: "dr1", dispatch_id: "d1", recipient_id: "r1", name_snapshot: "DEO", email_status: "pending" }, { id: "dr2", dispatch_id: "d1", recipient_id: "r2", name_snapshot: "No-mail office", email_status: "pending" }, { id: "dr3", dispatch_id: "d1", recipient_id: null, name_snapshot: "Other", email_status: "pending" }],
  dispatch_inquiries: [{ id: "q1", dispatch_id: "d1", user_id: "u1", inquiry_no: 2, record_status: "active" }],
  dispatch_documents: [], google_drive_connections: [], oauth_states: [],
};
const log: string[] = []; let failDocInsert = false; let googleRefreshError = false; let googleEmail = "one@gmail.com"; let scope = "openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send"; let gmailStatus = 200; const mails: string[] = [];
let seq = 0; const folders: Record<string, string> = {};

function match(row: any, q: URLSearchParams) {
  for (const [k, v] of q) {
    if (["select", "on_conflict", "limit", "order"].includes(k)) continue;
    const mi = /^in\.\((.*)\)$/.exec(v); if (mi) { if (!mi[1].split(",").includes(String(row[k]))) return false; continue; }
    const m = /^(eq|lt)\.(.*)$/.exec(v); if (!m) continue;
    if (m[1] === "eq" && String(row[k]) !== m[2]) return false;
    if (m[1] === "lt" && !(String(row[k]) < m[2])) return false;
  }
  return true;
}
async function mockFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input)); const method = (init.method || "GET").toUpperCase();
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (url.origin === SB && url.pathname === "/auth/v1/user") {
    const t = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") || "";
    return t.startsWith("tok-") ? J({ id: t.slice(4), aud: "authenticated" }) : J({ msg: "bad" }, 401);
  }
  if (url.origin === SB && url.pathname.startsWith("/rest/v1/")) {
    const tbl = url.pathname.split("/").pop()!; const h = new Headers(init.headers); const wantObj = (h.get("Accept") || "").includes("pgrst.object");
    if (method === "GET") { const r = T[tbl].filter((x) => match(x, url.searchParams)); return wantObj ? (r.length ? J(r[0]) : J({ code: "PGRST116" }, 406)) : J(r); }
    if (method === "POST") {
      if (tbl === "dispatch_documents" && failDocInsert) return J({ message: "boom" }, 500);
      const rows = [].concat(JSON.parse(init.body)).map((x: any) => ({ id: "n" + (++seq), created_at: new Date().toISOString(), status: "active", ...x }));
      if ((h.get("Prefer") || "").includes("merge-duplicates")) { for (const r of rows) { T[tbl] = T[tbl].filter((x) => x.user_id !== r.user_id); } }
      T[tbl].push(...rows); return wantObj ? J(rows[0], 201) : (h.get("Prefer") || "").includes("representation") ? J(rows, 201) : new Response(null, { status: 201 });
    }
    if (method === "PATCH") { const b = JSON.parse(init.body); T[tbl].filter((x) => match(x, url.searchParams)).forEach((x) => Object.assign(x, b)); return new Response(null, { status: 204 }); }
    if (method === "DELETE") { T[tbl] = T[tbl].filter((x) => !match(x, url.searchParams)); return new Response(null, { status: 204 }); }
  }
  if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
    const b = new URLSearchParams(init.body);
    if (b.get("grant_type") === "refresh_token") return googleRefreshError ? J({ error: "invalid_grant" }, 400) : J({ access_token: "at-" + b.get("refresh_token") });
    return J({ access_token: "at1", refresh_token: "RT-SECRET-1", scope });
  }
  if (url.host === "gmail.googleapis.com") { if (gmailStatus !== 200) return J({ error: { message: "insufficientPermissions" } }, gmailStatus); mails.push(JSON.parse(init.body).raw); return J({ id: "m" + (++seq) }); }
  if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") { log.push("revoke"); return J({}); }
  if (url.host === "openidconnect.googleapis.com") return J({ email: googleEmail });
  if (url.host === "www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") || ""; const nm = /name='([^']+)' and '([^']+)' in parents/.exec(q)!; const key = nm[2] + "/" + nm[1];
    return J({ files: folders[key] ? [{ id: folders[key] }] : [] });
  }
  if (url.host === "www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "POST") {
    const b = JSON.parse(init.body); const id = "f" + (++seq); folders[b.parents[0] + "/" + b.name] = id; log.push("folder:" + b.name); return J({ id });
  }
  if (url.host === "www.googleapis.com" && url.pathname.startsWith("/drive/v3/files/")) {
    const id = url.pathname.split("/").pop()!;
    if (method === "GET" && url.searchParams.get("alt") === "media") return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]), { status: 200 });
    if (method === "GET") return J({ id, trashed: false });
    if (method === "DELETE") { log.push("drive-delete:" + id); return new Response(null, { status: 204 }); }
    if (method === "PATCH") { log.push("trash:" + id); return J({ id }); }
  }
  if (url.host === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files") { log.push("drive-upload"); return J({ id: "file" + (++seq), size: "5" }); }
  throw new Error("unmocked " + method + " " + url);
}
(globalThis as any).fetch = mockFetch;
await import("../supabase/functions/drive/index.ts");

const call = (a: string, tok: string, body?: any, isForm = false) =>
  handler(new Request(`${SB}/functions/v1/drive?a=${a}`, { method: "POST", headers: { Authorization: "Bearer " + tok, ...(isForm ? {} : { "Content-Type": "application/json" }) }, body: isForm ? body : JSON.stringify(body) }));
const pdf = (name = "a.pdf") => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], name, { type: "application/pdf" });
const form = (f: File, o: Record<string, string>) => { const fd = new FormData(); fd.set("file", f); Object.entries(o).forEach(([k, v]) => fd.set(k, v)); return fd; };
const ok = (c: boolean, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("PASS " + m); };

Deno.test("full flow", async () => {
  // start + callback
  let r = await call("start", "bad"); ok(r.status === 401, "start requires a valid login");
  r = await call("start", "tok-u1"); const { url } = await r.json();
  const u = new URL(url); ok(u.searchParams.get("scope")!.includes("drive.file") && u.searchParams.get("access_type") === "offline" && !!u.searchParams.get("state"), "consent URL: drive.file, offline, state");
  const state = u.searchParams.get("state")!;
  googleEmail = "attacker@gmail.com";
  r = await handler(new Request(`${SB}/functions/v1/drive?code=c&state=${state}`)); ok(/drive=error/.test(r.headers.get("location")!) && /not%20your%20confirmed|not your confirmed|confirmed/.test(decodeURIComponent(r.headers.get("location")!)), "callback rejects a Google account that is not the confirmed Gmail");
  ok(T.oauth_states.length === 0, "state is single-use");
  googleEmail = "one@gmail.com"; scope = "openid email";
  r = await call("start", "tok-u1"); const s2 = new URL((await r.json()).url).searchParams.get("state")!;
  r = await handler(new Request(`${SB}/functions/v1/drive?code=c&state=${s2}`)); ok(/drive=error/.test(r.headers.get("location")!), "callback rejects when Drive permission not granted");
  scope = "openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send";
  r = await call("start", "tok-u1"); const s3 = new URL((await r.json()).url).searchParams.get("state")!;
  r = await handler(new Request(`${SB}/functions/v1/drive?code=c&state=${s3}`)); ok(/drive=connected/.test(r.headers.get("location")!), "callback connects");
  const c = T.google_drive_connections[0];
  ok(c.refresh_token_enc && !c.refresh_token_enc.includes("RT-SECRET-1") && c.connection_status === "connected", "refresh token stored encrypted");
  ok(log.includes("folder:Dispatch_Register") && log.includes("folder:Reports"), "Dispatch_Register/Reports created on connect");
  ok(!!T.user_profiles[0].consent_given_at, "profile consent set by server");

  // uploads
  r = await call("upload", "tok-u1", form(new File([new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0])], "evil.pdf", { type: "application/pdf" }), { kind: "supporting", dispatch_id: "d1" }), true);
  ok(r.status === 415, "renamed executable rejected by content check");
  r = await call("upload", "tok-u2", form(pdf(), { kind: "supporting", dispatch_id: "d1" }), true); ok(r.status === 404, "another user cannot upload into my report");
  r = await call("upload", "tok-u1", form(pdf("sub.pdf"), { kind: "supporting", dispatch_id: "d1" }), true); let j = await r.json();
  ok(r.status === 200 && j.document.uploader === "User One", "supporting upload ok, uploader name returned");
  ok(["Report_2026-0007", "Supporting_Documents"].every((n) => log.includes("folder:" + n)), "report-wise folder Reports/Report_2026-0007/Supporting_Documents created");
  r = await call("upload", "tok-u1", form(pdf("inq.pdf"), { kind: "inquiry", dispatch_id: "d1", inquiry_id: "q1" }), true); await r.json();
  ok(["Inquiries", "Inquiry_2", "Action_Documents"].every((n) => log.includes("folder:" + n)), "Inquiry_2/Action_Documents created");
  ok(T.dispatch_documents.length === 2 && T.dispatch_documents[1].inquiry_id === "q1" && T.dispatch_documents[0].drive_path === "Reports/Report_2026-0007/Supporting_Documents", "metadata linked to report/inquiry");
  r = await call("upload", "tok-u1", form(pdf(), { kind: "inquiry", dispatch_id: "d1", inquiry_id: "other" }), true); ok(r.status === 404, "inquiry of another report rejected");
  const before = log.length; failDocInsert = true;
  r = await call("upload", "tok-u1", form(pdf("x.pdf"), { kind: "supporting", dispatch_id: "d1" }), true);
  ok(r.status === 500 && log.slice(before).some((x) => x.startsWith("drive-delete:")), "DB failure -> Drive file removed (no orphan)");
  failDocInsert = false;

  // view / download / delete
  const id = T.dispatch_documents[0].id;
  r = await call("file", "tok-u2", { id }); ok(r.status === 404, "other user cannot read my document");
  r = await call("file", "tok-u1", { id, download: true }); ok(r.status === 200 && r.headers.get("content-type") === "application/pdf" && /attachment/.test(r.headers.get("content-disposition")!) && r.headers.get("x-content-type-options") === "nosniff", "owner downloads via backend with safe headers");
  await r.arrayBuffer();
  r = await call("delete", "tok-u2", { id }); ok(r.status === 404, "other user cannot delete");
  r = await call("delete", "tok-u1", { id }); ok(r.status === 200 && T.dispatch_documents[0].status === "deleted" && log.some((x) => x.startsWith("trash:")), "owner delete trashes Drive file and marks record");

  // email from the user's own Gmail
  T.dispatch_documents.push({ id: "mainDoc", dispatch_id: "d1", user_id: "u1", doc_kind: "main", status: "active", drive_file_id: "fmain", file_name: "complaint.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" });
  r = await call("send", "tok-u2", { dispatch_id: "d1" }); ok(r.status === 404, "another user cannot send mail for my report");
  r = await call("send", "tok-u1", { dispatch_id: "d1" }); j = await r.json();
  ok(j.sent === 1 && j.no_email === 2 && mails.length === 1, "one email sent; offices without an address recorded as no_email");
  const raw = new TextDecoder().decode(Uint8Array.from(atob(mails[0].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
  ok(/From: User One <one@gmail.com>/.test(raw) && /To: deo@example.pk, deo.personal@example.pk/.test(raw) && /filename="complaint.pdf"/.test(raw) && /Dispatch No\. 0007\/2026/.test(raw), "message is from the user's Gmail, to the office addresses, with the attachment");
  ok(T.dispatch_recipients.find((x) => x.id === "dr1").email_status === "sent" && T.dispatch_recipients.find((x) => x.id === "dr2").email_status === "no_email", "per-recipient status saved");
  r = await call("send", "tok-u1", { dispatch_id: "d1" }); j = await r.json(); ok(mails.length === 1, "retry does not send duplicates to offices already emailed");
  T.dispatch_recipients.find((x) => x.id === "dr1").email_status = "failed"; gmailStatus = 403;
  r = await call("send", "tok-u1", { dispatch_id: "d1" }); j = await r.json(); ok(r.status === 409 && j.code === "DRIVE_RECONNECT" && T.google_drive_connections[0].can_send === false, "missing send permission -> reconnect prompt");
  gmailStatus = 200; T.google_drive_connections[0].can_send = true;

  // expired / revoked
  googleRefreshError = true;
  r = await call("upload", "tok-u1", form(pdf(), { kind: "supporting", dispatch_id: "d1" }), true); j = await r.json();
  ok(r.status === 409 && j.code === "DRIVE_RECONNECT" && T.google_drive_connections[0].connection_status === "needs_reconnect", "revoked access -> reconnect prompt, status updated");
  ok(T.dispatch_documents.length === 3, "no record created for the failed upload");
  googleRefreshError = false;

  // disconnect keeps data
  T.google_drive_connections[0].connection_status = "connected";
  r = await call("disconnect", "tok-u1", {}); ok(r.status === 200 && log.includes("revoke") && T.google_drive_connections[0].refresh_token_enc === "" && T.dispatch_documents.length === 3, "disconnect revokes token, keeps document records");
  r = await call("file", "tok-u1", { id: T.dispatch_documents[1].id }); j = await r.json(); ok(r.status === 409, "after disconnect, access requires reconnect");
});
