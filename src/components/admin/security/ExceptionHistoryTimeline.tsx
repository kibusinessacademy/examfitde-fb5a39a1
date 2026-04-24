/**
 * ExceptionHistoryTimeline
 * ────────────────────────
 * Chronologische Anzeige aller Änderungen einer Finding-Ausnahme mit
 * Rollback auf einen ausgewählten Stand (oder den Stand davor).
 */
import { useEffect, useState } from "react";
import { History, RotateCcw, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  listExceptionHistory,
  rollbackToHistoryEntry,
  rollbackBeforeEntry,
  type ExceptionHistoryRow,
} from "@/lib/admin/security/findingExceptionHistoryApi";

interface Props {
  scannerName: string;
  internalId: string;
  onChanged?: () => void;
}

const ACTION_META: Record<ExceptionHistoryRow["action"], { icon: typeof Plus; tone: string; label: string }> = {
  created: { icon: Plus, tone: "text-emerald-600 dark:text-emerald-400", label: "Erstellt" },
  updated: { icon: Pencil, tone: "text-amber-600 dark:text-amber-400", label: "Geändert" },
  deleted: { icon: Trash2, tone: "text-destructive", label: "Gelöscht" },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function fieldDiff(prev: unknown, next: unknown): string | null {
  if (prev === next) return null;
  if (prev == null && next == null) return null;
  return `${prev ?? "—"} → ${next ?? "—"}`;
}

export function ExceptionHistoryTimeline({ scannerName, internalId, onChanged }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ExceptionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await listExceptionHistory(scannerName, internalId);
      setRows(r);
    } catch (e) {
      toast({
        title: "Historie nicht ladbar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerName, internalId]);

  async function doRollback(entry: ExceptionHistoryRow, mode: "to" | "before") {
    setBusyId(entry.id);
    try {
      if (mode === "to") await rollbackToHistoryEntry(entry);
      else await rollbackBeforeEntry(entry);
      toast({ title: "Rollback ausgeführt" });
      onChanged?.();
      await load();
    } catch (e) {
      toast({
        title: "Rollback fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" /> Exception-Historie
          <Badge variant="outline" className="ml-auto text-[10px]">{rows.length} Einträge</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-xs text-muted-foreground">Lade …</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">Noch keine Änderungen protokolliert.</p>
        )}
        {!loading && rows.length > 0 && (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {rows.map((r, idx) => {
              const meta = ACTION_META[r.action];
              const Icon = meta.icon;
              const diffs: string[] = [];
              const sd = fieldDiff(r.prev_status, r.new_status);
              if (sd) diffs.push(`status: ${sd}`);
              const rd = fieldDiff(r.prev_reason, r.new_reason);
              if (rd) diffs.push(`reason: ${rd}`);
              const ad = fieldDiff(r.prev_accepted_until_audit, r.new_accepted_until_audit);
              if (ad) diffs.push(`audit: ${ad}`);
              const dd = fieldDiff(r.prev_accepted_until_date, r.new_accepted_until_date);
              if (dd) diffs.push(`date: ${dd}`);
              const pd = fieldDiff(r.prev_priority, r.new_priority);
              if (pd) diffs.push(`priority: ${pd}`);

              return (
                <li key={r.id} className="relative">
                  <span className="absolute -left-[21px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-2 ring-border">
                    <Icon className={`h-2.5 w-2.5 ${meta.tone}`} />
                  </span>
                  <div className="space-y-1 rounded-md border border-border bg-card p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${meta.tone}`}>{meta.label}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDate(r.changed_at)}</span>
                    </div>
                    {diffs.length > 0 ? (
                      <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                        {diffs.map((d, i) => (
                          <li key={i}>· {d}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {r.action === "created" ? "Initialer Stand angelegt." : "Keine Diff-Felder."}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={busyId === r.id || r.action === "deleted"}
                        onClick={() => doRollback(r, "to")}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Auf diesen Stand
                      </Button>
                      {idx === 0 && r.action !== "deleted" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          disabled={busyId === r.id}
                          onClick={() => doRollback(r, "before")}
                        >
                          ← Stand davor
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
