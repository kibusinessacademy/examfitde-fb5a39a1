import { useEffect, useMemo, useState } from "react";
import { getOrgKpis } from "@/lib/orgApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

function fmtEur(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  organizationId: string;
  entities: any[];
  privacyAccess: any;
  myRole: string;
}

export default function OrgKpiPanel({ organizationId, entities }: Props) {
  const [mode, setMode] = useState<"fiscal_year" | "calendar_year" | "range">("fiscal_year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(todayISO());
  const [scope, setScope] = useState<"ANONYMIZED" | "PSEUDONYMIZED" | "IDENTIFIED">("ANONYMIZED");
  const [entityId, setEntityId] = useState("ALL");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const entityOptions = useMemo(
    () => [{ id: "ALL", display_name: "Alle Einheiten" }, ...(entities ?? [])],
    [entities]
  );

  async function load() {
    setLoading(true);
    try {
      const res = await getOrgKpis({
        organization_id: organizationId,
        mode,
        year: mode === "calendar_year" ? year : undefined,
        start_date: mode === "range" ? startDate : undefined,
        end_date: mode === "range" ? endDate : undefined,
        scope,
        entity_id: entityId !== "ALL" ? entityId : undefined,
      });
      setData(res);
    } catch (e) {
      console.error("KPI load failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [organizationId, mode, year, startDate, endDate, scope, entityId]);

  const effectiveScope = data?.privacy?.effective_scope ?? scope;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">KPI-Auswertung</CardTitle>
          <CardDescription>
            Aggregierte Kennzahlen. IDENTIFIED wird ohne Admin-Freigabe automatisch downgraded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Zeitraum</label>
              <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fiscal_year">Geschäftsjahr</SelectItem>
                  <SelectItem value="calendar_year">Kalenderjahr</SelectItem>
                  <SelectItem value="range">Benutzerdefiniert</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "calendar_year" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Jahr</label>
                <Input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value || "0", 10))} />
              </div>
            )}

            {mode === "range" && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Start</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Ende</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Einheit</label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {entityOptions.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Scope</label>
              <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANONYMIZED">Anonymisiert</SelectItem>
                  <SelectItem value="PSEUDONYMIZED">Pseudonymisiert</SelectItem>
                  <SelectItem value="IDENTIFIED">Identifizierend</SelectItem>
                </SelectContent>
              </Select>
              {effectiveScope !== scope && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  Effektiv: {effectiveScope}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-3">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Aktualisieren
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Seats & Lizenzen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Expiring (30d)</span>
              <span className="font-semibold">{data?.seats?.expiring_within_30_days ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Expired</span>
              <span className="font-semibold">{data?.seats?.expired ?? 0}</span>
            </div>
            {data?.seats?.counts && Object.entries(data.seats.counts).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span>
                <span className="font-semibold">{String(v)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Umsatz (Orders)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Anzahl</span>
              <span className="font-semibold">{data?.billing?.orders_count ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Summe</span>
              <span className="font-semibold">{fmtEur(data?.billing?.orders_gross_cents ?? 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rechnungen & Zahlungen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Invoices</span>
              <span className="font-semibold">{data?.billing?.invoices_count ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Offen</span>
              <span className="font-semibold">{data?.billing?.invoices_open_count ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Bezahlt</span>
              <span className="font-semibold">{fmtEur(data?.billing?.payments_paid_cents ?? 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {data?.period && (
        <p className="text-xs text-muted-foreground">
          Zeitraum: {data.period.start_date} bis {data.period.end_date_exclusive} (exklusiv)
        </p>
      )}
    </div>
  );
}
