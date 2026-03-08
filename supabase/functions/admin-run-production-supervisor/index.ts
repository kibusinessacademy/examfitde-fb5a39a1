import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * admin-run-production-supervisor — Automated supervisor ticker.
 *
 * Loops through all non-completed waves and:
 *   1. Auto-activates draft waves
 *   2. Ticks active waves (syncs item status)
 *   3. Auto-finalizes waves where all items are terminal
 *
 * Can be called manually (admin auth) or via cron (x-internal-secret).
 */

type WaveRow = {
  id: string;
  name: string;
  status: string;
  max_concurrent: number | null;
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  // Auth: either internal secret or admin JWT
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const isInternal = edgeSecret && internalSecret && internalSecret === edgeSecret;

  if (!isInternal) {
    const auth = await validateAuth(req, true);
    if (auth.error || !auth.isAdmin) {
      return json(401, { error: auth.error || "Admin required" }, origin);
    }
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const result = {
    ok: true,
    checked_waves: 0,
    activated: 0,
    backpressure_runs: 0,
    promoted_items: 0,
    ticked: 0,
    finalized: 0,
    skipped: 0,
    errors: [] as Array<{ wave_id?: string; action: string; error: string }>,
    duration_ms: 0,
  };

  try {
    const { data: waves, error: waveErr } = await sb
      .from("production_waves")
      .select("id, name, status, max_concurrent")
      .in("status", ["draft", "active", "paused"])
      .order("created_at", { ascending: true });

    if (waveErr) {
      return json(500, { ok: false, error: waveErr.message }, origin);
    }

    const activeWaves = (waves || []) as WaveRow[];
    result.checked_waves = activeWaves.length;

    for (const wave of activeWaves) {
      try {
        if (wave.status === "paused") {
          result.skipped++;
          continue;
        }

        // Auto-activate draft waves
        if (wave.status === "draft") {
          const activateRes = await fetch(
            `${supabaseUrl}/functions/v1/admin-production-supervisor`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "activate",
                wave_id: wave.id,
              }),
            },
          );
          const activateBody = await activateRes.text();
          const activateJson = (() => { try { return JSON.parse(activateBody); } catch { return {}; } })();

          if (!activateRes.ok) {
            result.errors.push({
              wave_id: wave.id,
              action: "activate",
              error: activateJson?.error || `HTTP ${activateRes.status}`,
            });
            continue;
          }
          result.activated++;
        }

        // Tick active waves
        const tickRes = await fetch(
          `${supabaseUrl}/functions/v1/admin-production-supervisor`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "tick",
              wave_id: wave.id,
            }),
          },
        );
        const tickBody = await tickRes.text();
        const tickJson = (() => { try { return JSON.parse(tickBody); } catch { return {}; } })();

        if (!tickRes.ok) {
          result.errors.push({
            wave_id: wave.id,
            action: "tick",
            error: tickJson?.error || `HTTP ${tickRes.status}`,
          });
          continue;
        }
        result.ticked++;

        // Check if wave should be auto-finalized
        const { data: freshWave } = await sb
          .from("production_waves")
          .select("id, status, target_count, seeded_count, completed_count, failed_count, blocked_count, published_count")
          .eq("id", wave.id)
          .single();

        if (!freshWave) continue;

        const terminal =
          Number(freshWave.completed_count || 0) +
          Number(freshWave.failed_count || 0) +
          Number(freshWave.blocked_count || 0) +
          Number(freshWave.published_count || 0);

        const target = Number(freshWave.seeded_count || freshWave.target_count || 0);

        if (
          freshWave.status !== "completed" &&
          target > 0 &&
          terminal >= target
        ) {
          const finalizeRes = await fetch(
            `${supabaseUrl}/functions/v1/admin-production-supervisor`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "finalize",
                wave_id: wave.id,
              }),
            },
          );
          const finalizeBody = await finalizeRes.text();
          const finalizeJson = (() => { try { return JSON.parse(finalizeBody); } catch { return {}; } })();

          if (!finalizeRes.ok) {
            result.errors.push({
              wave_id: wave.id,
              action: "finalize",
              error: finalizeJson?.error || `HTTP ${finalizeRes.status}`,
            });
            continue;
          }
          result.finalized++;
        }
      } catch (e) {
        result.errors.push({
          wave_id: wave.id,
          action: "loop",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    result.duration_ms = Date.now() - startedAt;
    return json(200, result, origin);
  } catch (e) {
    return json(
      500,
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        ...result,
        duration_ms: Date.now() - startedAt,
      },
      origin,
    );
  }
});
