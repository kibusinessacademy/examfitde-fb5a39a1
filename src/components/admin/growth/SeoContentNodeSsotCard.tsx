import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Network, ExternalLink } from "lucide-react";

/**
 * SEO Knowledge OS — Cut A: Content-Node-SSOT Card.
 * Read-only view onto v_seo_content_node_ssot via admin RPC.
 * Detail: mem://strategie/seo-knowledge-os-audit-v1
 */

type NodeRow = {
  node_id: string;
  node_type: string;
  source_table: string;
  source_id: string;
  canonical_slug: string | null;
  title: string | null;
  persona: string | null;
  product_id: string | null;
  package_id: string | null;
  beruf_id: string | null;
  curriculum_id: string | null;
  status: string | null;
  is_indexable: boolean;
  canonical_url: string | null;
  updated_at: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

type SummaryRow = {
  node_type: string;
  total: number;
  indexable: number;
  with_slug: number;
  last_updated: string | null;
};

const NODE_TYPES = [
  "seo_document",
  "blog_article",
  "certification_page",
  "seo_content_page",
  "glossary_page",
  "persona_overlay",
  "course_package",
] as const;

export default function SeoContentNodeSsotCard() {
  const [nodeType, setNodeType] = useState<string>("__all__");
  const [search, setSearch] = useState("");

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["seo-content-node-ssot-summary"],
    queryFn: async (): Promise<SummaryRow[]> => {
      const { data, error } = await supabase.rpc("admin_get_seo_content_node_ssot_summary" as never);
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    staleTime: 60_000,
  });

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["seo-content-node-ssot-list", nodeType, search],
    queryFn: async (): Promise<NodeRow[]> => {
      const { data, error } = await supabase.rpc("admin_get_seo_content_node_ssot" as never, {
        p_limit: 200,
        p_node_type: nodeType === "__all__" ? null : nodeType,
        p_search: search.trim() || null,
      } as never);
      if (error) throw error;
      return (data ?? []) as NodeRow[];
    },
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    const rows = summary ?? [];
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + Number(r.total ?? 0),
        indexable: acc.indexable + Number(r.indexable ?? 0),
        with_slug: acc.with_slug + Number(r.with_slug ?? 0),
      }),
      { total: 0, indexable: 0, with_slug: 0 },
    );
  }, [summary]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              SEO Content Nodes (SSOT)
            </CardTitle>
            <CardDescription>
              Read-only Bridge-View über 7 Content-Quellen. Cut A des Knowledge-OS.
            </CardDescription>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Total: <span className="font-medium text-foreground">{totals.total}</span></div>
            <div>Indexable: <span className="font-medium text-foreground">{totals.indexable}</span></div>
            <div>With slug: <span className="font-medium text-foreground">{totals.with_slug}</span></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Counts per node_type */}
        <div className="flex flex-wrap gap-2">
          {summaryLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            NODE_TYPES.map((nt) => {
              const row = summary?.find((s) => s.node_type === nt);
              const total = Number(row?.total ?? 0);
              const idx = Number(row?.indexable ?? 0);
              return (
                <Badge
                  key={nt}
                  variant={nodeType === nt ? "default" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => setNodeType(nodeType === nt ? "__all__" : nt)}
                >
                  {nt}: {total}
                  {idx > 0 && <span className="ml-1 opacity-70">· {idx} idx</span>}
                </Badge>
              );
            })
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={nodeType} onValueChange={setNodeType}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Alle Typen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Alle Typen</SelectItem>
              {NODE_TYPES.map((nt) => (
                <SelectItem key={nt} value={nt}>{nt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Suche in title / canonical_slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {/* List */}
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div className="col-span-3">Title</div>
            <div className="col-span-3">Canonical Slug</div>
            <div className="col-span-2">Source</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Indexable</div>
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
            {nodesLoading ? (
              <div className="flex items-center justify-center p-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : !nodes || nodes.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Keine Nodes gefunden.</div>
            ) : (
              nodes.map((n) => (
                <div key={n.node_id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs hover:bg-muted/30">
                  <div className="col-span-3 truncate" title={n.title ?? ""}>
                    {n.title ?? <span className="text-muted-foreground italic">—</span>}
                  </div>
                  <div className="col-span-3 truncate font-mono text-muted-foreground" title={n.canonical_slug ?? ""}>
                    {n.canonical_slug ?? "—"}
                  </div>
                  <div className="col-span-2 truncate text-muted-foreground">{n.source_table}</div>
                  <div className="col-span-2">
                    <Badge variant="outline" className="text-[10px]">{n.status ?? "—"}</Badge>
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    {n.is_indexable ? (
                      <Badge className="text-[10px]">indexable</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {n.canonical_url && (
                      <a
                        href={n.canonical_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Open canonical URL"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Bridge-View <code>v_seo_content_node_ssot</code> · service_role only · Zugriff via <code>admin_get_seo_content_node_ssot</code>.
        </p>
      </CardContent>
    </Card>
  );
}
