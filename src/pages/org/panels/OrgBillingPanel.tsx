import { useEffect, useMemo, useState } from "react";
import { getOrgBillingContext, setOrgInvoiceCoding } from "@/lib/orgApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, FileText, Receipt } from "lucide-react";

function fmtEur(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);
}

interface Props {
  organizationId: string;
  entities: any[];
  myRole: string;
}

export default function OrgBillingPanel({ organizationId, entities, myRole }: Props) {
  const [page, setPage] = useState(1);
  const [entityId, setEntityId] = useState("ALL");
  const [invoiceStatus, setInvoiceStatus] = useState("ALL");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Coding dialog
  const [codingOpen, setCodingOpen] = useState(false);
  const [codingInvoice, setCodingInvoice] = useState<any>(null);
  const [coding, setCoding] = useState({ cost_center: "", cost_object: "", gl_account: "", project_code: "", internal_ref: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const entityOptions = useMemo(() => [{ id: "ALL", display_name: "Alle Einheiten" }, ...(entities ?? [])], [entities]);
  const canBilling = ["OWNER", "BILLING"].includes(myRole ?? "");

  async function load() {
    setLoading(true);
    try {
      const res = await getOrgBillingContext({
        organization_id: organizationId,
        page,
        page_size: 20,
        entity_id: entityId !== "ALL" ? entityId : undefined,
        invoice_status: invoiceStatus !== "ALL" ? invoiceStatus : undefined,
      });
      setData(res);
    } catch (e) {
      console.error("Billing load failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [organizationId, page, entityId, invoiceStatus]);

  function openCoding(inv: any) {
    setCodingInvoice(inv);
    setCoding({ cost_center: "", cost_object: "", gl_account: "", project_code: "", internal_ref: "", notes: "" });
    setCodingOpen(true);
  }

  async function saveCoding() {
    if (!codingInvoice) return;
    setSaving(true);
    try {
      await setOrgInvoiceCoding({
        organization_id: organizationId,
        invoice_id: codingInvoice.id,
        entity_id: entityId !== "ALL" ? entityId : null,
        cost_center: coding.cost_center || null,
        cost_object: coding.cost_object || null,
        gl_account: coding.gl_account || null,
        project_code: coding.project_code || null,
        internal_ref: coding.internal_ref || null,
        notes: coding.notes || null,
      });
      setCodingOpen(false);
    } catch (e) {
      console.error("Coding save failed", e);
    } finally {
      setSaving(false);
    }
  }

  const invoices = data?.invoices ?? [];
  const billingAccounts = data?.billing_accounts ?? [];
  const paging = data?.paging ?? {};

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "PAID": return "bg-success-bg-subtle text-success border-0";
      case "OVERDUE": return "bg-danger-bg-subtle text-danger border-0";
      case "SENT": return "bg-info-bg-subtle text-info border-0";
      case "DRAFT": return "bg-surface-sunken text-text-secondary border border-border-subtle";
      default: return "";
    }
  };

  return (
    <div data-density="comfortable" className="space-y-5">
      {/* Filters */}
      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 font-display text-text-primary">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-petrol-50 dark:bg-petrol-900/30">
              <Receipt className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            Rechnungen & Billing
          </CardTitle>
          <CardDescription className="text-text-secondary tabular-nums">
            {billingAccounts.length} Billing-Account(s) · Seite {page}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Einheit</label>
              <Select value={entityId} onValueChange={(v) => { setEntityId(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {entityOptions.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Status</label>
              <Select value={invoiceStatus} onValueChange={(v) => { setInvoiceStatus(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Alle</SelectItem>
                  <SelectItem value="DRAFT">Entwurf</SelectItem>
                  <SelectItem value="SENT">Versendet</SelectItem>
                  <SelectItem value="PAID">Bezahlt</SelectItem>
                  <SelectItem value="OVERDUE">Überfällig</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card variant="raised">
        <CardContent className="pt-5">
          {invoices.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
                <FileText className="h-5 w-5 text-text-tertiary" />
              </div>
              <p className="text-sm text-text-secondary">Keine Rechnungen gefunden.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle">
                  <TableHead className="text-text-tertiary font-medium">Nr.</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Datum</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Status</TableHead>
                  <TableHead className="text-text-tertiary font-medium text-right">Betrag</TableHead>
                  {canBilling && <TableHead className="text-text-tertiary font-medium text-right">Kontierung</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv: any) => (
                  <TableRow key={inv.id} className="border-border-subtle hover:bg-surface-hover/50 transition-colors">
                    <TableCell className="font-mono text-xs text-text-secondary">{inv.invoice_number ?? inv.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm text-text-secondary tabular-nums">{inv.issue_date ?? "–"}</TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(inv.status)}>
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-display font-semibold text-text-primary tabular-nums">{fmtEur(inv.total_gross_cents ?? 0)}</TableCell>
                    {canBilling && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openCoding(inv)} className="text-petrol-600 dark:text-mint-400 hover:bg-petrol-50 dark:hover:bg-petrol-900/30">
                          Kontierung
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Paging */}
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-text-tertiary tabular-nums">Seite {page}</span>
            <Button variant="outline" size="sm" disabled={(paging.returned ?? 0) < 20} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Coding Dialog */}
      <Dialog open={codingOpen} onOpenChange={setCodingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontierung – {codingInvoice?.invoice_number ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Kostenstelle</label>
              <Input value={coding.cost_center} onChange={(e) => setCoding(c => ({ ...c, cost_center: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kostenobjekt</label>
              <Input value={coding.cost_object} onChange={(e) => setCoding(c => ({ ...c, cost_object: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">GL-Konto</label>
              <Input value={coding.gl_account} onChange={(e) => setCoding(c => ({ ...c, gl_account: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Projektcode</label>
              <Input value={coding.project_code} onChange={(e) => setCoding(c => ({ ...c, project_code: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Interne Referenz</label>
              <Input value={coding.internal_ref} onChange={(e) => setCoding(c => ({ ...c, internal_ref: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notizen</label>
              <Textarea value={coding.notes} onChange={(e) => setCoding(c => ({ ...c, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodingOpen(false)}>Abbrechen</Button>
            <Button onClick={saveCoding} disabled={saving}>{saving ? "Speichern…" : "Speichern"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
