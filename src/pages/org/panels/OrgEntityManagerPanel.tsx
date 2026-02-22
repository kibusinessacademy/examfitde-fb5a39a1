import { useEffect, useState } from "react";
import { getOrgEntities, upsertOrgEntity, upsertOrgEntityDefaults } from "@/lib/orgApi";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus, Pencil } from "lucide-react";

type Entity = {
  id: string;
  entity_code: string;
  legal_name: string;
  display_name: string;
  vat_id: string | null;
  billing_email: string | null;
  is_default: boolean;
  accounting_defaults?: {
    default_cost_center?: string | null;
    default_cost_object?: string | null;
    default_gl_account?: string | null;
    default_project_code?: string | null;
  } | null;
};

const emptyEntity = {
  entity_code: "",
  legal_name: "",
  display_name: "",
  vat_id: "",
  billing_email: "",
  is_default: false,
};

const emptyDefaults = {
  default_cost_center: "",
  default_cost_object: "",
  default_gl_account: "",
  default_project_code: "",
};

export default function OrgEntityManagerPanel(props: { organizationId: string; myRole: string }) {
  const { organizationId, myRole } = props;
  const canManage = ["OWNER", "MANAGER"].includes(myRole ?? "");
  const canBilling = ["OWNER", "BILLING"].includes(myRole ?? "");

  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<Entity[]>([]);

  const [entityOpen, setEntityOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [form, setForm] = useState(emptyEntity);
  const [saving, setSaving] = useState(false);

  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [defaultsEntityId, setDefaultsEntityId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState(emptyDefaults);
  const [savingDefaults, setSavingDefaults] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getOrgEntities({ organization_id: organizationId });
      setEntities(res?.entities ?? []);
    } catch (e) {
      console.error("getOrgEntities failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [organizationId]);

  function openNew() {
    setEditingEntity(null);
    setForm(emptyEntity);
    setEntityOpen(true);
  }

  function openEdit(e: Entity) {
    setEditingEntity(e);
    setForm({
      entity_code: e.entity_code,
      legal_name: e.legal_name,
      display_name: e.display_name,
      vat_id: e.vat_id ?? "",
      billing_email: e.billing_email ?? "",
      is_default: e.is_default,
    });
    setEntityOpen(true);
  }

  async function saveEntity() {
    setSaving(true);
    try {
      await upsertOrgEntity({
        organization_id: organizationId,
        id: editingEntity?.id,
        entity_code: form.entity_code,
        legal_name: form.legal_name,
        display_name: form.display_name,
        vat_id: form.vat_id || null,
        billing_email: form.billing_email || null,
        is_default: form.is_default,
      });
      setEntityOpen(false);
      await load();
    } catch (e) {
      console.error("upsertOrgEntity failed", e);
    } finally {
      setSaving(false);
    }
  }

  function openDefaults(e: Entity) {
    setDefaultsEntityId(e.id);
    setDefaults({
      default_cost_center: e.accounting_defaults?.default_cost_center ?? "",
      default_cost_object: e.accounting_defaults?.default_cost_object ?? "",
      default_gl_account: e.accounting_defaults?.default_gl_account ?? "",
      default_project_code: e.accounting_defaults?.default_project_code ?? "",
    });
    setDefaultsOpen(true);
  }

  async function saveDefaults() {
    if (!defaultsEntityId) return;
    setSavingDefaults(true);
    try {
      await upsertOrgEntityDefaults({
        entity_id: defaultsEntityId,
        default_cost_center: defaults.default_cost_center || null,
        default_cost_object: defaults.default_cost_object || null,
        default_gl_account: defaults.default_gl_account || null,
        default_project_code: defaults.default_project_code || null,
      });
      setDefaultsOpen(false);
      await load();
    } catch (e) {
      console.error("upsertOrgEntityDefaults failed", e);
    } finally {
      setSavingDefaults(false);
    }
  }

  function exportCsv() {
    const rows = entities.map((e) => ({
      entity_code: e.entity_code,
      legal_name: e.legal_name,
      display_name: e.display_name,
      vat_id: e.vat_id ?? "",
      billing_email: e.billing_email ?? "",
      is_default: e.is_default ? "Ja" : "Nein",
      cost_center: e.accounting_defaults?.default_cost_center ?? "",
      cost_object: e.accounting_defaults?.default_cost_object ?? "",
      gl_account: e.accounting_defaults?.default_gl_account ?? "",
      project_code: e.accounting_defaults?.default_project_code ?? "",
    }));
    downloadCsv(`entities_${organizationId.slice(0, 8)}.csv`, toCsv(rows));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Einheiten / Tochtergesellschaften</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              {canManage && (
                <Button size="sm" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-1" /> Neue Einheit
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Einheiten vorhanden.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>USt-ID</TableHead>
                  <TableHead>Standard</TableHead>
                  <TableHead>Kontierung</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entities.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.entity_code}</TableCell>
                    <TableCell>{e.display_name}</TableCell>
                    <TableCell className="text-xs">{e.vat_id ?? "–"}</TableCell>
                    <TableCell>{e.is_default ? "✓" : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.accounting_defaults?.default_cost_center ?? "–"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canManage && (
                          <Button variant="ghost" size="icon" onClick={() => openEdit(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canBilling && (
                          <Button variant="ghost" size="sm" onClick={() => openDefaults(e)}>
                            Kontierung
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Entity Dialog */}
      <Dialog open={entityOpen} onOpenChange={setEntityOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEntity ? "Einheit bearbeiten" : "Neue Einheit"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Code</Label>
              <Input value={form.entity_code} onChange={(e) => setForm({ ...form, entity_code: e.target.value })} placeholder="z.B. DE-01" />
            </div>
            <div>
              <Label>Rechtsname</Label>
              <Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
            </div>
            <div>
              <Label>Anzeigename</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div>
              <Label>USt-ID</Label>
              <Input value={form.vat_id} onChange={(e) => setForm({ ...form, vat_id: e.target.value })} />
            </div>
            <div>
              <Label>Billing E-Mail</Label>
              <Input value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
              <Label>Standard-Einheit</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntityOpen(false)}>Abbrechen</Button>
            <Button onClick={saveEntity} disabled={saving}>{saving ? "Speichern…" : "Speichern"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Defaults Dialog */}
      <Dialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontierungs-Standards</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Kostenstelle</Label>
              <Input value={defaults.default_cost_center} onChange={(e) => setDefaults({ ...defaults, default_cost_center: e.target.value })} />
            </div>
            <div>
              <Label>Kostenobjekt</Label>
              <Input value={defaults.default_cost_object} onChange={(e) => setDefaults({ ...defaults, default_cost_object: e.target.value })} />
            </div>
            <div>
              <Label>GL-Konto</Label>
              <Input value={defaults.default_gl_account} onChange={(e) => setDefaults({ ...defaults, default_gl_account: e.target.value })} />
            </div>
            <div>
              <Label>Projektcode</Label>
              <Input value={defaults.default_project_code} onChange={(e) => setDefaults({ ...defaults, default_project_code: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefaultsOpen(false)}>Abbrechen</Button>
            <Button onClick={saveDefaults} disabled={savingDefaults}>{savingDefaults ? "Speichern…" : "Speichern"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
