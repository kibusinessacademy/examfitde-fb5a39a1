import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ImportRow {
  email: string;
  display_name?: string;
  role?: string;
  product_slug?: string;
  assign_seat?: string;
  external_id?: string;
}

const ALLOWED_ROLES = ["LEARNER", "MANAGER", "TRAINER", "IT_ADMIN", "BILLING"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const anonSb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(url, serviceKey);
    const body = await req.json();
    const { org_id, rows, dry_run = false, file_name } = body as {
      org_id: string;
      rows: ImportRow[];
      dry_run?: boolean;
      file_name?: string;
    };

    if (!org_id || !rows || !Array.isArray(rows)) {
      return json({ error: "org_id and rows[] required" }, 400);
    }

    // Check org access
    const { data: membership } = await sb
      .from("org_memberships")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .in("role", ["OWNER", "ADMIN", "IT_ADMIN"])
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json({ error: "Org access denied" }, 403);

    // Create import job
    const { data: job, error: jobErr } = await sb
      .from("org_import_jobs")
      .insert({
        org_id,
        uploaded_by: user.id,
        file_name: file_name || "api-upload",
        dry_run,
        total_rows: rows.length,
        status: "validating",
      })
      .select("id")
      .single();

    if (jobErr) return json({ error: jobErr.message }, 500);
    const jobId = job!.id;

    // Validate rows
    const validatedRows: { idx: number; row: ImportRow; errors: string[] }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const errors: string[] = [];

      if (!r.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
        errors.push("Ungültige E-Mail");
      }
      const role = (r.role || "LEARNER").toUpperCase();
      if (!ALLOWED_ROLES.includes(role)) {
        errors.push(`Ungültige Rolle: ${r.role}`);
      }

      validatedRows.push({ idx: i + 1, row: { ...r, role }, errors });
    }

    const errorRows = validatedRows.filter(v => v.errors.length > 0);
    const validRows = validatedRows.filter(v => v.errors.length === 0);

    if (dry_run) {
      // Insert rows as dry-run results
      const rowInserts = validatedRows.map(v => ({
        job_id: jobId,
        row_number: v.idx,
        raw_payload: v.row,
        status: v.errors.length > 0 ? "error" : "valid",
        error_message: v.errors.join("; ") || null,
      }));

      if (rowInserts.length > 0) {
        await sb.from("org_import_job_rows").insert(rowInserts);
      }

      await sb.from("org_import_jobs").update({
        status: "dry_run_complete",
        processed_rows: rows.length,
        success_rows: validRows.length,
        failed_rows: errorRows.length,
        error_rows: errorRows.map(e => ({
          row: e.idx,
          email: e.row.email,
          errors: e.errors,
        })),
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);

      // Audit
      await sb.from("org_audit_events").insert({
        org_id,
        actor_user_id: user.id,
        event_type: "bulk_import_dry_run",
        entity_type: "import_job",
        entity_id: jobId,
        metadata: { total: rows.length, valid: validRows.length, errors: errorRows.length },
      });

      return json({
        job_id: jobId,
        dry_run: true,
        total_rows: rows.length,
        valid_count: validRows.length,
        error_count: errorRows.length,
        error_rows: errorRows.map(e => ({
          row: e.idx,
          email: e.row.email,
          errors: e.errors,
        })),
      });
    }

    // Execute import
    await sb.from("org_import_jobs").update({ status: "executing" }).eq("id", jobId);

    let created = 0, updated = 0, assigned = 0, skipped = 0;
    const failedRows: { row: number; email: string; error: string }[] = [];

    for (const v of validRows) {
      try {
        const r = v.row;

        // Find user by email — check profiles first, then auth.users
        let userId: string | null = null;
        let isNew = false;

        const { data: existingProfile } = await sb
          .from("profiles")
          .select("id")
          .eq("email", r.email)
          .maybeSingle();

        if (existingProfile) {
          userId = existingProfile.id;
          updated++;
        } else {
          // Try auth admin lookup by email
          const { data: authUser } = await sb.auth.admin.getUserById
            ? await (async () => {
                // Use listUsers with email filter
                const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
                // Search by email in the returned list won't work at scale
                // Instead, try creating the user directly - if they exist, we'll get an error
                return { data: null };
              })()
            : { data: null };

          if (!userId) {
            // Create user with random password
            const tempPass = crypto.randomUUID();
            const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
              email: r.email,
              password: tempPass,
              email_confirm: true,
              user_metadata: { full_name: r.display_name || r.email.split("@")[0] },
            });

            if (createErr) {
              // If user already exists (duplicate email), try to find them
              if (createErr.message?.includes("already") || createErr.message?.includes("duplicate")) {
                // Lookup via auth - the user exists but has no profile yet
                const { data: { users } } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
                const found = users?.find((u: any) => u.email === r.email);
                if (found) {
                  userId = found.id;
                  updated++;
                  // Ensure profile exists with email
                  await sb.from("profiles").upsert({
                    id: found.id,
                    email: r.email,
                    full_name: r.display_name || r.email.split("@")[0],
                  }, { onConflict: "id" });
                } else {
                  failedRows.push({ row: v.idx, email: r.email, error: createErr.message });
                  continue;
                }
              } else {
                failedRows.push({ row: v.idx, email: r.email, error: createErr.message });
                continue;
              }
            } else if (newUser?.user) {
              userId = newUser.user.id;
              isNew = true;
              created++;
              // Ensure profile has email
              await sb.from("profiles").upsert({
                id: userId,
                email: r.email,
                full_name: r.display_name || r.email.split("@")[0],
              }, { onConflict: "id" });
            }
          }
        }

        if (!userId) {
          failedRows.push({ row: v.idx, email: r.email, error: "Could not resolve user" });
          continue;
        }

        // Upsert org_membership
        const { error: memErr } = await sb
          .from("org_memberships")
          .upsert(
            {
              org_id,
              user_id: userId,
              role: r.role || "LEARNER",
              status: "active",
              external_id: r.external_id || null,
            },
            { onConflict: "org_id,user_id" }
          );

        if (memErr) {
          failedRows.push({ row: v.idx, email: r.email, error: memErr.message });
          continue;
        }

        // Insert row record
        await sb.from("org_import_job_rows").insert({
          job_id: jobId,
          row_number: v.idx,
          raw_payload: r,
          status: "success",
          user_id: userId,
        });
      } catch (err: any) {
        failedRows.push({ row: v.idx, email: v.row.email, error: err.message });
      }
    }

    // Insert error rows
    for (const e of errorRows) {
      await sb.from("org_import_job_rows").insert({
        job_id: jobId,
        row_number: e.idx,
        raw_payload: e.row,
        status: "error",
        error_message: e.errors.join("; "),
      });
    }

    // Update job
    await sb.from("org_import_jobs").update({
      status: "completed",
      processed_rows: rows.length,
      success_rows: created + updated,
      failed_rows: errorRows.length + failedRows.length,
      created_count: created,
      updated_count: updated,
      assigned_seats: assigned,
      skipped_count: skipped,
      error_rows: [...errorRows.map(e => ({ row: e.idx, email: e.row.email, errors: e.errors })), ...failedRows],
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    // Audit
    await sb.from("org_audit_events").insert({
      org_id,
      actor_user_id: user.id,
      event_type: "bulk_import_executed",
      entity_type: "import_job",
      entity_id: jobId,
      metadata: { created, updated, assigned, failed: failedRows.length },
    });

    return json({
      job_id: jobId,
      dry_run: false,
      created_count: created,
      updated_count: updated,
      assigned_seats: assigned,
      skipped_count: skipped,
      error_rows: failedRows,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
