/**
 * admin-cutover-control
 *
 * Operative Cutover-Steuerung für Admin Cockpit:
 *   - action="gsc_submit_sitemap": meldet Sitemap an Google Search Console über
 *     den Connector-Gateway an (PUT .../sites/{siteUrl}/sitemaps/{feedpath})
 *   - action="gsc_get_sitemap_status": liest den GSC-Status für eine Sitemap
 *   - action="route_html_smoke": holt die Live-URL einer Route und verifiziert
 *     <title>, <link rel="canonical">, JSON-LD
 *   - action="run_post_cutover_smoke": führt route_html_smoke für eine Liste
 *     von Routen aus und protokolliert das Aggregat
 *
 * Alle Aktionen schreiben Audit nach auto_heal_log.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  getCorsHeaders,
  handleCorsPreflightRequest,
  json,
} from "../_shared/cors.ts";

const GSC_GATEWAY =
  "https://connector-gateway.lovable.dev/google_search_console/webmasters/v3";

interface AuditPayload {
  action_type: string;
  target_id?: string | null;
  target_type?: string;
  result_status: "success" | "failure" | "skipped" | "unknown";
  details: Record<string, unknown>;
}

async function emitAudit(
  sb: ReturnType<typeof createClient>,
  payload: AuditPayload,
) {
  try {
    await sb.from("auto_heal_log").insert({
      action_type: payload.action_type,
      target_id: payload.target_id ?? null,
      target_type: payload.target_type ?? "system",
      result_status: payload.result_status,
      metadata: payload.details,
    });
  } catch (err) {
    console.error("audit emit failed", err);
  }
}

async function requireAdminUser(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: "unauthorized" as const };
  }
  const token = auth.slice("Bearer ".length);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return { error: "unauthorized" as const };
  const sb = createClient(url, service);
  const { data: hasRole } = await sb.rpc("has_role", {
    _user_id: u.user.id,
    _role: "admin",
  });
  if (!hasRole) return { error: "forbidden" as const };
  return { sb, userId: u.user.id };
}

// ── GSC: submit / status ──────────────────────────────────────────────
async function gscRequest(
  method: "GET" | "PUT" | "DELETE",
  siteUrl: string,
  feedpath: string,
) {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gscKey = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY");
  if (!lovableKey || !gscKey) {
    throw new Error(
      "GSC connector not configured (LOVABLE_API_KEY / GOOGLE_SEARCH_CONSOLE_API_KEY missing)",
    );
  }
  const enc = (s: string) => encodeURIComponent(s);
  const url = feedpath
    ? `${GSC_GATEWAY}/sites/${enc(siteUrl)}/sitemaps/${enc(feedpath)}`
    : `${GSC_GATEWAY}/sites/${enc(siteUrl)}/sitemaps`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gscKey,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: r.ok, status: r.status, body };
}

// ── Route HTML Smoke ──────────────────────────────────────────────────
interface RouteCheck {
  route: string;
  url: string;
  status: number;
  ok: boolean;
  title: string | null;
  canonical: string | null;
  jsonLdCount: number;
  hasJsonLd: boolean;
  metaDescription: string | null;
  reasons: string[];
}

async function checkRouteHtml(host: string, route: string): Promise<RouteCheck> {
  const url = host.replace(/\/$/, "") + (route.startsWith("/") ? route : "/" + route);
  const reasons: string[] = [];
  let status = 0;
  let html = "";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "ExamFit-Cutover-Smoke/1.0 (+admin)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    status = r.status;
    html = await r.text();
  } catch (err) {
    reasons.push(`fetch_error: ${(err as Error).message}`);
    return {
      route, url, status, ok: false, title: null, canonical: null,
      jsonLdCount: 0, hasJsonLd: false, metaDescription: null, reasons,
    };
  }

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() || null;
  const canonical = html.match(
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
  )?.[1] ?? html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i,
  )?.[1] ?? null;
  const description = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
  )?.[1] ?? null;
  const jsonLdMatches = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) ?? [];
  const jsonLdCount = jsonLdMatches.length;

  if (status >= 400) reasons.push(`http_${status}`);
  if (!title) reasons.push("missing_title");
  if (!canonical) reasons.push("missing_canonical");
  if (jsonLdCount === 0) reasons.push("missing_jsonld");
  if (html.length < 1500) reasons.push("html_too_small");
  if (/<div id=["']root["']>\s*<\/div>/i.test(html) && jsonLdCount === 0) {
    reasons.push("spa_shell_only");
  }

  const ok = reasons.length === 0;
  return {
    route, url, status, ok, title, canonical, jsonLdCount,
    hasJsonLd: jsonLdCount > 0, metaDescription: description, reasons,
  };
}

// ── Handler ───────────────────────────────────────────────────────────
const DEFAULT_ROUTES = [
  "/",
  "/berufe",
  "/berufe/industriekaufmann-frau",
  "/pruefungstraining-azubis",
  "/blog",
  "/aevo-pruefung",
  "/fiae-pruefung",
];
const DEFAULT_HOST = "https://berufos.com";
const DEFAULT_SITEMAP = "https://berufos.com/sitemap.xml";

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  const ctx = await requireAdminUser(req);
  if ("error" in ctx) {
    return json(ctx.error === "forbidden" ? 403 : 401, { error: ctx.error }, origin);
  }
  const { sb, userId } = ctx;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "");

  try {
    if (action === "gsc_submit_sitemap") {
      const siteUrl = String(body.siteUrl ?? "https://berufos.com/");
      const feedpath = String(body.feedpath ?? DEFAULT_SITEMAP);
      const r = await gscRequest("PUT", siteUrl, feedpath);
      await emitAudit(sb, {
        action_type: "cutover_gsc_sitemap_submit",
        target_type: "seo",
        result_status: r.ok ? "success" : "failure",
        details: { actor: userId, siteUrl, feedpath, http_status: r.status, response: r.body },
      });
      return json(r.ok ? 200 : 502, {
        ok: r.ok, http_status: r.status, response: r.body, siteUrl, feedpath,
      }, origin);
    }

    if (action === "gsc_get_sitemap_status") {
      const siteUrl = String(body.siteUrl ?? "https://berufos.com/");
      const feedpath = String(body.feedpath ?? DEFAULT_SITEMAP);
      const r = await gscRequest("GET", siteUrl, feedpath);
      return json(r.ok ? 200 : r.status, {
        ok: r.ok, http_status: r.status, response: r.body,
      }, origin);
    }

    if (action === "gsc_list_sites") {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      const gscKey = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY");
      if (!lovableKey || !gscKey) {
        return json(503, { error: "gsc_not_configured" }, origin);
      }
      const r = await fetch(`${GSC_GATEWAY}/sites`, {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": gscKey,
        },
      });
      const data = await r.json().catch(() => null);
      return json(r.ok ? 200 : r.status, { ok: r.ok, response: data }, origin);
    }

    if (action === "route_html_smoke" || action === "run_post_cutover_smoke") {
      const host = String(body.host ?? DEFAULT_HOST);
      const routes = Array.isArray(body.routes) && body.routes.length
        ? (body.routes as string[])
        : DEFAULT_ROUTES;
      const checks: RouteCheck[] = [];
      for (const r of routes) {
        checks.push(await checkRouteHtml(host, r));
      }
      const passed = checks.filter((c) => c.ok).length;
      const failed = checks.length - passed;
      const verdict = failed === 0 ? "GO" : "BLOCKED";

      await emitAudit(sb, {
        action_type: "cutover_route_html_smoke",
        target_type: "seo",
        result_status: failed === 0 ? "success" : "failure",
        details: {
          actor: userId,
          host,
          verdict,
          total: checks.length,
          passed,
          failed,
          checks: checks.map((c) => ({
            route: c.route,
            ok: c.ok,
            status: c.status,
            reasons: c.reasons,
            title: c.title?.slice(0, 120) ?? null,
            canonical: c.canonical,
            jsonLdCount: c.jsonLdCount,
          })),
        },
      });

      return json(200, {
        verdict, host, total: checks.length, passed, failed, checks,
      }, origin);
    }

    return json(400, { error: "unknown_action", action }, origin);
  } catch (err) {
    console.error("admin-cutover-control error", err);
    await emitAudit(sb, {
      action_type: "cutover_control_error",
      target_type: "system",
      result_status: "failure",
      details: { actor: userId, action, error: String((err as Error).message ?? err) },
    });
    return json(500, { error: String((err as Error).message ?? err) }, origin);
  }
});
