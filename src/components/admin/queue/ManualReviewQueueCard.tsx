/**
 * ManualReviewQueueCard
 * ─────────────────────
 * Steps mit Cascade-Trigger-Konflikten — werden NICHT automatisch geheilt.
 * Admin kann Status auf investigating / resolved / wont_fix setzen + Notiz.
 */
import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchManualReviewQueue, updateManualReview,
  type ManualReviewRow, type ManualReviewStatus,
} from "@/lib/admin/queue/pendingEnqueueApi";
import { toast } from "@/hooks/use-toast";

const STATUS_VARIANT: Record<ManualReviewStatus, "destructive" | "secondary" | "default" | "outline"> = {
  open: "destructive",
  investigating: "secondary",
  resolved: "default",
  wont_fix: "outline",
};

export function ManualReviewQueueCard() {
  const [rows, setRows] = useState<ManualReviewRow[]>([]);
  const [filter, setFilter] = useState<ManualReviewStatus | "all">("open");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editStatus, setEditStatus] = useState<ManualReviewStatus>("investigating");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchManualReviewQueue(filter));
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (r: ManualReviewRow) => {
    setEditing(r.id);
    setEditNote(r.resolution_note ?? "");
    setEditStatus(r.status === "open" ? "investigating" : r.status);
  };

  const save = async () => {
    if (!editing) return;
    try {
      await updateManualReview(editing, { status: editStatus, resolution_note: editNote });
      toast({ title: "Gespeichert", description: `Status → ${editStatus}` });
      setEditing(null);
      load();
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Manual Review Queue
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Steps mit wiederholtem reschedule_failed — keine Auto-Heilung
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as ManualReviewStatus | "all")}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="wont_fix">Won't Fix</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Einträge mit Status „{filter}".</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="p-3 border rounded-md bg-card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      <code className="text-xs">{r.step_key}</code>
                      <Badge variant="outline">{r.failure_count}× failed</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      pkg: {r.package_id}
                    </div>
                    {r.last_error && (
                      <div className="text-xs text-destructive mt-1 truncate" title={r.last_error}>
                        {r.last_error}
                      </div>
                    )}
                    {r.resolution_note && (
                      <div className="text-xs mt-1 italic">📝 {r.resolution_note}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <div>First: {new Date(r.first_failed_at).toLocaleString()}</div>
                    <div>Last: {new Date(r.last_failed_at).toLocaleString()}</div>
                  </div>
                </div>
                {editing === r.id ? (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as ManualReviewStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="investigating">Investigating</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="wont_fix">Won't Fix</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Resolution-Notiz (Root-Cause, Maßnahme...)"
                      value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={save}>Speichern</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Abbrechen</Button>
                    </div>
                  </div>
                ) : (
                  r.status !== "resolved" && r.status !== "wont_fix" && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => startEdit(r)}>
                      Bearbeiten
                    </Button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
