import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://berufos.com").replace(/\/+$/, "");

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "run_runtime_smoke";
    const payload = body.payload ?? {};

    if (action !== "run_runtime_smoke") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const run = await sb.from("qa_runs").insert({
      run_type: payload.runType ?? "release",
      scope_json: { site: PUBLIC_SITE_URL },
      summary_json: {},
    }).select("id").single();
    if (run.error) throw run.error;
    const runId = run.data.id;

    const routes = await sb.from("qa_route_registry")
      .select("name, url_path, expected_status").eq("enabled", true)
      .order("url_path", { ascending: true });
    if (routes.error) throw routes.error;

    const budgets = await sb.from("qa_budgets").select("key, value_num").eq("enabled", true);
    if (budgets.error) throw budgets.error;
    const budgetMap = new Map((budgets.data ?? []).map((b: { key: string; value_num: number }) => [b.key, Number(b.value_num)]));

    const routeLatencies: number[] = [];
    const routeResults: unknown[] = [];

    for (const r of routes.data ?? []) {
      const url = `${PUBLIC_SITE_URL}${r.url_path}`;
      const t0 = performance.now();
      const res = await fetch(url, { redirect: "manual" }).catch(() => null);
      const dt = Math.round(performance.now() - t0);
      routeLatencies.push(dt);

      const status = res?.status ?? 0;
      const ok = status === Number(r.expected_status) || (status >= 200 && status < 400 && Number(r.expected_status) === 200);

      let title = "";
      let hasMetaDesc = false;

      if (res && status >= 200 && status < 300) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) {
          const html = await res.text();
          title = extractTag(html, "title");
          hasMetaDesc = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']{20,}["']/i.test(html);
        }
      }

      routeResults.push({ ...r, url, status, latency_ms: dt, title, hasMetaDesc });

      if (!ok) {
        await upsertFinding(sb, runId, {
          area: "routing", severity: "critical",
          title: `Route smoke failed: ${r.url_path}`,
          description: `Expected ${r.expected_status}, got ${status} for ${url}`,
          evidence: { url, expected: r.expected_status, got: status, latency_ms: dt },
        });
      } else {
        await sb.rpc("resolve_qa_finding_if_exists", { p_area: "routing", p_title: `Route smoke failed: ${r.url_path}` });
      }

      if (r.url_path === "/" || r.url_path === "/shop") {
        if (!title || title.length < 8) {
          await upsertFinding(sb, runId, {
            area: "seo", severity: "critical",
            title: `Missing/short <title> on ${r.url_path}`,
            description: `SEO title missing or too short on ${url}`, evidence: { url, title },
          });
        } else {
          await sb.rpc("resolve_qa_finding_if_exists", { p_area: "seo", p_title: `Missing/short <title> on ${r.url_path}` });
        }
        if (!hasMetaDesc) {
          await upsertFinding(sb, runId, {
            area: "seo", severity: "critical",
            title: `Missing meta description on ${r.url_path}`,
            description: `Meta description missing on ${url}`, evidence: { url },
          });
        } else {
          await sb.rpc("resolve_qa_finding_if_exists", { p_area: "seo", p_title: `Missing meta description on ${r.url_path}` });
        }
      }
    }

    // PWA checks
    await checkPWA(sb, runId);

    // Perf budgets
    const p95 = percentile(routeLatencies, 0.95);
    const budget = budgetMap.get("route_latency_p95_ms") ?? 1500;
    if (p95 > budget) {
      await upsertFinding(sb, runId, {
        area: "perf", severity: "high",
        title: "Route latency budget exceeded (p95)",
        description: `p95 route latency ${p95}ms exceeds budget ${budget}ms`,
        evidence: { p95_ms: p95, budget_ms: budget, samples: routeLatencies.slice(0, 20) },
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "perf", p_title: "Route latency budget exceeded (p95)" });
    }

    const gate = await sb.rpc("compute_qa_release_gate");
    const summary = { site: PUBLIC_SITE_URL, route_p95_ms: p95, route_count: (routes.data ?? []).length, routes: routeResults, gate: gate.data ?? null };
    await sb.from("qa_runs").update({ summary_json: summary }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, summary }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qa-council-runtime-smoke] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function upsertFinding(sb: ReturnType<typeof createClient>, runId: string, f: {
  area: string; severity: string; title: string; description: string; evidence?: Record<string, unknown>;
}) {
  const r = await sb.rpc("upsert_qa_finding", {
    p_area: f.area, p_severity: f.severity, p_title: f.title,
    p_description: f.description, p_evidence: f.evidence ?? {}, p_qa_run_id: runId,
  });
  if (r.error) console.error("[qa-runtime-smoke] upsert error:", r.error.message);
}

async function checkPWA(sb: ReturnType<typeof createClient>, runId: string) {
  const checks = [
    { name: "manifest", url: `${PUBLIC_SITE_URL}/manifest.webmanifest` },
    { name: "icon192", url: `${PUBLIC_SITE_URL}/pwa-192x192.png` },
    { name: "icon512", url: `${PUBLIC_SITE_URL}/pwa-512x512.png` },
  ];
  for (const c of checks) {
    const res = await fetch(c.url, { redirect: "manual" }).catch(() => null);
    const status = res?.status ?? 0;
    if (!(status >= 200 && status < 400)) {
      await upsertFinding(sb, runId, {
        area: "pwa", severity: "critical",
        title: `PWA asset missing: ${c.name}`,
        description: `PWA check failed for ${c.url} (status=${status})`,
        evidence: { url: c.url, status },
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "pwa", p_title: `PWA asset missing: ${c.name}` });
    }
  }
}

function extractTag(html: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}
