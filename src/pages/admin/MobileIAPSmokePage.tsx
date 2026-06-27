/**
 * Mobile-IAP Smoke Harness — Phase B.1
 *
 * Admin-only End-to-End Smoke für:
 *   Receipt → validate-iap-receipt → verify-(ios|android) →
 *   store_receipts → create_store_entitlement → entitlements →
 *   check_product_access_by_curriculum → Player-Unlock
 *
 * Hartregeln:
 *  - kein Direct-Read auf `entitlements` / `store_receipts`
 *  - kein lokaler Unlock-Fallback
 *  - Cache-Invalidation ausschließlich über `useIAPReceiptValidation`
 *  - Access-Anzeige ausschließlich über `useProductAccessByCurriculum`
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIAPReceiptValidation, type IAPPlatform } from "@/hooks/useIAPReceiptValidation";
import { useProductAccessByCurriculum } from "@/hooks/useProductAccess";
import {
  buildSmokePayload,
  SMOKE_CASE_LABELS,
  type SmokeCase,
} from "@/lib/iap/smoke-payloads";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type UIState =
  | "idle"
  | "submitting"
  | "receipt_stored"
  | "entitlement_created"
  | "duplicate_handled"
  | "invalid_blocked"
  | "failed"
  | "access_confirmed"
  | "player_unlocked";

interface RunRecord {
  ts: string;
  case: SmokeCase;
  platform: IAPPlatform;
  sku: string;
  curriculumId: string;
  dispatcher: "ok" | "error";
  duplicate?: boolean;
  receiptIdHash?: string;
  entitlementId?: string;
  errorCode?: string;
  accessGranted?: boolean;
  playerUnlocked?: boolean;
}

const shortHash = (id?: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : "—");

const STATE_BADGES: Record<UIState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  idle: { label: "idle", variant: "outline" },
  submitting: { label: "submitting receipt", variant: "secondary" },
  receipt_stored: { label: "receipt stored", variant: "secondary" },
  entitlement_created: { label: "entitlement created", variant: "secondary" },
  duplicate_handled: { label: "duplicate handled", variant: "secondary" },
  invalid_blocked: { label: "invalid blocked", variant: "destructive" },
  failed: { label: "failed", variant: "destructive" },
  access_confirmed: { label: "access confirmed", variant: "default" },
  player_unlocked: { label: "player unlocked", variant: "default" },
};

export default function MobileIAPSmokePage() {
  const { user } = useAuth();
  const [platform, setPlatform] = useState<IAPPlatform>("ios");
  const [sku, setSku] = useState<string>("");
  const [curriculumId, setCurriculumId] = useState<string>("");
  const [smokeCase, setSmokeCase] = useState<SmokeCase>("happy");
  const [lastTxId, setLastTxId] = useState<string | undefined>(undefined);
  const [uiState, setUIState] = useState<UIState>("idle");
  const [runs, setRuns] = useState<RunRecord[]>([]);

  const validation = useIAPReceiptValidation();
  const accessQuery = useProductAccessByCurriculum(curriculumId || undefined);

  // SKUs (public read; no entitlement table touched)
  const { data: skus = [] } = useQuery({
    queryKey: ["admin", "platform-skus", platform],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_skus")
        .select("sku, store_product_id")
        .eq("platform", platform)
        .eq("is_active", true)
        .order("sku");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Curricula (public catalog)
  const { data: curricula = [] } = useQuery({
    queryKey: ["admin", "curricula-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curricula")
        .select("id, title")
        .order("title")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const expiredBlocker = useMemo(
    () => smokeCase === "expired",
    [smokeCase],
  );

  async function cleanup() {
    if (!user) return;
    try {
      await supabase.rpc("cleanup_iap_smoke_artifacts" as any, { p_user_id: user.id });
    } catch {
      /* non-fatal */
    }
  }

  async function runSmoke() {
    if (!user) {
      setUIState("failed");
      return;
    }
    if (!sku || !curriculumId) {
      setUIState("failed");
      return;
    }

    if (expiredBlocker) {
      setRuns((prev) => [
        {
          ts: new Date().toISOString(),
          case: smokeCase,
          platform,
          sku,
          curriculumId,
          dispatcher: "error",
          errorCode: "not_implemented_status_lifecycle",
        },
        ...prev,
      ]);
      return;
    }

    setUIState("submitting");

    // Hygienic prefix: clean prior SMOKE artifacts for this admin user.
    if (smokeCase !== "duplicate") {
      await cleanup();
      setLastTxId(undefined);
    }

    const payload = buildSmokePayload({
      platform,
      sku,
      curriculumId,
      case: smokeCase,
      reuseTransactionId: smokeCase === "duplicate" ? lastTxId : undefined,
    });

    let res: Awaited<ReturnType<typeof validation.mutateAsync>> | null = null;
    let errorCode: string | undefined;
    try {
      res = await validation.mutateAsync(payload.invocation);
    } catch (e: any) {
      errorCode = e?.message || "unknown_error";
    }

    let nextState: UIState = "failed";
    if (!res) {
      if (smokeCase === "invalid") nextState = "invalid_blocked";
      else nextState = "failed";
    } else if (res.duplicate) {
      nextState = "duplicate_handled";
    } else if (res.entitlement_id) {
      nextState = "entitlement_created";
    } else if (res.receipt_id) {
      nextState = "receipt_stored";
    }

    // Remember transaction id so a follow-up "duplicate" run reuses it.
    if (smokeCase === "happy") {
      setLastTxId(payload.transactionId);
    }

    // Refetch the SSOT access read (no direct table query).
    let accessGranted: boolean | undefined;
    try {
      const refetched = await accessQuery.refetch();
      accessGranted = Boolean(refetched.data);
      if (accessGranted) nextState = "player_unlocked";
      else if (nextState === "entitlement_created" || nextState === "duplicate_handled") {
        nextState = "access_confirmed";
      }
    } catch {
      /* access check failure is itself a finding */
    }

    setUIState(nextState);
    setRuns((prev) => [
      {
        ts: new Date().toISOString(),
        case: smokeCase,
        platform,
        sku,
        curriculumId,
        dispatcher: res ? "ok" : "error",
        duplicate: res?.duplicate,
        receiptIdHash: res?.receipt_id,
        entitlementId: res?.entitlement_id,
        errorCode: errorCode ?? res?.error,
        accessGranted,
        playerUnlocked: accessGranted,
      },
      ...prev,
    ]);
  }

  const badge = STATE_BADGES[uiState];

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Mobile-IAP Smoke Harness</h1>
        <p className="text-sm text-muted-foreground">
          End-to-End-Verifikation des Mobile-IAP-Pfads über die bestehende SSOT.
          Liest Zugriff ausschließlich über <code>useProductAccessByCurriculum</code>.
          Keine direkten Reads auf <code>entitlements</code> oder <code>store_receipts</code>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Smoke konfigurieren
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              Plattform
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as IAPPlatform)}
              >
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </label>

            <label className="text-sm">
              Smoke-Case
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={smokeCase}
                onChange={(e) => setSmokeCase(e.target.value as SmokeCase)}
              >
                {(["happy", "duplicate", "invalid", "expired"] as SmokeCase[]).map((c) => (
                  <option key={c} value={c}>
                    {SMOKE_CASE_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              SKU
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              >
                <option value="">— wählen —</option>
                {skus.map((s: any) => (
                  <option key={s.sku} value={s.sku}>
                    {s.sku}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Curriculum
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={curriculumId}
                onChange={(e) => setCurriculumId(e.target.value)}
              >
                <option value="">— wählen —</option>
                {curricula.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {expiredBlocker && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <strong>TODO [IAP.STATUS.LIFECYCLE]</strong> — der Verifier kennt heute
              keinen Status-Update-Pfad für refund/expired/cancelled. Smoke-Run wird
              mit Blocker-Code <code>not_implemented_status_lifecycle</code> protokolliert.
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={runSmoke} disabled={!sku || !curriculumId || validation.isPending}>
              {validation.isPending ? "Läuft…" : "Smoke ausführen"}
            </Button>
            <Button variant="secondary" onClick={cleanup} disabled={!user}>
              SMOKE-Artefakte aufräumen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run-Historie</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Runs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2">Zeit</th>
                    <th className="py-1 pr-2">Case</th>
                    <th className="py-1 pr-2">Platform</th>
                    <th className="py-1 pr-2">SKU</th>
                    <th className="py-1 pr-2">Dispatcher</th>
                    <th className="py-1 pr-2">Dup</th>
                    <th className="py-1 pr-2">Receipt</th>
                    <th className="py-1 pr-2">Entitlement</th>
                    <th className="py-1 pr-2">Access</th>
                    <th className="py-1 pr-2">Player</th>
                    <th className="py-1 pr-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-2">{r.ts.replace("T", " ").slice(0, 19)}</td>
                      <td className="py-1 pr-2">{r.case}</td>
                      <td className="py-1 pr-2">{r.platform}</td>
                      <td className="py-1 pr-2">{r.sku}</td>
                      <td className="py-1 pr-2">{r.dispatcher}</td>
                      <td className="py-1 pr-2">{r.duplicate ? "yes" : "—"}</td>
                      <td className="py-1 pr-2">{shortHash(r.receiptIdHash)}</td>
                      <td className="py-1 pr-2">{shortHash(r.entitlementId)}</td>
                      <td className="py-1 pr-2">{r.accessGranted ? "✓" : "—"}</td>
                      <td className="py-1 pr-2">{r.playerUnlocked ? "✓" : "—"}</td>
                      <td className="py-1 pr-2 text-destructive">{r.errorCode ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
