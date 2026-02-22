import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, CreditCard, BarChart3, Building2, Shield } from "lucide-react";

type OrgSummary = { id: string; name: string; org_type: string; my_role: string };
type Entity = { id: string; entity_code: string; display_name: string; legal_name: string; is_default: boolean };
type Learner = { id: string; learner_user_id: string; entity_id: string | null; joined_at: string };
type Seat = { id: string; learner_user_id: string; entity_id: string | null; seat_status: string; product_id: string | null; certification_id: string | null; start_at: string | null; end_at: string | null };
type PrivacyAccess = { status: string; scope: string; approved_until?: string | null };

interface OrgContext {
  orgs: OrgSummary[];
  selected: {
    org: { id: string; name: string; org_type: string; fiscal_year_start_month: number; default_report_scope: string } | null;
    my_role: string | null;
    entities: Entity[];
    members: any[];
    learners: Learner[];
    seats: Seat[];
    seat_summary: Record<string, number>;
    privacy_access: PrivacyAccess;
  } | null;
}

const SEAT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  INVITED: "bg-blue-100 text-blue-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  EXPIRED: "bg-gray-100 text-gray-600",
  REVOKED: "bg-red-100 text-red-800",
};

export function OrgConsole() {
  const [context, setContext] = useState<OrgContext | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const loadContext = useCallback(async (orgId?: string) => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) return;

      const params = new URLSearchParams();
      if (orgId) params.set("organization_id", orgId);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-org-console-context?${params}`,
        { headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const data = await res.json();
      setContext(data);
      if (data.selected?.org?.id) setSelectedOrgId(data.selected.org.id);
    } catch (e) {
      console.error("OrgConsole load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContext(); }, [loadContext]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!context?.selected) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Keine Organisation zugewiesen.</p>
        </CardContent>
      </Card>
    );
  }

  const { selected, orgs } = context;
  const { org, my_role, entities, learners, seats, seat_summary, privacy_access } = selected;

  const filteredLearners = entityFilter === "all"
    ? learners
    : learners.filter(l => l.entity_id === entityFilter);

  const filteredSeats = entityFilter === "all"
    ? seats
    : seats.filter(s => s.entity_id === entityFilter);

  const entityMap = Object.fromEntries(entities.map(e => [e.id, e]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{org?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {org?.org_type} · Rolle: <Badge variant="outline">{my_role}</Badge>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Org Switcher */}
          {orgs.length > 1 && (
            <Select value={selectedOrgId ?? ""} onValueChange={(v) => loadContext(v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Organisation wählen" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Entity Filter */}
          {entities.length > 1 && (
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Alle Einheiten" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Einheiten</SelectItem>
                {entities.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Seats</CardDescription>
            <CardTitle className="text-3xl">{seat_summary.ACTIVE ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Eingeladen</CardDescription>
            <CardTitle className="text-3xl">{seat_summary.INVITED ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gesamt Seats</CardDescription>
            <CardTitle className="text-3xl">{seats.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Learner</CardDescription>
            <CardTitle className="text-3xl">{learners.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Privacy Badge */}
      <div className="flex items-center gap-2 text-sm">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Datenzugriff:</span>
        <Badge variant={privacy_access.status === "APPROVED" ? "default" : "secondary"}>
          {privacy_access.scope} · {privacy_access.status}
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="learners">
        <TabsList>
          <TabsTrigger value="learners" className="gap-1.5">
            <Users className="h-4 w-4" /> Learner & Seats
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5">
            <CreditCard className="h-4 w-4" /> Billing
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <BarChart3 className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        {/* Learner & Seats Tab */}
        <TabsContent value="learners">
          <Card>
            <CardHeader>
              <CardTitle>Seats & Lizenzen</CardTitle>
              <CardDescription>{filteredSeats.length} Seats{entityFilter !== "all" ? ` (${entityMap[entityFilter]?.display_name})` : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredSeats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Keine Seats vorhanden.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Learner</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Laufzeit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSeats.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.learner_user_id.slice(0, 8)}…</TableCell>
                        <TableCell>{s.entity_id ? (entityMap[s.entity_id]?.display_name ?? "–") : "–"}</TableCell>
                        <TableCell>
                          <Badge className={SEAT_STATUS_COLORS[s.seat_status] ?? ""}>{s.seat_status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.start_at ?? "–"} → {s.end_at ?? "∞"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle>Entities & Kontierung</CardTitle>
              <CardDescription>Tochtergesellschaften / Kostenstellen</CardDescription>
            </CardHeader>
            <CardContent>
              {entities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Keine Entities konfiguriert.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Legal Name</TableHead>
                      <TableHead>Default</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-sm">{e.entity_code}</TableCell>
                        <TableCell>{e.display_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.legal_name}</TableCell>
                        <TableCell>{e.is_default && <Badge variant="outline">Default</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>Reports & KPIs</CardTitle>
              <CardDescription>Aggregierte Auswertungen (Datenschutz: {privacy_access.scope})</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Auslastung</div>
                  <div className="text-2xl font-bold mt-1">
                    {seats.length > 0
                      ? Math.round(((seat_summary.ACTIVE ?? 0) / seats.length) * 100)
                      : 0}%
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Ablaufende Seats (30d)</div>
                  <div className="text-2xl font-bold mt-1">
                    {seats.filter(s => {
                      if (!s.end_at) return false;
                      const diff = new Date(s.end_at).getTime() - Date.now();
                      return diff > 0 && diff < 30 * 86400000;
                    }).length}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Entities</div>
                  <div className="text-2xl font-bold mt-1">{entities.length}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Weitere Auswertungen (Prüfungsreife-Index, Frühwarn-Score) erfordern den freigeschalteten Datenzugriff.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
