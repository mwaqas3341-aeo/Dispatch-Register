import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const WINGS = ["M-EE", "W-EE", "SE"];
const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

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
      .select("id, role, status").eq("id", u.user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.status !== "active")
      return json({ error: "Administrator access required" }, 403);

    const body = await req.json();
    const action = body.action;

    if (action === "create_user") {
      const cnic = String(body.cnic ?? "").trim();
      if (!/^[0-9]{13}$/.test(cnic)) return json({ error: "CNIC must be exactly 13 digits" }, 400);
      const full_name = clean(body.full_name);
      const district = clean(body.district);
      if (!full_name) return json({ error: "Full name is required" }, 400);
      if (!district) return json({ error: "District is required" }, 400);
      const wing = clean(body.wing);
      if (wing && !WINGS.includes(wing)) return json({ error: "Invalid wing" }, 400);

      const { data: dup } = await admin.from("user_profiles").select("id").eq("cnic", cnic).maybeSingle();
      if (dup) return json({ error: "A user with this CNIC already exists" }, 409);

      const { data: created, error: ce } = await admin.auth.admin.createUser({
        email: `${cnic}@dispatch.local`, password: cnic, email_confirm: true,
      });
      if (ce || !created?.user) return json({ error: ce?.message || "Could not create account" }, 400);

      const { error: pe } = await admin.from("user_profiles").insert({
        id: created.user.id, cnic, full_name, district: district.toUpperCase(),
        designation: clean(body.designation), cell_no: clean(body.cell_no),
        tehsil: clean(body.tehsil)?.toUpperCase() ?? null, wing, markaz: clean(body.markaz),
        role: "user", status: "active", created_by: me.id,
      });
      if (pe) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: pe.message }, 400);
      }
      return json({ success: true, user_id: created.user.id });
    }

    if (action === "reset_password") {
      const { data: p } = await admin.from("user_profiles").select("id, cnic").eq("id", body.user_id).maybeSingle();
      if (!p) return json({ error: "User not found" }, 404);
      const { error } = await admin.auth.admin.updateUserById(p.id, { password: p.cnic });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "set_status") {
      if (body.user_id === me.id) return json({ error: "You cannot change your own status" }, 400);
      if (!["active", "suspended"].includes(body.status)) return json({ error: "Invalid status" }, 400);
      const { error } = await admin.from("user_profiles").update({ status: body.status }).eq("id", body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "update_user") {
      const wing = clean(body.wing);
      if (wing && !WINGS.includes(wing)) return json({ error: "Invalid wing" }, 400);
      const district = clean(body.district);
      if (!district) return json({ error: "District is required" }, 400);
      const { error } = await admin.from("user_profiles").update({
        full_name: clean(body.full_name) ?? undefined, designation: clean(body.designation),
        cell_no: clean(body.cell_no), district: district.toUpperCase(),
        tehsil: clean(body.tehsil)?.toUpperCase() ?? null, wing, markaz: clean(body.markaz),
      }).eq("id", body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
