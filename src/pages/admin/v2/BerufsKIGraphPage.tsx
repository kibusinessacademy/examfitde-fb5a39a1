import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  fetchGraphSummary, listGraphNodes, createGraphNode, createGraphEdge,
  deleteGraphEdge, fetchNeighborhood,
  NODE_TYPES, EDGE_TYPES,
  type GraphNode, type GraphEdge, type GraphEdgeType, type GraphNodeType,
} from "@/lib/berufs-ki/graph";

export default function BerufsKIGraphPage() {
  const { toast } = useToast();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchGraphSummary>> | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [filterType, setFilterType] = useState<GraphNodeType | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hood, setHood] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(false);

  // create node form
  const [newType, setNewType] = useState<GraphNodeType>("competency");
  const [newTitle, setNewTitle] = useState("");

  // create edge form
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeType, setEdgeType] = useState<GraphEdgeType>("related_to");

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, n] = await Promise.all([
        fetchGraphSummary(),
        listGraphNodes({ node_type: filterType === "all" ? undefined : filterType, q: search || undefined }),
      ]);
      setSummary(s);
      setNodes(n);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filterType]);

  const onSelect = async (n: GraphNode) => {
    setSelected(n);
    try {
      const r = await fetchNeighborhood(n.id, 2);
      setHood(r);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onCreateNode = async () => {
    if (!newTitle.trim()) return;
    try {
      await createGraphNode({ node_type: newType, title: newTitle.trim() });
      setNewTitle("");
      await refresh();
      toast({ title: "Knoten angelegt" });
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onCreateEdge = async () => {
    if (!edgeFrom || !edgeTo) return;
    try {
      await createGraphEdge({ from_node_id: edgeFrom, to_node_id: edgeTo, edge_type: edgeType });
      toast({ title: "Kante angelegt" });
      if (selected) await onSelect(selected);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onDeleteEdge = async (id: string) => {
    try {
      await deleteGraphEdge(id);
      if (selected) await onSelect(selected);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const filtered = useMemo(
    () => nodes.filter((n) => !search || n.title.toLowerCase().includes(search.toLowerCase())),
    [nodes, search],
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Berufs-KI Knowledge Graph</h1>
        <p className="text-muted-foreground">Phase 5F · Knoten, Kanten, Nachbarschaft</p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-5">
        {summary && (
          <>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Knoten</div><div className="text-2xl font-semibold">{summary.totals.total_nodes}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Kanten</div><div className="text-2xl font-semibold">{summary.totals.total_edges}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Knoten-Typen</div><div className="text-2xl font-semibold">{summary.totals.distinct_node_types}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Kanten-Typen</div><div className="text-2xl font-semibold">{summary.totals.distinct_edge_types}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Evolution offen</div><div className="text-2xl font-semibold">{summary.totals.pending_evolution_candidates}</div></Card>
          </>
        )}
      </div>

      {summary && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Top-Hubs (Degree)</div>
          <div className="flex flex-wrap gap-2">
            {summary.top_hubs.map((h) => (
              <Badge key={h.id} variant="secondary">{h.title} · {h.node_type} · {h.degree}</Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Create */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Neuer Knoten</div>
          <Select value={newType} onValueChange={(v) => setNewType(v as GraphNodeType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{NODE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Titel" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Button onClick={onCreateNode} disabled={!newTitle.trim()}>Anlegen</Button>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Neue Kante</div>
          <Input placeholder="from_node_id (UUID)" value={edgeFrom} onChange={(e) => setEdgeFrom(e.target.value)} />
          <Input placeholder="to_node_id (UUID)" value={edgeTo} onChange={(e) => setEdgeTo(e.target.value)} />
          <Select value={edgeType} onValueChange={(v) => setEdgeType(v as GraphEdgeType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{EDGE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={onCreateEdge} disabled={!edgeFrom || !edgeTo}>Verbinden</Button>
        </Card>
      </div>

      {/* Browser */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="max-w-xs" placeholder="Suche…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filterType} onValueChange={(v) => setFilterType(v as GraphNodeType | "all")}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Typen</SelectItem>
              {NODE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={refresh} disabled={loading}>Aktualisieren</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 max-h-[500px] overflow-auto">
            {filtered.map((n) => (
              <button
                key={n.id}
                onClick={() => onSelect(n)}
                className={`w-full text-left rounded border p-3 hover:bg-muted ${selected?.id === n.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{n.node_type}</Badge>
                  <span className="font-medium">{n.title}</span>
                </div>
                {n.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.description}</div>}
                <div className="text-[10px] text-muted-foreground font-mono mt-1">{n.id}</div>
              </button>
            ))}
            {filtered.length === 0 && <div className="text-sm text-muted-foreground">Keine Knoten.</div>}
          </div>

          <div>
            {selected && hood ? (
              <Card className="p-4 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Ausgewählt</div>
                  <div className="font-semibold">{selected.title}</div>
                  <div className="text-xs">{selected.node_type}</div>
                </div>
                <div className="text-sm font-medium">Kanten ({hood.edges.length})</div>
                <div className="space-y-1 max-h-[400px] overflow-auto">
                  {hood.edges.map((e) => {
                    const other = hood.nodes.find((x) => x.id === (e.from_node_id === selected.id ? e.to_node_id : e.from_node_id));
                    const dir = e.from_node_id === selected.id ? "→" : "←";
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                        <Badge variant="outline">{e.edge_type}</Badge>
                        <span>{dir} {other?.title ?? "?"}</span>
                        <span className="text-muted-foreground">conf {e.confidence_score}</span>
                        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2" onClick={() => onDeleteEdge(e.id)}>×</Button>
                      </div>
                    );
                  })}
                  {hood.edges.length === 0 && <div className="text-xs text-muted-foreground">Keine Kanten.</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEdgeFrom(selected.id)}>
                  Als „from" für neue Kante setzen
                </Button>
              </Card>
            ) : (
              <div className="text-sm text-muted-foreground">Knoten links auswählen, um die Nachbarschaft zu sehen.</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
