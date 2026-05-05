/**
 * PackageActionsMenu — universaler Drop-Down pro Paket im Heal-Cockpit.
 * Aktionen:
 *   - Copy package_id
 *   - Copy Forensik-Bundle (full JSON)
 *   - Run AI Diagnosis (calls ai-forensic-diagnose edge fn, zeigt Drawer)
 *   - Retry failed Step (Quick-Retry quality_council per default)
 *   - Bronze Targeted Repair (admin_bronze_targeted_repair_dispatch)
 *   - Bulk Promote queued→building (admin_bulk_promote_queued_to_building, mit Confirm)
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Copy, Sparkles, RotateCcw, ShieldCheck, Rocket, FileJson, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { copyForensicBundle } from "./forensicBundle";
import { CopyButton } from "./CopyButton";

interface Props {
  packageId: string;
  packageKey?: string | null;
  variant?: "icon" | "button";
  /** ggf. failed step_key vorgeben — sonst quality_council default */
  defaultRetryStep?: string;
  /** ist dieses Paket bronze-locked? */
  bronzeLocked?: boolean;
}

interface Diagnosis {
  severity: "info" | "warn" | "error" | "critical";
  summary: string;
  root_cause: string;
  recommended_actions: { action: string; target?: string; rationale: string }[];
  confidence: number;
}

export function PackageActionsMenu({ packageId, packageKey, variant = "icon", defaultRetryStep = "quality_council", bronzeLocked }: Props) {
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const runAi = useMutation({
    mutationFn: async () => {
      setDiagLoading(true);
      setDiagOpen(true);
      const { data, error } = await supabase.functions.invoke("ai-forensic-diagnose", {
        body: { package_id: packageId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any).diagnosis as Diagnosis;
    },
    onSuccess: (d) => {
      setDiagnosis(d);
      setDiagLoading(false);
      toast.success("AI-Diagnose fertig", { description: d.summary });
    },
    onError: (e: any) => {
      setDiagLoading(false);
      toast.error("AI-Diagnose fehlgeschlagen", { description: e?.message ?? String(e) });
    },
  });

  const retry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_retry_failed_step" as any, {
        p_package_id: packageId,
        p_step_key: defaultRetryStep,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success(`Retry für ${defaultRetryStep} ausgelöst`),
    onError: (e: any) => toast.error("Retry blockiert", { description: e?.message ?? String(e) }),
  });

  const bronzeRepair = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_bronze_targeted_repair_dispatch" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Bronze-Repair dispatched"),
    onError: (e: any) => toast.error("Bronze-Repair fehlgeschlagen", { description: e?.message ?? String(e) }),
  });

  const bulkPromote = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_nudge_atomic_trigger" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Promote (queued→building) gestartet"),
    onError: (e: any) => toast.error("Promote fehlgeschlagen", { description: e?.message ?? String(e) }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "icon" ? (
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreVertical className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Aktionen
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] font-mono text-muted-foreground truncate">
            {packageKey ?? packageId}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={async (e) => { e.preventDefault(); await navigator.clipboard.writeText(packageId); toast.success("package_id kopiert"); }}
          >
            <Copy className="h-4 w-4 mr-2" /> Copy package_id
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={async (e) => {
              e.preventDefault();
              try {
                const json = await copyForensicBundle(packageId);
                await navigator.clipboard.writeText(json);
                toast.success("Forensik-Bundle kopiert", { description: `${json.length} Zeichen JSON` });
              } catch (err: any) {
                toast.error("Bundle-Erstellung fehlgeschlagen", { description: err?.message });
              }
            }}
          >
            <FileJson className="h-4 w-4 mr-2" /> Copy Forensik-Bundle
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={(e) => { e.preventDefault(); runAi.mutate(); }}>
            <Sparkles className="h-4 w-4 mr-2" /> Run AI Diagnosis
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] text-muted-foreground">Heal-Aktionen</DropdownMenuLabel>

          <DropdownMenuItem onClick={(e) => { e.preventDefault(); retry.mutate(); }}>
            <RotateCcw className="h-4 w-4 mr-2" /> Retry {defaultRetryStep}
          </DropdownMenuItem>

          {bronzeLocked && (
            <DropdownMenuItem onClick={(e) => { e.preventDefault(); bronzeRepair.mutate(); }}>
              <ShieldCheck className="h-4 w-4 mr-2" /> Bronze Targeted Repair
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              if (confirm("Promote queued→building für dieses Paket starten?")) bulkPromote.mutate();
            }}
          >
            <Rocket className="h-4 w-4 mr-2" /> Promote queued→building
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={diagOpen} onOpenChange={setDiagOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI-Forensik-Diagnose
            </SheetTitle>
            <SheetDescription className="font-mono text-[10px] flex items-center gap-1">
              {packageKey ?? packageId}
              <CopyButton value={packageId} toastLabel="package_id kopiert" />
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {diagLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Sammle Forensik-Bundle und analysiere via Lovable AI…
              </div>
            )}
            {diagnosis && !diagLoading && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={diagnosis.severity === "critical" || diagnosis.severity === "error" ? "destructive" : "outline"}>
                    {diagnosis.severity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Confidence {(diagnosis.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
                    Summary
                    <CopyButton value={diagnosis.summary} toastLabel="Summary kopiert" />
                  </h4>
                  <p className="text-sm">{diagnosis.summary}</p>
                </section>

                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
                    Root Cause
                    <CopyButton value={diagnosis.root_cause} toastLabel="Root-Cause kopiert" />
                  </h4>
                  <p className="text-sm">{diagnosis.root_cause}</p>
                </section>

                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Empfohlene Aktionen</h4>
                  <ol className="space-y-2">
                    {diagnosis.recommended_actions.map((a, i) => (
                      <li key={i} className="rounded-md border p-2 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-semibold">{a.action}{a.target ? ` · ${a.target}` : ""}</span>
                          <CopyButton value={JSON.stringify(a, null, 2)} toastLabel="Aktion kopiert" />
                        </div>
                        <p className="text-muted-foreground">{a.rationale}</p>
                      </li>
                    ))}
                  </ol>
                </section>

                <CopyButton
                  variant="button"
                  label="Komplette Diagnose als JSON kopieren"
                  value={() => JSON.stringify(diagnosis, null, 2)}
                  toastLabel="Diagnose-JSON kopiert"
                  className="w-full"
                />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
