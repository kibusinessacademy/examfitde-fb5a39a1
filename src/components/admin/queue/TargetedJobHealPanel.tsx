/**
 * TargetedJobHealPanel
 * ────────────────────
 * Listet die zuletzt betroffenen package_run_integrity_check Jobs für ein Paket
 * und erlaubt einen gezielten Batch-Heal.
 *
 * Pro job_id wird das Resultat (ok / Fehlertext / step_reset) angezeigt.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCcw, Wrench, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  healJobsTargeted,
  listRecentIntegrityJobs,
  type TargetedHealResult,
} from "@/lib/admin/queue/zombieHealApi";

interface Props {
  packageId: string;
}

export function TargetedJobHealPanel({ packageId }: Props) {
  const recent = useQuery({
    queryKey: ["targeted-heal-recent", packageId],
    queryFn: () => listRecentIntegrityJobs(packageId, 5),
    enabled: !!packageId,
    staleTime: 10_000,
  });

  const rows = recent.data ?? [];
  const healable = useMemo(
    () => rows.filter((r) => r.status === "processing" || r.status === "running"),
    [rows],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<TargetedHealResult[]>([]);
  const [running, setRunning] = useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAllHealable = () => setSelected(new Set(healable.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const runHeal = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast.warning("Keine job_ids ausgewählt");
      return;
    }
    setRunning(true);
    setResults([]);
    try {
      const res = await healJobsTargeted(ids, "runbook_targeted_batch");
      setResults(res);
      const okCount = res.filter((r) => r.ok).length;
      const failCount = res.length - okCount;
      if (failCount === 0) {
        toast.success(`Alle ${okCount} Jobs erfolgreich geheilt`);
      } else if (okCount === 0) {
        toast.error(`Alle ${failCount} Heals fehlgeschlagen`);
      } else {
        toast.warning(`${okCount} ok · ${failCount} fehlgeschlagen`);
      }
      void recent.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const resultFor = (id: string) => results.find((r) => r.job_id === id);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-primary" />
          Targeted Heal · letzte Integrity-Jobs
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
          {healable.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {healable.length} healbar
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => void recent.refetch()}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> Reload
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recent.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade…
          </div>
        )}
        {!recent.isLoading && rows.length === 0 && (
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            Keine kürzlichen Integrity-Jobs gefunden.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2"
                onClick={selectAllHealable}
                disabled={healable.length === 0 || running}
              >
                Alle healbaren wählen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={clearSelection}
                disabled={selected.size === 0 || running}
              >
                Auswahl leeren
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-6 px-2"
                onClick={runHeal}
                disabled={selected.size === 0 || running}
              >
                {running ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Wrench className="mr-1 h-3 w-3" />
                )}
                Heal {selected.size > 0 ? `(${selected.size})` : ""} ausführen
              </Button>
            </div>

            <ul className="space-y-1">
              {rows.map((j) => {
                const isHealable = j.status === "processing" || j.status === "running";
                const r = resultFor(j.id);
                return (
                  <li
                    key={j.id}
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                      r?.ok
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : r && !r.ok
                        ? "border-destructive/50 bg-destructive/5"
                        : isHealable
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(j.id)}
                      onCheckedChange={() => toggle(j.id)}
                      disabled={!isHealable || running}
                      aria-label={`Job ${j.id} auswählen`}
                    />
                    <span className="font-mono text-[11px] text-primary">{j.id.slice(0, 8)}…</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{j.status}</Badge>
                    <span className="text-[10px] text-muted-foreground">attempts: {j.attempts}</span>
                    {j.locked_by && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {j.locked_by.slice(0, 16)}
                      </span>
                    )}
                    {j.last_error && (
                      <span
                        className="max-w-[260px] truncate text-[10px] text-muted-foreground"
                        title={j.last_error}
                      >
                        {j.last_error}
                      </span>
                    )}
                    <div className="ml-auto">
                      {r?.ok && (
                        <Badge className="bg-emerald-500/20 text-emerald-700 text-[10px]">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          ok{r.step_reset ? " · step reset" : ""}
                        </Badge>
                      )}
                      {r && !r.ok && (
                        <Badge variant="destructive" className="text-[10px]" title={r.error}>
                          <XCircle className="mr-1 h-3 w-3" />
                          {r.error?.slice(0, 32) ?? "fail"}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
