/**
 * FindingExceptionDialog
 * ──────────────────────
 * Dialog zum Persistieren einer Finding-Ausnahme (z. B. „akzeptiert bis
 * Audit v2026.Q3"). Schreibt in `security_finding_exceptions` (admin-only RLS).
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  upsertFindingException,
  deleteFindingException,
  type ExceptionStatus,
  type ExceptionPriority,
  type FindingException,
} from "@/lib/admin/security/findingExceptionsApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scannerName: string;
  internalId: string;
  findingId?: string;
  priority?: ExceptionPriority;
  existing?: FindingException | null;
  onSaved: () => void;
}

export function FindingExceptionDialog({
  open,
  onOpenChange,
  scannerName,
  internalId,
  findingId,
  priority,
  existing,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ExceptionStatus>(existing?.status ?? "accepted");
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [audit, setAudit] = useState(existing?.accepted_until_audit ?? "");
  const [date, setDate] = useState(existing?.accepted_until_date ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus(existing?.status ?? "accepted");
      setReason(existing?.reason ?? "");
      setAudit(existing?.accepted_until_audit ?? "");
      setDate(existing?.accepted_until_date ?? "");
    }
  }, [open, existing]);

  async function handleSave() {
    if (!reason.trim()) {
      toast({ title: "Begründung erforderlich", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await upsertFindingException({
        scanner_name: scannerName,
        internal_id: internalId,
        finding_id: findingId ?? null,
        priority: priority ?? null,
        status,
        reason: reason.trim(),
        accepted_until_audit: audit.trim() || null,
        accepted_until_date: date || null,
      });
      toast({ title: "Ausnahme gespeichert" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Speichern fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setBusy(true);
    try {
      await deleteFindingException(scannerName, internalId);
      toast({ title: "Ausnahme entfernt" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Finding-Ausnahme {existing ? "bearbeiten" : "anlegen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 p-2 text-xs font-mono">
            {scannerName} · {internalId}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ExceptionStatus)}>
              <SelectTrigger id="ex-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="accepted">accepted — bewusst akzeptiert</SelectItem>
                <SelectItem value="mitigated">mitigated — durch Maßnahme abgesichert</SelectItem>
                <SelectItem value="deferred">deferred — bis später verschoben</SelectItem>
                <SelectItem value="wontfix">wontfix — nicht beheben</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-reason">Begründung*</Label>
            <Textarea
              id="ex-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z. B. service_role-only Grant, kein anon/authenticated Zugriff."
              className="min-h-20 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-audit">Bis Audit-Version</Label>
              <Input
                id="ex-audit"
                value={audit}
                onChange={(e) => setAudit(e.target.value)}
                placeholder="v2026.Q3"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-date">Bis Datum</Label>
              <Input
                id="ex-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          {existing ? (
            <Button variant="ghost" onClick={handleDelete} disabled={busy}>
              Entfernen
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {existing ? "Aktualisieren" : "Speichern"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
