// FördermittelOS Cut 7 — Sales Inbox (list)
// Admin-gated via useAuth.isAdmin. Read via admin_foerdermittel_leads_list RPC.
// All routes under /foerdermittel/* (admin-routing-enforcement bans /admin/foerdermittel/*).
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowLeft, Filter, Inbox, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  LEAD_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  PRIORITY_LABEL,
  computePriority,
  classifyFollowup,
  normalizeFilters,
  sortByPriorityThenScore,
  type LeadStatus,
  type SalesLeadFilters,
  type SalesLeadListItem,
} from "@/lib/foerdermittel/salesInbox";

const SOURCES = [
  "hub", "cluster_state", "cluster_topic", "cluster_industry",
  "cluster_combination", "cluster_current", "checklist", "program_detail", "report_share",
];

const STATUS_TONE_CLS: Record<string, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning-border bg-warning-bg-subtle text-warning",
  success: "border-success-border bg-success-bg-subtle text-success",
  destructive: "border-destructive-border bg-destructive-bg-subtle text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

const PRIORITY_CLS: Record<string, string> = {
  p0: "border-destructive-border bg-destructive-bg-subtle text-destructive",
  p1: "border-warning-border bg-warning-bg-subtle text-warning",
  p2: "border-primary/30 bg-primary/10 text-primary",
  p3: "border-border bg-muted text-muted-foreground",
};

const FOLLOWUP_CLS: Record<string, string> = {
  overdue: "text-destructive",
  today: "text-warning",
  soon: "text-foreground",
  scheduled: "text-muted-foreground",
  none: "text-muted-foreground/60",
};

export default function FoerdermittelInboxPage() {
  const { isAdmin, loading } = useAuth();
  const [items, setItems] = useState<SalesLeadListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SalesLeadFilters>({});
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    setLoadingList(true);
    setError(null);
    const clean = normalizeFilters(filters);
    (supabase.rpc as any)("admin_foerdermittel_leads_list", {
      p_status: clean.status ?? null,
      p_source: clean.source ?? null,
      p_region: clean.region ?? null,
      p_industry: clean.industry ?? null,
      p_search: clean.search ?? null,
      p_limit: 200,
      p_offset: 0,
    })
      .then(({ data, error }: any) => {
        if (error) { setError(error.message); setLoadingList(false); return; }
        const payload = (data ?? {}) as { items?: SalesLeadListItem[]; total?: number; counts_by_status?: Record<string, number> };
        setItems(sortByPriorityThenScore(payload.items ?? []));
        setTotal(payload.total ?? 0);
        setCounts(payload.counts_by_status ?? {});
        setLoadingList(false);
      });
  }, [isAdmin, filters]);

  const onSearch = () => setFilters((f) => ({ ...f, search: searchInput }));
  const toggleStatus = (s: LeadStatus) => {
    setFilters((f) => {
      const cur = new Set(f.status ?? []);
      if (cur.has(s)) cur.delete(s); else cur.add(s);
      return { ...f, status: cur.size > 0 ? [...cur] : undefined };
    });
  };
  const clearFilters = () => { setFilters({}); setSearchInput(""); };

  const now = useMemo(() => new Date(), [items]);

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Laden …</main>;
  }
  if (!isAdmin) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center space-y-2">
            <div className="font-semibold">Zugriff beschränkt</div>
            <p className="text-sm text-muted-foreground">Sales Inbox ist nur für Admin- und Sales-Rollen freigegeben.</p>
            <Link to="/foerdermittel" className="text-sm text-primary hover:underline">Zurück zum Hub</Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>FördermittelOS · Sales Inbox · intern</title>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel/reporting" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Reporting
        </Link>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-2 pb-6">
        <Badge variant="outline" className="mb-2">intern · admin</Badge>
        <h1 className="text-3xl font-semibold tracking-tight inline-flex items-center gap-2">
          <Inbox className="h-7 w-7 text-primary" /> FördermittelOS Sales Inbox
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
          Alle Fördermittel-Leads — priorisiert nach Tier, Score und Wiedervorlage. Status forward-only,
          Aktivitäten ohne PII im Audit.
        </p>
      </section>

      {/* Counts row */}
      <section className="mx-auto max-w-7xl px-6 pb-4 grid gap-2 grid-cols-2 sm:grid-cols-5">
        {LEAD_STATUSES.map((s) => (
          <Card key={s}>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{STATUS_LABEL[s]}</div>
              <div className="text-xl font-semibold tabular-nums">{counts[s] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Filters */}
      <section className="mx-auto max-w-7xl px-6 pb-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Filter className="h-3.5 w-3.5" /> Status
              </span>
              {LEAD_STATUSES.map((s) => {
                const active = (filters.status ?? []).includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleStatus(s)}
                    className={`text-xs h-7 px-2 rounded-md border transition ${
                      active ? STATUS_TONE_CLS[STATUS_TONE[s]] : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >{STATUS_LABEL[s]}</button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Quelle</span>
              <select
                value={filters.source ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value || undefined }))}
                className="h-8 text-xs rounded-md border border-input bg-background px-2"
              >
                <option value="">alle</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-xs text-muted-foreground ml-2">Bundesland</span>
              <Input
                value={filters.region ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value || undefined }))}
                placeholder="z.B. BY"
                className="h-8 w-24 text-xs"
              />
              <span className="text-xs text-muted-foreground ml-2">Branche</span>
              <Input
                value={filters.industry ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value || undefined }))}
                placeholder="z.B. it"
                className="h-8 w-32 text-xs"
              />
              <div className="flex-1" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                placeholder="Firma / E-Mail (≥2)"
                className="h-8 w-56 text-xs"
              />
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onSearch}>
                <Search className="h-3.5 w-3.5" /> Suchen
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={clearFilters}>Reset</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* List */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <Card>
          <CardContent className="p-0">
            {loadingList ? (
              <div className="p-6 text-sm text-muted-foreground">Lade Leads …</div>
            ) : error ? (
              <div className="p-6 text-sm text-destructive">Fehler: {error}</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Keine Leads mit aktuellen Filtern.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 px-3">Priorität</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Firma · E-Mail</th>
                      <th className="py-2 px-3">Quelle</th>
                      <th className="py-2 px-3">Region</th>
                      <th className="py-2 px-3">Branche</th>
                      <th className="py-2 px-3">Score</th>
                      <th className="py-2 px-3">Wiedervorlage</th>
                      <th className="py-2 px-3">Erstellt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const p = computePriority({
                        status: it.status, tier: it.tier, score: it.score,
                        nextActionAt: it.next_action_at, createdAt: it.created_at, now,
                      });
                      const fu = classifyFollowup(it.next_action_at, now);
                      return (
                        <tr key={it.id} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${PRIORITY_CLS[p]}`}>
                              {PRIORITY_LABEL[p]}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STATUS_TONE_CLS[STATUS_TONE[it.status]]}`}>
                              {STATUS_LABEL[it.status]}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">
                            <Link to={`/foerdermittel/inbox/${it.id}`} className="font-medium text-foreground hover:underline">
                              {it.company_name}
                            </Link>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[260px]">{it.contact_email}</div>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{it.source_page ?? "—"}</td>
                          <td className="py-2 px-3">{it.region ?? "—"}</td>
                          <td className="py-2 px-3">{it.industry ?? "—"}</td>
                          <td className="py-2 px-3 tabular-nums">{it.score}</td>
                          <td className={`py-2 px-3 tabular-nums ${FOLLOWUP_CLS[fu]}`}>
                            {it.next_action_at ? new Date(it.next_action_at).toLocaleDateString("de-DE") : "—"}
                            <span className="ml-1 text-[10px] uppercase tracking-wider opacity-70">{fu}</span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground tabular-nums">
                            {new Date(it.created_at).toLocaleDateString("de-DE")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="p-3 text-[11px] text-muted-foreground border-t">
              {items.length} von {total} Leads · sortiert nach Priorität & Score
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
