import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buildFilteredZip,
  buildTree,
  emitExportFilteredAudit,
  fetchExportManifest,
  humanBytes,
  type ManifestFile,
  type TreeNode,
} from "@/lib/factory/exportManifest";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Download, FolderClosed, FolderOpen, FileText, FileWarning, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function FileIcon({ file }: { file: ManifestFile }) {
  if (file.kind === "blocked") return <FileWarning className="h-3.5 w-3.5 text-destructive" />;
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
}

function TreeRow({
  node,
  depth,
  selected,
  toggle,
  onPick,
  pickedPath,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<string>;
  toggle: (paths: string[], next: boolean) => void;
  onPick: (file: ManifestFile) => void;
  pickedPath: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.isFile && node.file) {
    const f = node.file;
    const isSel = selected.has(f.path);
    const isBlocked = f.kind === "blocked";
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-muted/50 ${
          pickedPath === f.path ? "bg-muted" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onPick(f)}
      >
        <Checkbox
          checked={isSel}
          disabled={isBlocked}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => toggle([f.path], v === true)}
        />
        <FileIcon file={f} />
        <span className={`truncate flex-1 ${isBlocked ? "text-destructive line-through" : ""}`}>
          {node.name}
        </span>
        <span className="text-[10px] text-muted-foreground">{humanBytes(f.size)}</span>
      </div>
    );
  }
  // directory
  const allLeafPaths = useMemo(() => collectFilePaths(node), [node]);
  const allSelected = allLeafPaths.length > 0 && allLeafPaths.every((p) => selected.has(p));
  const someSelected = allLeafPaths.some((p) => selected.has(p));
  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-muted/50"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(v) => toggle(allLeafPaths, v === true)}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 flex-1 text-left"
        >
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 text-primary" />
          ) : (
            <FolderClosed className="h-3.5 w-3.5 text-primary" />
          )}
          <span className="truncate font-medium">{node.name || "/"}</span>
          <span className="text-[10px] text-muted-foreground">({allLeafPaths.length})</span>
        </button>
      </div>
      {open &&
        node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            selected={selected}
            toggle={toggle}
            onPick={onPick}
            pickedPath={pickedPath}
          />
        ))}
    </div>
  );
}

function collectFilePaths(node: TreeNode): string[] {
  if (node.isFile && node.file && node.file.kind !== "blocked") return [node.file.path];
  return node.children.flatMap(collectFilePaths);
}

function FilePreview({ file }: { file: ManifestFile | null }) {
  if (!file) {
    return (
      <div className="text-sm text-muted-foreground p-6 text-center">
        Datei in der Liste auswählen, um Vorschau zu sehen.
      </div>
    );
  }
  if (file.kind === "blocked") {
    return (
      <div className="p-4 text-sm">
        <Badge variant="destructive">blockiert</Badge>{" "}
        <span className="text-muted-foreground">Grund: {file.blocked_reason ?? "—"}</span>
      </div>
    );
  }
  if (file.kind === "binary") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Binärdatei ({humanBytes(file.size)}, {file.mime}). Keine Inline-Vorschau.
      </div>
    );
  }
  const text = file.text ?? "";
  const isJson = file.mime === "application/json";
  let pretty = text;
  if (isJson) {
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return (
    <ScrollArea className="h-full">
      <pre className="text-xs p-4 whitespace-pre-wrap break-all font-mono">{pretty}</pre>
    </ScrollArea>
  );
}

export default function ExportPreviewPage() {
  const { packageId } = useParams<{ packageId: string }>();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["export-manifest", packageId],
    queryFn: () => fetchExportManifest(packageId!),
    enabled: !!packageId,
    staleTime: 60_000,
  });

  const tree = useMemo(() => (data ? buildTree(data.files) : null), [data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<ManifestFile | null>(null);
  const [exporting, setExporting] = useState(false);

  // initialize selection: all non-blocked
  useMemo(() => {
    if (data) {
      const next = new Set<string>();
      for (const f of data.files) if (f.kind !== "blocked") next.add(f.path);
      setSelected(next);
    }
  }, [data]);

  const toggle = (paths: string[], next: boolean) => {
    setSelected((prev) => {
      const s = new Set(prev);
      for (const p of paths) {
        if (next) s.add(p);
        else s.delete(p);
      }
      return s;
    });
  };

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const accepted = Array.from(selected);
      const rejected = data.file_count - accepted.length;
      const blob = await buildFilteredZip(data, selected);
      // download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${data.package_id}-filtered.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await emitExportFilteredAudit(data.package_id, accepted, rejected);
      toast.success(`ZIP exportiert: ${accepted.length} Dateien`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Export fehlgeschlagen: ${msg}`);
    } finally {
      setExporting(false);
    }
  };

  if (!packageId) return <div className="p-6">packageId fehlt.</div>;

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Export-Preview</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{packageId}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Manifest neu laden
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={!data || exporting || selected.size === 0}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              ZIP exportieren ({selected.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Erzeuge Export-Manifest …
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Fehler beim Laden des Manifests"}
            </div>
          )}
          {data && (
            <div className="text-xs text-muted-foreground flex gap-4">
              <span>Dateien: <strong>{data.file_count}</strong></span>
              <span>Größe: <strong>{humanBytes(data.total_bytes)}</strong></span>
              <span>Quelle: <span className="font-mono">{data.export_path}</span></span>
            </div>
          )}
        </CardContent>
      </Card>

      {tree && data && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1fr)_2fr] gap-4">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-sm">Dateien</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[70vh]">
                <div className="py-2">
                  {tree.children.map((n) => (
                    <TreeRow
                      key={n.path}
                      node={n}
                      depth={0}
                      selected={selected}
                      toggle={toggle}
                      onPick={setPicked}
                      pickedPath={picked?.path ?? null}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                Vorschau
                {picked && (
                  <span className="font-mono text-xs text-muted-foreground">{picked.path}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[70vh]">
              <FilePreview file={picked} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
