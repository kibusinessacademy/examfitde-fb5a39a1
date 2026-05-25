import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Lock, Unlock, ShieldAlert, Crown, Plus } from "lucide-react";
import {
  adminListOrgsWithLicenses, adminListProfessionContexts,
  adminListProfessionGuardEvents, adminSwitchPrimaryProfession,
  adminGrantProfessionLicense, getOrgProfessionAccess,
  adminSetAgentAccess, GUARD_REASON_LABEL,
  type OrgLicenseRow, type ProfessionContextRow, type GuardEventRow,
  type OrgProfessionAccess, type LicenseTier,
} from "@/lib/profession-license/api";

const TIERS: LicenseTier[] = ["standard", "pro", "enterprise"];

export default function ProfessionLicensesPage() {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<OrgLicenseRow[]>([]);
  const [contexts, setContexts] = useState<ProfessionContextRow[]>([]);
  const [events, setEvents] = useState<GuardEventRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [access, setAccess] = useState<OrgProfessionAccess | null>(null);
  const [busy, setBusy] = useState(false);

  const [newProfession, setNewProfession] = useState<string>("");
  const [newTier, setNewTier] = useState<LicenseTier>("standard");
  const [primaryTarget, setPrimaryTarget] = useState<string>("");

  const loadBase = async () => {
    try {
      const [o, c] = await Promise.all([
        adminListOrgsWithLicenses(200),
        adminListProfessionContexts(),
      ]);
      setOrgs(o);
      setContexts(c);
    } catch (e: unknown) {
      toast({ title: "Fehler beim Laden", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const loadOrg = async (orgId: string) => {
    try {
      const [a, ev] = await Promise.all([
        getOrgProfessionAccess(orgId),
        adminListProfessionGuardEvents({ organization_id: orgId, only_denied: false, limit: 100 }),
      ]);
      setAccess(a);
      setEvents(ev);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { if (selectedOrgId) loadOrg(selectedOrgId); }, [selectedOrgId]);

  const filteredOrgs = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return orgs;
    return orgs.filter(o =>
      o.organization_name.toLowerCase().includes(s) ||
      (o.primary_profession_id ?? "").toLowerCase().includes(s) ||
      (o.primary_profession_name ?? "").toLowerCase().includes(s)
    );
  }, [orgs, search]);

  const onGrant = async () => {
    if (!selectedOrgId || !newProfession) return;
    setBusy(true);
    try {
      await adminGrantProfessionLicense({
        organization_id: selectedOrgId,
        profession_id: newProfession,
        tier: newTier,
        is_primary: !access?.licenses.some(l => l.is_primary && l.status === "active"),
      });
      toast({ title: "Lizenz vergeben" });
      await Promise.all([loadBase(), loadOrg(selectedOrgId)]);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const onSwitchPrimary = async (force: boolean) => {
    if (!selectedOrgId || !primaryTarget) return;
    setBusy(true);
    try {
      const res = await adminSwitchPrimaryProfession({
        organization_id: selectedOrgId,
        new_profession_id: primaryTarget,
        force,
        cooldown_days: 30,
      });
      if (!res.ok) {
        toast({
          title: "Wechsel abgelehnt",
          description: res.reason === "cooldown_active"
            ? `Cooldown bis ${new Date(res.cooldown_until!).toLocaleString()}`
            : res.reason,
          variant: "destructive",
        });
      } else {
        toast({ title: "Haupt-Berufsfeld gewechselt", description: `${res.from ?? "—"} → ${res.to}` });
        await Promise.all([loadBase(), loadOrg(selectedOrgId)]);
      }
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const onToggleAgent = async (slug: string, enabled: boolean, tier: LicenseTier) => {
    if (!selectedOrgId) return;
    setBusy(true);
    try {
      await adminSetAgentAccess({
        organization_id: selectedOrgId,
        agent_slug: slug,
        enabled,
        tier_required: tier,
      });
      toast({ title: enabled ? "Agent freigeschaltet" : "Agent deaktiviert" });
      await loadOrg(selectedOrgId);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const selectedOrg = orgs.find(o => o.organization_id === selectedOrgId) ?? null;
  const primaryLicense = access?.licenses.find(l => l.is_primary && l.status === "active") ?? null;
  const addons = access?.licenses.filter(l => !l.is_primary) ?? [];
  const primaryContext = contexts.find(c => c.profession_id === primaryLicense?.profession_id) ?? null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Profession License Governance</h1>
        <p className="text-muted-foreground">Phase 7b · Berufsfeld-Lizenzen, Agenten-Zugriffe, Deny-Audit</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Organisationen</div>
          <div className="text-2xl font-semibold">{orgs.length}</div>
          <div className="text-xs text-muted-foreground">
            mit Haupt-Lizenz: {orgs.filter(o => o.primary_profession_id).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Berufsfeld-Kontexte</div>
          <div className="text-2xl font-semibold">{contexts.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Aktive Cooldowns</div>
          <div className="text-2xl font-semibold">
            {orgs.filter(o => o.cooldown_until && new Date(o.cooldown_until) > new Date()).length}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ── Org-Liste ── */}
        <Card className="p-3 space-y-3 h-fit">
          <Input placeholder="Organisation suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="space-y-1 max-h-[600px] overflow-auto">
            {filteredOrgs.map((o) => {
              const isSelected = o.organization_id === selectedOrgId;
              const cooldownActive = o.cooldown_until && new Date(o.cooldown_until) > new Date();
              return (
                <button
                  key={o.organization_id}
                  onClick={() => setSelectedOrgId(o.organization_id)}
                  className={`w-full text-left p-2 rounded text-sm transition-colors ${isSelected ? "bg-muted" : "hover:bg-muted/50"}`}
                >
                  <div className="font-medium truncate">{o.organization_name}</div>
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    {o.primary_profession_id ? (
                      <>
                        <Badge variant="default" className="gap-1 text-xs">
                          <Crown className="h-3 w-3" /> {o.primary_profession_name ?? o.primary_profession_id}
                        </Badge>
                        {o.primary_tier && <Badge variant="outline" className="text-xs">{o.primary_tier}</Badge>}
                      </>
                    ) : (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Lock className="h-3 w-3" /> Keine Primary
                      </Badge>
                    )}
                    {o.addon_count > 0 && <Badge variant="outline" className="text-xs">+{o.addon_count} Addon</Badge>}
                    {cooldownActive && <Badge variant="destructive" className="text-xs">cooldown</Badge>}
                  </div>
                </button>
              );
            })}
            {filteredOrgs.length === 0 && (
              <div className="text-xs text-muted-foreground text-center p-4">Keine Treffer.</div>
            )}
          </div>
        </Card>

        {/* ── Detail ── */}
        <div className="space-y-4">
          {!selectedOrg && (
            <Card className="p-6 text-sm text-muted-foreground text-center">
              Organisation links auswählen.
            </Card>
          )}

          {selectedOrg && (
            <>
              {/* Primary */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-semibold">Haupt-Berufsfeld</h2>
                </div>
                {primaryLicense ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="default">{primaryContext?.profession_name ?? primaryLicense.profession_id}</Badge>
                      <Badge variant="outline">{primaryLicense.tier}</Badge>
                      <Badge variant="secondary">{primaryLicense.source}</Badge>
                      {selectedOrg.cooldown_until && new Date(selectedOrg.cooldown_until) > new Date() && (
                        <Badge variant="destructive">
                          Cooldown bis {new Date(selectedOrg.cooldown_until).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    {primaryContext && (
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>Erlaubte Agenten-Kategorien: {primaryContext.allowed_agent_categories.join(", ") || "—"}</div>
                        <div>Workflow-Kategorien: {primaryContext.allowed_workflow_categories.join(", ") || "—"}</div>
                        <div>Risk: {(primaryContext.governance_profile?.risk_profile as string) ?? "—"} · HITL: {String(primaryContext.governance_profile?.hitl_required ?? false)}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Keine aktive Haupt-Lizenz.</div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <Select value={primaryTarget} onValueChange={setPrimaryTarget}>
                    <SelectTrigger className="w-[260px]"><SelectValue placeholder="Berufsfeld für Wechsel…" /></SelectTrigger>
                    <SelectContent>
                      {access?.licenses.map(l => (
                        <SelectItem key={l.profession_id} value={l.profession_id}>
                          {contexts.find(c => c.profession_id === l.profession_id)?.profession_name ?? l.profession_id}
                          {l.is_primary ? " (aktuell primary)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={busy || !primaryTarget} onClick={() => onSwitchPrimary(false)}>Wechseln (Cooldown 30d)</Button>
                  <Button size="sm" variant="outline" disabled={busy || !primaryTarget} onClick={() => onSwitchPrimary(true)}>
                    Force-Switch (Admin-Override)
                  </Button>
                </div>
              </Card>

              {/* Add-ons */}
              <Card className="p-4 space-y-3">
                <h2 className="text-lg font-semibold">Add-on-Berufsfelder</h2>
                {addons.length === 0 && <div className="text-sm text-muted-foreground">Keine Add-ons.</div>}
                <div className="space-y-2">
                  {addons.map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary">{contexts.find(c => c.profession_id === a.profession_id)?.profession_name ?? a.profession_id}</Badge>
                      <Badge variant="outline">{a.tier}</Badge>
                      <Badge variant="outline">{a.status}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {a.expires_at ? `bis ${new Date(a.expires_at).toLocaleDateString()}` : "unbefristet"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <Select value={newProfession} onValueChange={setNewProfession}>
                    <SelectTrigger className="w-[260px]"><SelectValue placeholder="Berufsfeld hinzufügen…" /></SelectTrigger>
                    <SelectContent>
                      {contexts.map(c => (
                        <SelectItem key={c.profession_id} value={c.profession_id}>{c.profession_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={newTier} onValueChange={(v) => setNewTier(v as LicenseTier)}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={busy || !newProfession} onClick={onGrant}>
                    <Plus className="h-3 w-3 mr-1" /> Lizenz vergeben
                  </Button>
                </div>
              </Card>

              {/* Agenten */}
              <Card className="p-4 space-y-3">
                <h2 className="text-lg font-semibold">Agenten-Zugriffe</h2>
                {(access?.agents ?? []).length === 0 && (
                  <div className="text-sm text-muted-foreground">Noch keine Org-Overrides — Defaults aus Berufsfeld-Kontext.</div>
                )}
                <div className="space-y-2">
                  {(access?.agents ?? []).map(ag => (
                    <div key={ag.agent_id} className="flex items-center gap-2 text-sm">
                      {ag.enabled ? <Unlock className="h-3 w-3 text-primary" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
                      <span className="font-medium">{ag.name}</span>
                      <Badge variant="outline" className="text-xs">{ag.category}</Badge>
                      <Badge variant="outline" className="text-xs">{ag.tier_required}</Badge>
                      <div className="ml-auto flex gap-1">
                        <Select value={ag.tier_required} onValueChange={(v) => onToggleAgent(ag.slug, ag.enabled, v as LicenseTier)}>
                          <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button size="sm" variant={ag.enabled ? "outline" : "default"}
                          onClick={() => onToggleAgent(ag.slug, !ag.enabled, ag.tier_required)} disabled={busy}>
                          {ag.enabled ? "Deaktivieren" : "Freischalten"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Guard-Events */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                  <h2 className="text-lg font-semibold">Guard-Events</h2>
                  <span className="text-xs text-muted-foreground ml-auto">{events.length} Events</span>
                </div>
                <div className="space-y-1 max-h-[400px] overflow-auto">
                  {events.map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-xs py-1 border-b border-border last:border-0">
                      <Badge variant={e.allowed ? "outline" : "destructive"} className="text-[10px]">
                        {e.allowed ? "allow" : "deny"}
                      </Badge>
                      <span className="font-mono">{e.reason ? (GUARD_REASON_LABEL[e.reason as keyof typeof GUARD_REASON_LABEL] ?? e.reason) : "—"}</span>
                      {e.workflow_slug && <Badge variant="outline" className="text-[10px]">{e.workflow_slug}</Badge>}
                      <span className="text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                  {events.length === 0 && <div className="text-xs text-muted-foreground text-center p-4">Keine Events.</div>}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Profession Contexts SSOT */}
      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Berufsfeld-Kontexte (SSOT)</h2>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {contexts.map(c => (
            <div key={c.profession_id} className="p-3 border border-border rounded space-y-1">
              <div className="font-medium text-sm">{c.profession_name}</div>
              <div className="text-xs text-muted-foreground font-mono">{c.profession_id}</div>
              <div className="text-xs">Agents: {c.allowed_agent_categories.join(", ") || "—"}</div>
              <div className="text-xs">Workflows: {c.allowed_workflow_categories.join(", ") || "—"}</div>
              <div className="text-xs text-muted-foreground">
                Risk: {(c.governance_profile?.risk_profile as string) ?? "—"} · HITL: {String(c.governance_profile?.hitl_required ?? false)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
