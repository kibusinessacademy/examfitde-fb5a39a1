import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-self-test
 * --------------
 * Server-side SEO smoke test for berufos.com.
 * Runs 4 suites against PUBLIC URLs and returns a structured report:
 *
 *   1. html-content        — H1 count, <title>, meta description per route
 *   2. canonical           — <link rel="canonical"> matches expected URL, slash-clean
 *   3. sitemap-robots      — sitemap.xml + robots.txt + sub-sitemaps return 200 / valid XML
 *   4. trailing-slash      — /path/ should 30x or client-redirect to /path
 *
 * The function does NOT execute JavaScript, so it sees the SSR/static HTML.
 * For SPA-rendered routes it can only assert HTTP status + base shell tags
 * (the SEO-Crawler check is acceptable — Lovable hosting serves a SPA shell).
 */

const SITE_URL = "https://berufos.com";
const ROUTES_TO_TEST = [
  "/",
  "/preise",
  "/berufe",
  "/blog",
  "/wissen",
  "/aevo-pruefungsvorbereitung",
  "/bilanzbuchhalter-pruefungsvorbereitung",
  "/fachinformatiker-ae-pruefungsvorbereitung",
  "/pruefungstraining",
  "/pruefungstraining/ausbildung",
];

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  url?: string;
}

interface SuiteResult {
  suite: string;
  passed: number;
  warned: number;
  failed: number;
  checks: CheckResult[];
}

async function fetchText(url: string, opts: RequestInit = {}): Promise<{ ok: boolean; status: number; body: string; headers: Headers }> {
  try {
    const res = await fetch(url, { redirect: "manual", ...opts });
    const body = res.status < 400 ? await res.text() : "";
    return { ok: res.ok, status: res.status, body, headers: res.headers };
  } catch (err) {
    return { ok: false, status: 0, body: String((err as Error).message), headers: new Headers() };
  }
}

function countMatches(re: RegExp, str: string): number {
  return (str.match(re) || []).length;
}

async function runHtmlContentSuite(): Promise<SuiteResult> {
  const checks: CheckResult[] = [];
  for (const route of ROUTES_TO_TEST) {
    const url = `${SITE_URL}${route}`;
    const r = await fetchText(url);
    if (r.status !== 200) {
      checks.push({ name: `HTTP ${route}`, status: "fail", detail: `status ${r.status}`, url });
      continue;
    }
    const h1Count = countMatches(/<h1\b/gi, r.body);
    const hasTitle = /<title>[^<]+<\/title>/i.test(r.body);
    const hasDesc = /<meta\s+name=["']description["'][^>]*content=["'][^"']{20,}["']/i.test(r.body);
    const issues: string[] = [];
    if (h1Count !== 1) issues.push(`h1=${h1Count}`);
    if (!hasTitle) issues.push("no <title>");
    if (!hasDesc) issues.push("no meta description");
    checks.push({
      name: `HTML ${route}`,
      status: issues.length === 0 ? "pass" : (h1Count === 0 ? "warn" : "warn"),
      detail: issues.length === 0 ? `h1=${h1Count}, title✓, desc✓` : issues.join(", "),
      url,
    });
  }
  return summarize("html-content", checks);
}

async function runCanonicalSuite(): Promise<SuiteResult> {
  const checks: CheckResult[] = [];
  for (const route of ROUTES_TO_TEST) {
    const url = `${SITE_URL}${route}`;
    const r = await fetchText(url);
    if (r.status !== 200) {
      checks.push({ name: `Canonical ${route}`, status: "fail", detail: `status ${r.status}`, url });
      continue;
    }
    const m = r.body.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    if (!m) {
      // SPA shell may inject canonical client-side — soft warn
      checks.push({ name: `Canonical ${route}`, status: "warn", detail: "no canonical in static HTML (SPA injects client-side)", url });
      continue;
    }
    const canonical = m[1];
    const expected = route === "/" ? `${SITE_URL}/` : `${SITE_URL}${route}`;
    const slashClean = !canonical.endsWith("/") || canonical === `${SITE_URL}/`;
    if (canonical !== expected) {
      checks.push({ name: `Canonical ${route}`, status: "fail", detail: `got "${canonical}" expected "${expected}"`, url });
    } else if (!slashClean) {
      checks.push({ name: `Canonical ${route}`, status: "fail", detail: `trailing slash on "${canonical}"`, url });
    } else {
      checks.push({ name: `Canonical ${route}`, status: "pass", detail: canonical, url });
    }
  }
  return summarize("canonical", checks);
}

async function runSitemapRobotsSuite(): Promise<SuiteResult> {
  const checks: CheckResult[] = [];
  // robots.txt (public/robots.txt static)
  const robots = await fetchText(`${SITE_URL}/robots.txt`);
  checks.push({
    name: "robots.txt status",
    status: robots.status === 200 ? "pass" : "fail",
    detail: `${robots.status}`,
    url: `${SITE_URL}/robots.txt`,
  });
  if (robots.status === 200) {
    const hasSitemapRef = /Sitemap:\s*https?:\/\//i.test(robots.body);
    checks.push({
      name: "robots.txt has Sitemap:",
      status: hasSitemapRef ? "pass" : "fail",
      detail: hasSitemapRef ? "Sitemap reference present" : "missing Sitemap: directive",
    });
  }
  // sitemap.xml (static index)
  const sitemap = await fetchText(`${SITE_URL}/sitemap.xml`);
  checks.push({
    name: "sitemap.xml status",
    status: sitemap.status === 200 ? "pass" : "fail",
    detail: `${sitemap.status}`,
    url: `${SITE_URL}/sitemap.xml`,
  });
  if (sitemap.status === 200) {
    const isValidXml = sitemap.body.trim().startsWith("<?xml");
    const hasSitemaps = /<sitemap>/i.test(sitemap.body) || /<urlset/i.test(sitemap.body);
    checks.push({
      name: "sitemap.xml valid XML",
      status: isValidXml && hasSitemaps ? "pass" : "fail",
      detail: isValidXml ? (hasSitemaps ? "valid sitemapindex/urlset" : "no sitemap entries") : "not XML",
    });
    // Probe sub-sitemaps via Edge-Function
    const subTypes = ["static", "berufe", "blog", "landing", "products", "content"];
    for (const t of subTypes) {
      const sub = await fetchText(
        `https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap?type=${t}`,
      );
      checks.push({
        name: `sub-sitemap type=${t}`,
        status: sub.status === 200 ? "pass" : "fail",
        detail: `${sub.status}, ${sub.body.length} bytes`,
      });
    }
  }
  return summarize("sitemap-robots", checks);
}

async function runTrailingSlashSuite(): Promise<SuiteResult> {
  const checks: CheckResult[] = [];
  // For each route (except "/"), append slash and verify either:
  //  - server returns 30x with location WITHOUT trailing slash, OR
  //  - server returns 200 (SPA fallback) AND the page contains canonical without slash (client normalizes)
  const routes = ROUTES_TO_TEST.filter((r) => r !== "/");
  for (const route of routes) {
    const url = `${SITE_URL}${route}/`;
    const r = await fetchText(url);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") || "";
      const ok = loc && !loc.endsWith("/") && loc.endsWith(route);
      checks.push({
        name: `Slash redirect ${route}/`,
        status: ok ? "pass" : "warn",
        detail: `${r.status} → ${loc}`,
        url,
      });
    } else if (r.status === 200) {
      // SPA fallback — canonical must NOT include trailing slash
      const m = r.body.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
      const canon = m?.[1] || "";
      const ok = canon === `${SITE_URL}${route}`;
      checks.push({
        name: `Slash SPA ${route}/`,
        status: ok ? "pass" : "warn",
        detail: ok ? `client normalizes (canonical=${canon})` : `canonical="${canon}" (client-side normalizer should redirect /${route}/ → /${route})`,
        url,
      });
    } else {
      checks.push({ name: `Slash ${route}/`, status: "fail", detail: `status ${r.status}`, url });
    }
  }
  return summarize("trailing-slash", checks);
}

function summarize(suite: string, checks: CheckResult[]): SuiteResult {
  return {
    suite,
    passed: checks.filter((c) => c.status === "pass").length,
    warned: checks.filter((c) => c.status === "warn").length,
    failed: checks.filter((c) => c.status === "fail").length,
    checks,
  };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const headers = getCorsHeaders(req.headers.get("origin"));

  try {
    const url = new URL(req.url);
    const only = url.searchParams.get("suite"); // optional filter

    const all = [
      { key: "html-content", run: runHtmlContentSuite },
      { key: "canonical", run: runCanonicalSuite },
      { key: "sitemap-robots", run: runSitemapRobotsSuite },
      { key: "trailing-slash", run: runTrailingSlashSuite },
    ];
    const toRun = only ? all.filter((s) => s.key === only) : all;

    const started = Date.now();
    const results: SuiteResult[] = [];
    for (const s of toRun) {
      results.push(await s.run());
    }

    const totals = results.reduce(
      (acc, r) => ({
        passed: acc.passed + r.passed,
        warned: acc.warned + r.warned,
        failed: acc.failed + r.failed,
      }),
      { passed: 0, warned: 0, failed: 0 },
    );

    return new Response(
      JSON.stringify(
        {
          site: SITE_URL,
          duration_ms: Date.now() - started,
          totals,
          suites: results,
          generated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
});
