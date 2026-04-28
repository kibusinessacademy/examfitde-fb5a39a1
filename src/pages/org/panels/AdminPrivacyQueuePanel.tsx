import { useEffect, useState } from "react";
import { adminListPrivacyRequests, adminPrivacyDecision } from "@/lib/orgApi";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, ShieldCheck, ShieldX, ShieldOff } from "lucide-react";

type PrivacyRequest = {
  organization_id: string;
  org_name: string | null;
  org_type: string | null;
  status: string;
  scope: string;
  requested_by: string | null;
  requested_at: string | null;
  approved_until: string | null;
  admin_notes: string | null;
};

export default function AdminPrivacyQueuePanel() {
  const [status, setStatus] = useState("REQUESTED");
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisionOpen, setDecisionOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PrivacyRequest | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "DENY" | "REVOKE">("APPROVE");
  const [days, setDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListPrivacyRequests({ status });
      setRequests(res?.requests ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  function openDecision(r: PrivacyRequest) {
    setSelectedReq(r);
    setDecision(r.status === "APPROVED" ? "REVOKE" : "APPROVE");
    setDays(30);
    setNotes("");
    setDecisionOpen(true);
  }

  async function submitDecision() {
    if (!selectedReq) return;
    setSaving(true);
    try {
      await adminPrivacyDecision({
        organization_id: selectedReq.organization_id,
        decision,
        days: decision === "APPROVE" ? days : undefined,
        admin_notes: notes || undefined,
      });
      setDecisionOpen(false);
      await load();
    } catch (e) {
      console.error("adminPrivacyDecision failed", e);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const rows = requests.map((r) => ({
      organization_id: r.organization_id,
      org_name: r.org_name ?? "",
      org_type: r.org_type ?? "",
      status: r.status,
      scope: r.scope,
      requested_at: r.requested_at ?? "",
      approved_until: r.approved_until ?? "",
      admin_notes: r.admin_notes ?? "",
    }));
    downloadCsv(`privacy_requests_${status}.csv`, toCsv(rows));
  }

  const statusBadge = (s: string) => {
    if (s === "APPROVED") return "bg-success-bg-subtle text-success border border-success/20";
    if (s === "REQUESTED") return "bg-warning-bg-subtle text-warning border border-warning/20";
    if (s === "DENIED") return "bg-danger-bg-subtle text-danger border border-danger/20";
    return "bg-surface-sunken text-text-muted border border-border-subtle";
  };

  return (
    <div className="space-y-4" data-density="comfortable">
      <Card variant="raised">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg font-display">Admin: Privacy-Anfragen</CardTitle>
            <div className="flex gap-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REQUESTED">Offen</SelectItem>
                  <SelectItem value="APPROVED">Genehmigt</SelectItem>
                  <SelectItem value="DENIED">Abgelehnt</SelectItem>
                  <SelectItem value="EXPIRED">Abgelaufen</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-danger mb-3">{error}</p>}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-petrol-600" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-text-muted">Keine Anfragen mit Status „{status}".</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Angefragt</TableHead>
                  <TableHead>Gültig bis</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.organization_id}>
                    <TableCell className="font-medium text-text-primary">{r.org_name ?? r.organization_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs text-text-muted">{r.org_type ?? "–"}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-text-secondary">{r.requested_at ? new Date(r.requested_at).toLocaleDateString("de-DE") : "–"}</TableCell>
                    <TableCell className="text-xs tabular-nums text-text-secondary">{r.approved_until ? new Date(r.approved_until).toLocaleDateString("de-DE") : "–"}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => openDecision(r)}>
                        Entscheiden
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Decision Dialog */}
      <Dialog open={decisionOpen} onOpenChange={setDecisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Privacy-Entscheidung: {selectedReq?.org_name ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Entscheidung</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVE">
                    <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Genehmigen</span>
                  </SelectItem>
                  <SelectItem value="DENY">
                    <span className="flex items-center gap-1"><ShieldX className="h-3.5 w-3.5" /> Ablehnen</span>
                  </SelectItem>
                  <SelectItem value="REVOKE">
                    <span className="flex items-center gap-1"><ShieldOff className="h-3.5 w-3.5" /> Widerrufen</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {decision === "APPROVE" && (
              <div>
                <Label>Gültigkeitsdauer (Tage)</Label>
                <Input type="number" value={days} min={1} max={365} onChange={(e) => setDays(parseInt(e.target.value || "30", 10))} />
              </div>
            )}
            <div>
              <Label>Admin-Notiz</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionOpen(false)}>Abbrechen</Button>
            <Button onClick={submitDecision} disabled={saving}>{saving ? "Speichern…" : "Bestätigen"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
