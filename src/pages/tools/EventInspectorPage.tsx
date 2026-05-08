/**
 * GTM/GA4 Event Inspector — klickbarer Preview-Mode-Check.
 *
 * Wozu:
 *  - Verifiziert die 5 Kern-Funnel-Events (landing_view, cta_clicked,
 *    quiz_started, checkout_started, purchase_completed) im DataLayer.
 *  - Zeigt die Pflichtfelder (package_id, persona, curriculum_id,
 *    source_page, page_path) live an, sobald gepusht wurde.
 *
 * Workflow:
 *  1. GTM Preview öffnen (Container GTM-K39CL625) und URL eingeben:
 *     /tools/event-inspector
 *  2. Einen der "Trigger Event"-Buttons klicken.
 *  3. In der Tabelle erscheint der Push (Event + Pflichtfelder + Validierung).
 *  4. In GTM Preview den Tag-Fire prüfen, in GA4 Realtime den Event-Eingang.
 *
 * Hinweis: Diese Seite ruft NICHT die Supabase-RPC auf — sie pusht direkt
 * in den DataLayer (gtmPush), damit Test-Events kein conversion_events
 * verschmutzen. Für End-to-End mit DB siehe scripts/funnel-tracking-smoke.mjs.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { gtmPush } from "@/lib/gtm";

const REQUIRED_FIELDS = [
  "event",
  "funnel_event",
  "package_id",
  "persona",
  "curriculum_id",
  "source_page",
  "page_path",
] as const;

type Push = Record<string, unknown> & { _ts?: number };

const TEST_PACKAGE_ID = "00000000-0000-4000-8000-000000000000";

const SCENARIOS: Array<{
  label: string;
  ga4: string;
  funnel: string;
  payload: () => Record<string, unknown>;
}> = [
  {
    label: "landing_view",
    ga4: "landing_view",
    funnel: "page_view",
    payload: () => ({
      event: "landing_view",
      funnel_event: "page_view",
      package_id: null,
      persona: "azubi",
      curriculum_id: null,
      source_page: window.location.pathname,
      page_path: window.location.pathname,
      _origin: "event_inspector",
    }),
  },
  {
    label: "cta_clicked",
    ga4: "cta_clicked",
    funnel: "hero_cta_click",
    payload: () => ({
      event: "cta_clicked",
      funnel_event: "hero_cta_click",
      package_id: null,
      persona: "azubi",
      curriculum_id: null,
      source_page: window.location.pathname,
      page_path: window.location.pathname,
      cta_location: "inspector",
      _origin: "event_inspector",
    }),
  },
  {
    label: "quiz_started",
    ga4: "quiz_started",
    funnel: "quiz_started",
    payload: () => ({
      event: "quiz_started",
      funnel_event: "quiz_started",
      package_id: TEST_PACKAGE_ID,
      persona: "azubi",
      curriculum_id: null,
      source_page: window.location.pathname,
      page_path: window.location.pathname,
      quiz_slug: "inspector-test",
      _origin: "event_inspector",
    }),
  },
  {
    label: "checkout_started",
    ga4: "checkout_started",
    funnel: "checkout_start",
    payload: () => ({
      event: "checkout_started",
      funnel_event: "checkout_start",
      package_id: TEST_PACKAGE_ID,
      persona: "azubi",
      curriculum_id: null,
      source_page: window.location.pathname,
      page_path: window.location.pathname,
      price_id: "test_price",
      _origin: "event_inspector",
    }),
  },
  {
    label: "purchase_completed",
    ga4: "purchase_completed",
    funnel: "checkout_complete",
    payload: () => ({
      event: "purchase_completed",
      funnel_event: "checkout_complete",
      package_id: TEST_PACKAGE_ID,
      persona: "azubi",
      curriculum_id: null,
      source_page: window.location.pathname,
      page_path: window.location.pathname,
      order_id: `inspector_${Date.now()}`,
      _origin: "event_inspector",
    }),
  },
];

function validate(p: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (!(f in p)) errs.push(`fehlt: ${f}`);
  }
  const strict = ["quiz_started", "checkout_started", "purchase_completed"];
  if (strict.includes(String(p.event)) && (p.package_id == null || p.package_id === "")) {
    errs.push("strict: package_id ist null");
  }
  return errs;
}

export default function EventInspectorPage() {
  const [pushes, setPushes] = useState<Push[]>([]);
  const [debugOn, setDebugOn] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("ef_gtm_debug", "1");
      setDebugOn(true);
    } catch {
      /* noop */
    }
  }, []);

  const trigger = (idx: number) => {
    const p = SCENARIOS[idx].payload();
    gtmPush(p);
    setPushes((prev) => [{ ...p, _ts: Date.now() }, ...prev].slice(0, 25));
  };

  const dlSize = useMemo(() => {
    if (typeof window === "undefined") return 0;
    return window.dataLayer?.length ?? 0;
  }, [pushes]);

  return (
    <div className="container max-w-5xl py-10">
      <Helmet>
        <title>GTM/GA4 Event Inspector — ExamFit</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <h1 className="text-3xl font-semibold text-foreground">
        GTM / GA4 Event Inspector
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Klickbarer Preview-Mode-Check für die fünf Kern-Funnel-Events.
        DataLayer-Debug ist {debugOn ? "AN" : "AUS"} — Pushes erscheinen
        zusätzlich in der Browser-Console mit Prefix <code>[GTM]</code>.
        DataLayer-Länge: <strong>{dlSize}</strong>.
      </p>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">1. Trigger</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => trigger(i)}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Trigger <code>{s.label}</code>
            </button>
          ))}
          <button
            onClick={() => setPushes([])}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            Reset
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          2. Letzte DataLayer-Pushes ({pushes.length})
        </h2>
        {pushes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Noch nichts gepusht. Klick einen der Trigger-Buttons oben.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {pushes.map((p, i) => {
              const errs = validate(p);
              const ok = errs.length === 0;
              return (
                <div
                  key={i}
                  className={`rounded-md border p-3 text-sm ${
                    ok
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-foreground">
                      {String(p.event)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p._ts ?? 0).toLocaleTimeString()}
                    </span>
                  </div>
                  {!ok && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
                      {errs.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-xs text-foreground">
                    {JSON.stringify(p, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          3. Verify-Schritte
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <strong>GTM Preview:</strong> tagmanager.google.com → Container
            GTM-K39CL625 → <em>Preview</em> → diese URL eingeben.
          </li>
          <li>
            Hier Buttons klicken — in GTM Preview unter <em>Tags Fired</em>{" "}
            erscheint das GA4-Event-Tag (z. B. <code>quiz_started</code>).
          </li>
          <li>
            <strong>GA4 Realtime:</strong> Property öffnen →{" "}
            <em>Realtime</em>. Innerhalb von ~30 s erscheint der Event mit
            allen Top-Level-Parametern.
          </li>
          <li>
            <strong>CLI-Check:</strong> in DevTools Console{" "}
            <code>copy(JSON.stringify(window.dataLayer))</code>, dann lokal{" "}
            <code>node scripts/analytics/validate-events.mjs &lt; clipboard</code>.
          </li>
        </ol>
      </section>
    </div>
  );
}
