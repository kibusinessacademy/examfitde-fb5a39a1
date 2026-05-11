/**
 * SeoThresholdsDialog
 *
 * Admin-Panel zur Konfiguration der SEO-Alert-Schwellwerte.
 * SSOT: ops_seo_alert_thresholds via admin_get_seo_alert_thresholds() / admin_set_seo_alert_threshold(key, value, reason).
 * Audit: auto_heal_log.action_type='seo_alert_threshold_update'.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, RotateCcw, Sliders } from "lucide-react";

type ThresholdRow = {
  threshold_key: string;
  threshold_value: number;
  severity: "warn" | "critical";
  description: string | null;
  updated_at: string;
  updated_by: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SeoThresholdsDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const thresholds = useQuery({
    queryKey: ["seo-alert-thresholds"],
    queryFn: async (): Promise<ThresholdRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_alert_thresholds" as never,
      );
      if (error) throw error;
      return (data as unknown as ThresholdRow[]) ?? [];
    },
    staleTime: 30_000,
    enabled: open,
  });

  // Reset Edits wenn Dialog geöffnet/geschlossen wird
  useEffect(() => {
    if (open) {
      setEdits({});
      setReason("");
    }
  }, [open]);

  const dirtyKeys = useMemo(() => {
    if (!thresholds.data) return [] as string[];
    return thresholds.data
      .filter((t) => {
        const raw = edits[t.threshold_key];
        if (raw === undefined || raw === "") return false;
        const num = Number(raw);
        return Number.isFinite(num) && num >= 0 && num !== Number(t.threshold_value);
      })
      .map((t) => t.threshold_key);
  }, [edits, thresholds.data]);

  const reasonValid = reason.trim().length >= 5;
  const canSave = dirtyKeys.length > 0 && reasonValid;

  const update = useMutation({
    mutationFn: async () => {
      if (!thresholds.data) throw new Error("no thresholds loaded");
      const results: { key: string; ok: boolean; error?: string }[] = [];
      for (const key of dirtyKeys) {
        const raw = edits[key];
        const value = Number(raw);
        const { error } = await supabase.rpc(
          "admin_set_seo_alert_threshold" as never,
          {
            p_threshold_key: key,
            p_threshold_value: value,
            p_reason: reason.trim(),
          } as never,
        );
        results.push({ key, ok: !error, error: error?.message });
      }
      return results;
    },
    onSuccess: (results) => {
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        toast.error(
          `${failed.length} Threshold(s) fehlgeschlagen: ${failed
            .map((f) => `${f.key}: ${f.error}`)
            .join("; ")}`,
        );
      } else {
        toast.success(
          `${results.length} Threshold(s) aktualisiert. SEO Job Health wird neu bewertet.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["seo-alert-thresholds"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "seo-job-health"] });
      setEdits({});
      setReason("");
    },
    onError: (err: Error) => toast.error(`Update fehlgeschlagen: ${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4" />
            SEO Alert Schwellwerte
          </DialogTitle>
          <DialogDescription>
            Konfiguriert wann <code className="font-mono">admin_get_seo_job_health()</code>{" "}
            <Badge variant="destructive" className="mx-1 align-middle">CRIT</Badge>
            oder <Badge className="mx-1 align-middle bg-warning text-warning-foreground hover:bg-warning/90">WARN</Badge>
            meldet. Änderungen wirken sofort, jeder Save wird in <code className="font-mono">auto_heal_log</code> auditiert.
          </DialogDescription>
        </DialogHeader>

        {thresholds.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : thresholds.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle p-3 text-sm text-destructive">
            Fehler: {(thresholds.error as Error).message}
          </div>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Schlüssel / Beschreibung</TableHead>
                  <TableHead className="w-32 text-right">Aktuell</TableHead>
                  <TableHead className="w-32 text-right">Neu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(thresholds.data ?? []).map((t) => {
                  const editVal = edits[t.threshold_key];
                  const dirty = dirtyKeys.includes(t.threshold_key);
                  return (
                    <TableRow key={t.threshold_key} className={dirty ? "bg-warning-bg-subtle/40" : undefined}>
                      <TableCell>
                        {t.severity === "critical" ? (
                          <Badge variant="destructive">CRIT</Badge>
                        ) : (
                          <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">
                            WARN
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs text-text-primary">{t.threshold_key}</div>
                        {t.description ? (
                          <div className="text-xs text-text-secondary">{t.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-text-secondary">
                        {Number(t.threshold_value)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="h-8 text-right tabular-nums"
                          placeholder={String(t.threshold_value)}
                          value={editVal ?? ""}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [t.threshold_key]: e.target.value,
                            }))
                          }
                          disabled={update.isPending}
                          aria-label={`Neuer Wert für ${t.threshold_key}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="space-y-2">
              <Label htmlFor="seo-threshold-reason" className="text-xs">
                Begründung <span className="text-destructive">*</span> (min. 5 Zeichen)
              </Label>
              <Textarea
                id="seo-threshold-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="z. B. Threshold lockern weil neue Producer-Logik mehr EMPTY_RESULT erzeugt"
                rows={2}
                disabled={update.isPending}
              />
            </div>

            {dirtyKeys.length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning-bg-subtle px-3 py-2 text-xs text-text-secondary">
                <strong className="text-text-primary">{dirtyKeys.length}</strong> Threshold(s) werden geändert:{" "}
                <code className="font-mono">{dirtyKeys.join(", ")}</code>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEdits({});
              setReason("");
            }}
            disabled={update.isPending || (Object.keys(edits).length === 0 && !reason)}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Zurücksetzen
          </Button>
          <Button
            size="sm"
            onClick={() => update.mutate()}
            disabled={!canSave || update.isPending}
          >
            <Save className="mr-1 h-3 w-3" />
            {update.isPending
              ? "Speichern…"
              : dirtyKeys.length > 0
                ? `${dirtyKeys.length} speichern`
                : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
