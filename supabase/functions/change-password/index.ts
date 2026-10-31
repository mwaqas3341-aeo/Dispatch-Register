import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);

    const { data: me } = await admin.from("user_profiles")
      .select("id, cnic, status").eq("id", u.user.id).maybeSingle();
    if (!me || me.status !== "active") return json({ error: "Account not active" }, 403);

    const { new_password, current_password } = await req.json();
    // the person must prove they know the current password (protects an unlocked phone / open session)
    const check = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { error: ce } = await check.auth.signInWithPassword({ email: u.user.email!, password: String(current_password ?? "") });
    if (ce) return json({ error: "Current password is incorrect" }, 400);
    const pw = String(new_password ?? "");
    if (pw.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (pw === me.cnic || /^[0-9]+$/.test(pw)) return json({ error: "Choose a password that is not only digits and not your CNIC" }, 400);

    const { error } = await admin.auth.admin.updateUserById(me.id, { password: pw });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
