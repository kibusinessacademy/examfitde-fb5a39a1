/**
 * GTM/GA4 Event Inspector — klickbarer Preview-Mode-Check + Realtime-Capture.
 *
 *  - "Trigger Event" Buttons pushen Test-Events in den DataLayer.
 *  - Realtime-Capture Toggle wrappt window.dataLayer.push und validiert
 *    JEDEN Push live, egal woher (echte App-Interaktion, GTM-internes,
 *    oder die Buttons hier).
 *  - "Copy last payload" kopiert den letzten Push als formatiertes JSON.
 *
 * Hinweis: Diese Seite ruft NICHT die Supabase-RPC auf — sie pusht direkt
 * in den DataLayer (gtmPush), damit Test-Events conversion_events nicht
 * verschmutzen. Für End-to-End mit DB siehe scripts/funnel-tracking-smoke.mjs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { gtmPush } from "@/lib/gtm";
import { toast } from "sonner";

const REQUIRED_FIELDS = [
  "event",
  "funnel_event",
  "package_id",
  "persona",
  "curriculum_id",
  "source_page",
  "page_path",
] as const;

const STRICT_GA4_EVENTS = new Set([
  "quiz_started",
  "quiz_completed",
  "checkout_started",
  "purchase_completed",
  "lead_captured",
]);

const PIXEL_REQUIRED: Record<string, string[]> = {
  checkout_started: ["package_id", "persona", "value", "currency"],
  purchase_completed: ["package_id", "persona", "value", "currency", "transaction_id"],
};

// System events that aren't funnel pushes — skip strict validation but still display.
const SYSTEM_EVENTS = new Set([
  "spa_pageview",
  "consent_update",
  "gtm.js",
  "gtm.dom",
  "gtm.load",
  "gtm.click",
  "gtm.linkClick",
  "gtm.formSubmit",
  "gtm.scrollDepth",
  "gtm.elementVisibility",
  "gtm.timer",
  "gtm.video",
  "gtm.historyChange",
]);

type Push = Record<string, unknown> & {
  _ts?: number;
  _origin_capture?: "button" | "realtime";
};

type Validation = { ok: boolean; skipped: boolean; errors: string[] };

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
      value: 49,
      currency: "EUR",
      _origin: "event_inspector",
    }),
  },
  {
    label: "purchase_completed",
    ga4: "purchase_completed",
    funnel: "checkout_complete",
    payload: () => {
      const tx = `inspector_${Date.now()}`;
      return {
        event: "purchase_completed",
        funnel_event: "checkout_complete",
        package_id: TEST_PACKAGE_ID,
        persona: "azubi",
        curriculum_id: null,
        source_page: window.location.pathname,
        page_path: window.location.pathname,
        order_id: tx,
        transaction_id: tx,
        value: 49,
        currency: "EUR",
        _origin: "event_inspector",
      };
    },
  },
];

function validate(p: Record<string, unknown>): Validation {
  if (typeof p !== "object" || p === null || !p.event) {
    return { ok: false, skipped: false, errors: ['fehlt: "event"'] };
  }
  if (SYSTEM_EVENTS.has(String(p.event))) {
    return { ok: true, skipped: true, errors: [] };
  }
  const errors: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (!(f in p)) errors.push(`fehlt: ${f}`);
  }
  const ev = String(p.event);
  if (STRICT_GA4_EVENTS.has(ev) && (p.package_id == null || p.package_id === "")) {
    errors.push("strict: package_id ist null");
  }
  const pixel = PIXEL_REQUIRED[ev];
  if (pixel) {
    for (const f of pixel) {
      const v = (p as any)[f];
      if (v == null || v === "") errors.push(`pixel: fehlt ${f}`);
    }
  }
  return { ok: errors.length === 0, skipped: false, errors };
}

export default function EventInspectorPage() {
  const [pushes, setPushes] = useState<Push[]>([]);
  const [debugOn, setDebugOn] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const originalPushRef = useRef<typeof Array.prototype.push | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("ef_gtm_debug", "1");
      setDebugOn(true);
    } catch {
      /* noop */
    }
  }, []);

  // Realtime capture: monkey-patch window.dataLayer.push so we see ALL pushes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!realtime) return;
    window.dataLayer = window.dataLayer || [];
    const dl = window.dataLayer as unknown[] & { push: (...args: unknown[]) => number };
    const original = dl.push.bind(dl);
    originalPushRef.current = original as any;

    const wrapped = (...args: unknown[]) => {
      try {
        for (const a of args) {
          if (a && typeof a === "object" && !Array.isArray(a)) {
            setPushes((prev) =>
              [
                { ...(a as Record<string, unknown>), _ts: Date.now(), _origin_capture: "realtime" as const },
                ...prev,
              ].slice(0, 50),
            );
          }
        }
      } catch {
        /* noop */
      }
      return original(...args);
    };
    dl.push = wrapped as any;

    return () => {
      try {
        if (originalPushRef.current) {
          (window.dataLayer as any).push = originalPushRef.current;
        }
      } catch {
        /* noop */
      }
    };
  }, [realtime]);

  const trigger = (idx: number) => {
    const p = SCENARIOS[idx].payload();
    gtmPush(p);
    if (!realtime) {
      // In non-realtime mode the wrapper isn't installed; record manually.
      setPushes((prev) =>
        [{ ...p, _ts: Date.now(), _origin_capture: "button" }, ...prev].slice(0, 50),
      );
    }
  };

  const lastPush = pushes[0];
  const lastValidation = useMemo(
    () => (lastPush ? validate(lastPush) : null),
    [lastPush],
  );

  const copyLast = async () => {
    if (!lastPush) {
      toast.error("Kein Payload zum Kopieren — erst Event triggern");
      return;
    }
    // Strip internal fields
    const { _ts, _origin_capture, ...clean } = lastPush;
    const json = JSON.stringify(clean, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      const v = validate(clean);
      if (v.skipped) {
        toast.message("Kopiert (System-Event, übersprungen)", { description: String(clean.event) });
      } else if (v.ok) {
        toast.success("Payload kopiert ✓ Schema OK", { description: String(clean.event) });
      } else {
        toast.warning(`Payload kopiert — ${v.errors.length} Fehler`, {
          description: v.errors.join(" · "),
        });
      }
    } catch {
      toast.error("Konnte nicht kopieren");
    }
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">1. Trigger</h2>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              data-testid="realtime-toggle"
              checked={realtime}
              onChange={(e) => setRealtime(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Realtime-Capture (alle dataLayer.push)
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              data-testid={`trigger-${s.label}`}
              onClick={() => trigger(i)}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Trigger <code>{s.label}</code>
            </button>
          ))}
          <button
            data-testid="copy-last"
            onClick={copyLast}
            disabled={!lastPush}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-40"
          >
            Copy last payload
            {lastValidation && !lastValidation.skipped && (
              <span
                data-testid="copy-last-status"
                className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${
                  lastValidation.ok
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                }`}
              >
                {lastValidation.ok ? "OK" : `${lastValidation.errors.length}✗`}
              </span>
            )}
          </button>
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
            Noch nichts gepusht. Klick einen der Trigger-Buttons oben oder
            aktiviere Realtime-Capture und interagiere mit der App.
          </p>
        ) : (
          <div className="mt-3 space-y-3" data-testid="push-list">
            {pushes.map((p, i) => {
              const v = validate(p);
              const tone = v.skipped
                ? "border-border bg-muted/20"
                : v.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5";
              return (
                <div
                  key={i}
                  data-testid={`push-row-${String(p.event)}`}
                  className={`rounded-md border p-3 text-sm ${tone}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-foreground">
                      {String(p.event)}
                      {p._origin_capture === "realtime" && (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          realtime
                        </span>
                      )}
                      {v.skipped && (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          system / skipped
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p._ts ?? 0).toLocaleTimeString()}
                    </span>
                  </div>
                  {!v.ok && !v.skipped && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
                      {v.errors.map((e) => (
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
          <li>
            <strong>GTM-Container-Setup:</strong> siehe{" "}
            <code>docs/analytics/gtm-container-checklist.md</code>.
          </li>
        </ol>
      </section>
    </div>
  );
}
