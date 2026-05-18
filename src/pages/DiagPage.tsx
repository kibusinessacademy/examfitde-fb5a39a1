import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Status = "pending" | "ok" | "fail";
interface Check { label: string; status: Status; detail?: string }

export default function DiagPage() {
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const pid = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    const host = typeof window !== "undefined" ? window.location.hostname : "ssr";

    const init: Check[] = [
      { label: "Host", status: "ok", detail: host },
      { label: "import.meta.env.PROD", status: "ok", detail: String(import.meta.env.PROD) },
      { label: "VITE_SUPABASE_URL", status: url ? "ok" : "fail", detail: url ?? "MISSING" },
      { label: "VITE_SUPABASE_PUBLISHABLE_KEY", status: key ? "ok" : "fail", detail: key ? `${key.slice(0, 12)}…(${key.length} chars)` : "MISSING" },
      { label: "VITE_SUPABASE_PROJECT_ID", status: pid ? "ok" : "fail", detail: pid ?? "MISSING" },
      { label: "Supabase REST ping", status: "pending" },
      { label: "Supabase RPC (auth.getSession)", status: "pending" },
      { label: "GET /aevo-pruefung (same-origin)", status: "pending" },
      { label: "AEVO <title> contains 'AEVO'", status: "pending" },
    ];
    setChecks(init);

    (async () => {
      const next = [...init];

      // REST ping
      if (url && key) {
        try {
          const r = await fetch(`${url}/rest/v1/?apikey=${key}`, { headers: { apikey: key } });
          next[5] = { label: init[5].label, status: r.ok ? "ok" : "fail", detail: `HTTP ${r.status}` };
        } catch (e: any) {
          next[5] = { label: init[5].label, status: "fail", detail: e?.message ?? "network error" };
        }
      } else {
        next[5] = { label: init[5].label, status: "fail", detail: "skipped — env missing" };
      }

      // Supabase client
      try {
        const { error } = await supabase.auth.getSession();
        next[6] = { label: init[6].label, status: error ? "fail" : "ok", detail: error?.message ?? "session retrieved" };
      } catch (e: any) {
        next[6] = { label: init[6].label, status: "fail", detail: e?.message ?? "client error" };
      }

      setChecks([...next]);

      // /aevo-pruefung fetch
      try {
        const r = await fetch("/aevo-pruefung", { headers: { accept: "text/html" } });
        const html = await r.text();
        next[7] = { label: init[7].label, status: r.ok ? "ok" : "fail", detail: `HTTP ${r.status} · ${html.length} bytes` };
        const m = html.match(/<title>([^<]*)<\/title>/i);
        const title = m?.[1]?.trim() ?? "(no <title>)";
        const ok = /aevo/i.test(title);
        next[8] = { label: init[8].label, status: ok ? "ok" : "fail", detail: title };
      } catch (e: any) {
        next[7] = { label: init[7].label, status: "fail", detail: e?.message ?? "fetch error" };
        next[8] = { label: init[8].label, status: "fail", detail: "skipped" };
      }
      setChecks([...next]);
    })();
  }, []);

  const allOk = checks.length > 0 && checks.every((c) => c.status === "ok");
  const anyFail = checks.some((c) => c.status === "fail");

  return (
    <main className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Verbindungs-Diagnose</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Prüft VITE_SUPABASE-Env-Vars, Backend-Reachability und SSR-/Prerender-Status für <code>/aevo-pruefung</code>.
      </p>
      <div className={`mb-6 rounded-md p-3 text-sm border ${anyFail ? "border-destructive text-destructive" : allOk ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : "border-border text-muted-foreground"}`}>
        {anyFail ? "❌ Mindestens ein Check ist fehlgeschlagen." : allOk ? "✅ Alle Checks grün." : "⏳ Läuft…"}
      </div>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.label} className="rounded-md border border-border p-3 flex items-start gap-3">
            <span aria-hidden className="text-lg leading-none mt-0.5">
              {c.status === "ok" ? "✅" : c.status === "fail" ? "❌" : "⏳"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{c.label}</div>
              {c.detail && <div className="text-xs text-muted-foreground break-all mt-0.5">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-muted-foreground">
        Tipp: Wenn die ersten 3 ENV-Checks rot sind, sind die Vercel-Variablen nicht gesetzt oder das Deployment wurde nicht ohne Build-Cache neu gebaut.
      </p>
    </main>
  );
}
