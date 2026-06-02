import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrgAuditEvents } from "@/hooks/useOrgConsole";
import {
  ScrollText,
  Search,
  UserCog,
  Mail,
  KeyRound,
  Building2,
  ShieldAlert,
  CircleDot,
  ChevronDown,
} from "lucide-react";

// Human-readable mapping for known event types.
const EVENT_META: Record<string, { label: string; icon: any; tone: string }> = {
  org_member_role_changed:    { label: "Rolle geändert",         icon: UserCog,     tone: "bg-status-info-bg-subtle text-status-info" },
  org_member_removed:         { label: "Mitarbeiter entfernt",   icon: UserCog,     tone: "bg-status-danger-bg-subtle text-status-danger" },
  org_member_added:           { label: "Mitarbeiter hinzugefügt",icon: UserCog,     tone: "bg-status-success-bg-subtle text-status-success" },
  org_invite_created:         { label: "Einladung erstellt",     icon: Mail,        tone: "bg-status-info-bg-subtle text-status-info" },
  org_invite_revoked:         { label: "Einladung zurückgezogen",icon: Mail,        tone: "bg-surface-2 text-text-tertiary" },
  org_invite_accepted:        { label: "Einladung angenommen",   icon: Mail,        tone: "bg-status-success-bg-subtle text-status-success" },
  org_license_seat_assigned:  { label: "Sitz vergeben",          icon: KeyRound,    tone: "bg-status-info-bg-subtle text-status-info" },
  org_license_seat_released:  { label: "Sitz freigegeben",       icon: KeyRound,    tone: "bg-surface-2 text-text-secondary" },
  org_license_purchased:      { label: "Lizenz gekauft",         icon: KeyRound,    tone: "bg-status-success-bg-subtle text-status-success" },
  org_settings_updated:       { label: "Einstellungen geändert", icon: Building2,   tone: "bg-status-info-bg-subtle text-status-info" },
};

function humanize(eventType: string) {
  return EVENT_META[eventType] ?? {
    label: eventType.replace(/_/g, " "),
    icon: CircleDot,
    tone: "bg-surface-2 text-text-secondary",
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  if (d < 14) return `vor ${d} Tg`;
  return new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

type AuditEvent = {
  id?: string;
  org_id?: string;
  actor_user_id?: string | null;
  event_type?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

const PAGE_SIZE = 25;

export default function OrgActivityPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: events, isLoading, isError, refetch } = useOrgAuditEvents(orgId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState(searchParams.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<string>(searchParams.get("type") ?? "all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<number>(() => {
    const n = parseInt(searchParams.get("limit") ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : PAGE_SIZE;
  });

  // Sync state to URL (one direction; user-controlled).
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (typeFilter && typeFilter !== "all") next.set("type", typeFilter);
    else next.delete("type");
    if (filter) next.set("q", filter);
    else next.delete("q");
    if (visibleCount !== PAGE_SIZE) next.set("limit", String(visibleCount));
    else next.delete("limit");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, filter, visibleCount]);

  const list = (events ?? []) as AuditEvent[];

  const types = useMemo(() => {
    const s = new Set<string>();
    list.forEach((e) => e.event_type && s.add(e.event_type));
    return Array.from(s).sort();
  }, [list]);

  const filtered = useMemo(() => {
    return list.filter((e) => {
      if (typeFilter !== "all" && e.event_type !== typeFilter) return false;
      if (!filter) return true;
      const f = filter.toLowerCase();
      return (
        (e.event_type ?? "").toLowerCase().includes(f) ||
        (e.description ?? "").toLowerCase().includes(f) ||
        (e.entity_type ?? "").toLowerCase().includes(f)
      );
    });
  }, [list, filter, typeFilter]);

  const visible = filtered.slice(0, visibleCount);
  const remaining = Math.max(0, filtered.length - visible.length);


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Aktivität</h1>
        <p className="text-sm text-text-secondary mt-1">
          Nachvollziehbare Historie aller Änderungen in deiner Organisation.
        </p>
      </div>

      {/* Filterleiste — only when we actually have data */}
      {!isLoading && list.length > 0 && (
        <Card className="p-4 shadow-elev-1 border-border">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Ereignis, Beschreibung oder Entität suchen…"
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setVisibleCount(PAGE_SIZE); }}>
              <SelectTrigger className="w-56" data-testid="activity-type-filter">
                <SelectValue placeholder="Ereignistyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Ereignisse</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-sm text-text-tertiary ml-auto tabular-nums">
              {filtered.length} / {list.length}
            </span>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-8 text-center border-status-danger/40 shadow-elev-1">
          <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-status-danger" />
          <p className="text-sm text-text-secondary mb-3">
            Aktivität konnte nicht geladen werden.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Erneut versuchen
          </Button>
        </Card>
      ) : list.length === 0 ? (
        <Card className="p-12 text-center border-border shadow-elev-1" data-testid="activity-empty-state">
          <ScrollText className="h-10 w-10 mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">Noch keine Aktivität.</p>
          <p className="text-xs text-text-tertiary mt-1.5 max-w-sm mx-auto">
            Sobald jemand Rollen ändert, Einladungen verschickt oder Sitze vergibt,
            erscheinen die Ereignisse hier.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center border-border shadow-elev-1" data-testid="activity-no-results">
          <Search className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
          <p className="text-sm text-text-secondary">Keine Treffer für diesen Filter.</p>
        </Card>
      ) : (
        <>
          <Card className="shadow-elev-1 border-border divide-y divide-border overflow-hidden" data-testid="activity-event-list">
            {visible.map((e, i) => {
              const key = e.id ?? String(i);
              const meta = humanize(e.event_type ?? "");
              const Icon = meta.icon;
              const created = e.created_at ?? new Date().toISOString();
              const hasMetadata =
                e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata).length > 0;
              const open = !!expanded[key];
              return (
                <div key={key} className="p-4 hover:bg-surface-1/50 transition-colors" data-testid="activity-event-row">
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${meta.tone}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-text-primary">
                          {meta.label}
                        </span>
                        {e.entity_type && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            {e.entity_type}
                          </Badge>
                        )}
                      </div>
                      {e.description && (
                        <div className="text-xs text-text-secondary mt-0.5 break-words">
                          {e.description}
                        </div>
                      )}
                      {hasMetadata && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className="text-[11px] text-text-tertiary hover:text-text-secondary mt-1.5 inline-flex items-center gap-1 transition-colors"
                        >
                          <ChevronDown
                            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                          Details {open ? "ausblenden" : "anzeigen"}
                        </button>
                      )}
                      {open && hasMetadata && (
                        <pre className="text-[11px] text-text-tertiary mt-2 max-w-full overflow-x-auto bg-surface-1 border border-border p-2 rounded">
                          {JSON.stringify(e.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                    <span
                      className="text-xs text-text-tertiary tabular-nums shrink-0"
                      title={fmt(created)}
                    >
                      {relativeTime(created)}
                    </span>
                  </div>
                </div>
              );
            })}
          </Card>
          {remaining > 0 && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                data-testid="activity-load-more"
              >
                Mehr laden ({remaining} weitere)
              </Button>
            </div>
          )}
        </>
      )}

    </div>
  );
}
