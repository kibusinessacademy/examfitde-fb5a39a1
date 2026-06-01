import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, KeyRound, Send, TrendingUp, ArrowRight } from "lucide-react";
import { useOrgDashboardOverview, useOrgLicenseList, useOrgSeatMembers } from "@/hooks/useOrgDashboard";
import { useOrgInvites } from "@/hooks/useOrgConsoleData";

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: any;
  loading?: boolean;
}) {
  return (
    <Card className="p-5 shadow-elev-1 hover:shadow-elev-2 transition-shadow border-border">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-text-tertiary" />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16 mb-2" />
      ) : (
        <div className="text-3xl font-semibold text-text-primary mb-1">{value}</div>
      )}
      {hint && <div className="text-xs text-text-secondary">{hint}</div>}
    </Card>
  );
}

export default function OrgDashboardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: overview, isLoading: lOverview } = useOrgDashboardOverview(orgId);
  const { data: licenses } = useOrgLicenseList(orgId);
  const { data: seats } = useOrgSeatMembers(orgId);
  const { data: invites } = useOrgInvites(orgId);

  const pendingInvites = (invites ?? []).filter((i) => i.status === "pending").length;
  const activeLicenses = (licenses ?? []).filter((l) => l.status === "active").length;
  const expiringSoon = (licenses ?? []).filter((l) => {
    if (!l.valid_until) return false;
    const days = (new Date(l.valid_until).getTime() - Date.now()) / 86_400_000;
    return days > 0 && days <= 30;
  }).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Übersicht</h1>
        <p className="text-sm text-text-secondary mt-1">
          Zentrale Steuerung deiner Unternehmens-Lernlizenzen.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Aktive Lernende"
          value={overview?.active_learners ?? 0}
          hint={`von ${overview?.total_seats ?? 0} Sitzen`}
          icon={Users}
          loading={lOverview}
        />
        <Kpi
          label="Verfügbare Sitze"
          value={overview?.available_seats ?? 0}
          hint={`belegt: ${overview?.used_seats ?? 0}`}
          icon={KeyRound}
          loading={lOverview}
        />
        <Kpi
          label="Aktive Lizenzen"
          value={activeLicenses}
          hint={expiringSoon > 0 ? `${expiringSoon} laufen in 30 Tagen aus` : "Alle gültig"}
          icon={TrendingUp}
          loading={lOverview}
        />
        <Kpi
          label="Offene Einladungen"
          value={pendingInvites}
          hint={pendingInvites > 0 ? "Warten auf Annahme" : "Keine offenen"}
          icon={Send}
          loading={lOverview}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6 shadow-elev-1 border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Schnellaktionen</h2>
          </div>
          <div className="space-y-2">
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to={`/app/org/${orgId}/team`}>
                <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Mitarbeiter verwalten</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to={`/app/org/${orgId}/lizenzen`}>
                <span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Sitze zuweisen</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to={`/app/org/${orgId}/einladungen`}>
                <span className="flex items-center gap-2"><Send className="h-4 w-4" /> Einladungen versenden</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Card>

        <Card className="p-6 shadow-elev-1 border-border">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Lizenz-Auslastung</h2>
          {!licenses || licenses.length === 0 ? (
            <div className="text-sm text-text-tertiary py-8 text-center">
              Noch keine aktiven Lizenzen.
              <div className="mt-3">
                <Button asChild size="sm">
                  <a href="/berufski/corporate">Lizenz erwerben</a>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {licenses.slice(0, 5).map((lic) => {
                const pct = lic.seats_total > 0 ? Math.round((lic.seats_used / lic.seats_total) * 100) : 0;
                return (
                  <li key={lic.license_id}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium text-text-primary truncate">
                        {lic.product_title ?? "Lizenz"}
                      </span>
                      <span className="text-text-tertiary tabular-nums">
                        {lic.seats_used}/{lic.seats_total}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
