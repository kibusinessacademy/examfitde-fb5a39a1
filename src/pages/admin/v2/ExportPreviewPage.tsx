import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  buildTree,
  downloadFilteredZip,
  fetchExportManifest,
  humanBytes,
  type ManifestFile,
  type TreeNode,
} from "@/lib/factory/exportManifest";
import {
  autoIncludeCategoryPaths,
  autoIncludeCriticalPaths,
  toCopyableSummary,
  validateExportCompleteness,
  type ExportCategory,
  type ExportValidationReport,
} from "@/lib/factory/exportValidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Download, FolderClosed, FolderOpen, FileText, FileWarning, RefreshCw, Info, ChevronRight, ChevronDown, ShieldAlert, ShieldCheck, Wand2, Copy, ChevronsUpDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

const ROW_HEIGHT = 28;

function FileIcon({ file }: { file: ManifestFile }) {
  if (file.kind === "blocked") return <FileWarning className="h-3.5 w-3.5 text-destructive" />;
  if (file.kind === "oversized") return <FileWarning className="h-3.5 w-3.5 text-amber-500" />;
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
}

type FlatRow =
  | { kind: "dir"; node: TreeNode; depth: number; leafPaths: string[] }
  | { kind: "file"; file: ManifestFile; name: string; depth: number };

function collectFilePaths(node: TreeNode): string[] {
  if (node.isFile && node.file && node.file.kind !== "blocked") return [node.file.path];
  return node.children.flatMap(collectFilePaths);
}

/** Flatten the visible tree honoring `openDirs`. Memoize on caller. */
function flattenTree(root: TreeNode, openDirs: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.isFile && n.file) {
        out.push({ kind: "file", file: n.file, name: n.name, depth });
      } else {
        out.push({ kind: "dir", node: n, depth, leafPaths: collectFilePaths(n) });
        if (openDirs.has(n.path)) walk(n.children, depth + 1);
      }
    }
  };
  walk(root.children, 0);
  return out;
}

const DirRow = ({
  row,
  isOpen,
  onToggleOpen,
  selected,
  toggle,
}: {
  row: Extract<FlatRow, { kind: "dir" }>;
  isOpen: boolean;
  onToggleOpen: (path: string) => void;
  selected: Set<string>;
  toggle: (paths: string[], next: boolean) => void;
}) => {
  const { node, depth, leafPaths } = row;
  const allSelected = leafPaths.length > 0 && leafPaths.every((p) => selected.has(p));
  const someSelected = !allSelected && leafPaths.some((p) => selected.has(p));
  return (
    <div
      className="flex items-center gap-2 px-2 rounded text-xs hover:bg-muted/50"
      style={{ paddingLeft: depth * 12 + 8, height: ROW_HEIGHT }}
    >
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={(v) => toggle(leafPaths, v === true)}
      />
      <button
        type="button"
        onClick={() => onToggleOpen(node.path)}
        className="flex items-center gap-1.5 flex-1 text-left min-w-0"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {isOpen ? (
          <FolderOpen className="h-3.5 w-3.5 text-primary" />
        ) : (
          <FolderClosed className="h-3.5 w-3.5 text-primary" />
        )}
        <span className="truncate font-medium">{node.name || "/"}</span>
        <span className="text-[10px] text-muted-foreground">({leafPaths.length})</span>
      </button>
    </div>
  );
};

const FileRow = ({
  row,
  picked,
  onPick,
  selected,
  toggle,
}: {
  row: Extract<FlatRow, { kind: "file" }>;
  picked: boolean;
  onPick: (f: ManifestFile) => void;
  selected: Set<string>;
  toggle: (paths: string[], next: boolean) => void;
}) => {
  const { file, name, depth } = row;
  const isSel = selected.has(file.path);
  const isBlocked = file.kind === "blocked";
  return (
    <div
      className={`flex items-center gap-2 px-2 rounded text-xs cursor-pointer hover:bg-muted/50 ${
        picked ? "bg-muted" : ""
      }`}
      style={{ paddingLeft: depth * 12 + 8, height: ROW_HEIGHT }}
      onClick={() => onPick(file)}
    >
      <Checkbox
        checked={isSel}
        disabled={isBlocked}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={(v) => toggle([file.path], v === true)}
      />
      <FileIcon file={file} />
      <span className={`truncate flex-1 ${isBlocked ? "text-destructive line-through" : ""}`}>
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground">{humanBytes(file.size)}</span>
    </div>
  );
};

export function VirtualTree({
  tree,
  selected,
  toggle,
  onPick,
  pickedPath,
}: {
  tree: TreeNode;
  selected: Set<string>;
  toggle: (paths: string[], next: boolean) => void;
  onPick: (f: ManifestFile) => void;
  pickedPath: string | null;
}) {
  // Initial open: top two depths.
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const seed = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        if (!n.isFile && depth < 2) {
          s.add(n.path);
          seed(n.children, depth + 1);
        }
      }
    };
    seed(tree.children, 0);
    return s;
  });

  const onToggleOpen = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => flattenTree(tree, openDirs), [tree, openDirs]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const [activeIndex, setActiveIndex] = useState(0);

  // Preserve scroll position when filters/sort/tree mutate: reset only when
  // the row identity actually changes (not on every render).
  const rowSig = useMemo(
    () => `${rows.length}:${rows.slice(0, 6).map((r) => (r.kind === "dir" ? `d:${r.node.path}` : `f:${r.file.path}`)).join("|")}`,
    [rows],
  );
  const prevSigRef = useRef<string>(rowSig);
  useEffect(() => {
    if (prevSigRef.current !== rowSig) {
      prevSigRef.current = rowSig;
      setActiveIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
    }
  }, [rowSig, rows.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    let next = activeIndex;
    if (e.key === "ArrowDown") next = Math.min(rows.length - 1, activeIndex + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, activeIndex - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else if (e.key === "PageDown") next = Math.min(rows.length - 1, activeIndex + 12);
    else if (e.key === "PageUp") next = Math.max(0, activeIndex - 12);
    else if (e.key === " " || e.key === "Enter") {
      const r = rows[activeIndex];
      if (r?.kind === "dir") {
        e.preventDefault();
        onToggleOpen(r.node.path);
      } else if (r?.kind === "file") {
        e.preventDefault();
        onPick(r.file);
      }
      return;
    } else {
      return;
    }
    e.preventDefault();
    setActiveIndex(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  }, [activeIndex, rows, onPick, onToggleOpen, virtualizer]);

  return (
    <div
      ref={parentRef}
      className="h-[70vh] overflow-auto py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      role="tree"
      aria-label="Export-Dateibaum"
      aria-activedescendant={rows.length ? `export-row-${activeIndex}` : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          const isActive = vi.index === activeIndex;
          return (
            <div
              key={vi.key}
              id={`export-row-${vi.index}`}
              role="treeitem"
              aria-selected={row.kind === "file" ? pickedPath === row.file.path : undefined}
              aria-expanded={row.kind === "dir" ? openDirs.has(row.node.path) : undefined}
              aria-level={(row.depth ?? 0) + 1}
              className={isActive ? "ring-1 ring-primary/40 rounded" : undefined}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.kind === "dir" ? (
                <DirRow
                  row={row}
                  isOpen={openDirs.has(row.node.path)}
                  onToggleOpen={onToggleOpen}
                  selected={selected}
                  toggle={toggle}
                />
              ) : (
                <FileRow
                  row={row}
                  picked={pickedPath === row.file.path}
                  onPick={onPick}
                  selected={selected}
                  toggle={toggle}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



function FilePreview({ file, inlineLimit }: { file: ManifestFile | null; inlineLimit: number }) {
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
        Binärdatei ({humanBytes(file.size)}, {file.mime}). Keine Inline-Vorschau — Re-Export überträgt die Datei serverseitig.
      </div>
    );
  }
  if (file.kind === "oversized") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Datei zu groß für Inline-Vorschau ({humanBytes(file.size)} &gt; {humanBytes(inlineLimit)}). Re-Export funktioniert serverseitig.
      </div>
    );
  }
  const text = file.text ?? "";
  const isJson = file.mime === "application/json";
  let pretty = text;
  if (isJson) {
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
  }
  return (
    <ScrollArea className="h-full">
      <pre className="text-xs p-4 whitespace-pre-wrap break-all font-mono">{pretty}</pre>
    </ScrollArea>
  );
}

export default function ExportPreviewPage() {
  const { packageId } = useParams<{ packageId: string }>();
  const [refreshTick, setRefreshTick] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["export-manifest", packageId, refreshTick],
    queryFn: () => fetchExportManifest(packageId!, { refresh: refreshTick > 0 }),
    enabled: !!packageId,
    staleTime: 5 * 60_000,
  });

  const tree = useMemo(() => (data ? buildTree(data.files) : null), [data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<ManifestFile | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleRefresh = () => { setRefreshTick((n) => n + 1); refetch(); };

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

  // Offline export validation — computed live as selection mutates.
  const validation: ExportValidationReport | null = useMemo(
    () => (data ? validateExportCompleteness(data.files, selected) : null),
    [data, selected],
  );

  const handleAutoFix = () => {
    if (!data) return;
    const next = autoIncludeCriticalPaths(data.files, selected);
    setSelected(next);
    toast.success("Fehlende kritische Inhalte automatisch wieder aufgenommen.");
  };

  const handleAutoFixCategory = (category: ExportCategory, label: string) => {
    if (!data) return;
    const next = autoIncludeCategoryPaths(data.files, selected, category);
    setSelected(next);
    toast.success(`Kategorie „${label}" automatisch ergänzt.`);
  };

  const handleCopySummary = async () => {
    if (!validation) return;
    const md = toCopyableSummary(validation);
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Validierungs-Report in Zwischenablage kopiert.");
    } catch {
      toast.error("Kopieren fehlgeschlagen — bitte manuell auswählen.");
    }
  };

  const handleExport = async () => {
    if (!data) return;
    if (validation?.blocking) {
      toast.error("Export gesperrt: kritische Inhalte fehlen oder sind blockiert.");
      return;
    }
    if (validation && !validation.ok) {
      const next = autoIncludeCriticalPaths(data.files, selected);
      setSelected(next);
      toast.message("Fehlende Dateien automatisch ergänzt — bitte erneut bestätigen.");
      return;
    }
    setExporting(true);
    try {
      const accepted = Array.from(selected);
      const { blob, filename } = await downloadFilteredZip(data.package_id, accepted);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const rejected = data.file_count - accepted.length;
      toast.success(`ZIP exportiert: ${accepted.length} angenommen, ${rejected} verworfen`);
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
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Manifest neu laden
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={!data || exporting || selected.size === 0 || (validation?.blocking ?? false)}
              aria-disabled={!data || exporting || (validation?.blocking ?? false)}
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
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
                <span>Dateien: <strong>{data.file_count}</strong></span>
                <span>Größe: <strong>{humanBytes(data.total_bytes)}</strong></span>
                <span>Inline-Limit: <strong>{humanBytes(data.inline_limit_bytes)}</strong></span>
                <span>Quelle: <span className="font-mono">{data.export_path}</span></span>
                <span>Hash: <span className="font-mono">{data.export_hash.slice(0, 12)}…</span></span>
                <span>Cache: <strong>{data.cache_hit ? "hit" : "miss"}</strong></span>
              </div>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  „Manifest neu laden" erzeugt einen frischen Export-Stand und invalidiert den Cache.
                  Re-Export läuft serverseitig über den gespeicherten Original-ZIP — Binärdateien
                  werden hier nicht inline gehalten.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {validation && data && (
        <Alert variant={validation.blocking ? "destructive" : "default"} data-testid="export-validation">
          {validation.ok ? (
            <ShieldCheck className="h-4 w-4" />
          ) : validation.blocking ? (
            <ShieldAlert className="h-4 w-4" />
          ) : (
            <Info className="h-4 w-4" />
          )}
          <AlertTitle className="flex flex-wrap items-center gap-2">
            <span>Offline-Export-Validierung</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7"
              onClick={handleCopySummary}
              data-testid="export-validation-copy"
              aria-label="Validierungs-Report kopieren"
            >
              <Copy className="h-3 w-3 mr-1" /> Report kopieren
            </Button>
            {!validation.ok && !validation.blocking && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={handleAutoFix}
                data-testid="export-validation-autofix-all"
              >
                <Wand2 className="h-3 w-3 mr-1" /> Alles auto-ergänzen
              </Button>
            )}
          </AlertTitle>
          <AlertDescription className="text-xs space-y-2">
            <div>{validation.summary}</div>
            <ul className="space-y-1.5">
              {validation.reports.map((r) => {
                const tone =
                  r.blocked.length > 0 || (r.critical && r.total === 0)
                    ? "destructive"
                    : r.missing > 0
                      ? "secondary"
                      : "outline";
                const hasDetails = r.missingPaths.length > 0 || r.blocked.length > 0;
                return (
                  <li key={r.category} className="rounded border border-border/50 px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={tone as "destructive" | "secondary" | "outline"}>{r.label}</Badge>
                      <span className="text-muted-foreground">
                        {r.selected}/{r.total} enthalten
                        {r.missing > 0 ? `, ${r.missing} fehlen` : ""}
                        {r.blocked.length > 0 ? `, ${r.blocked.length} blockiert` : ""}
                        {r.critical ? " · kritisch" : ""}
                      </span>
                      {r.missing > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-6 text-[11px]"
                          onClick={() => handleAutoFixCategory(r.category, r.label)}
                          data-testid={`export-validation-autofix-${r.category}`}
                          aria-label={`„${r.label}" automatisch ergänzen`}
                        >
                          <Wand2 className="h-3 w-3 mr-1" /> Auto-Fix
                        </Button>
                      )}
                    </div>
                    {hasDetails && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <ChevronsUpDown className="h-3 w-3" />
                            Dateien anzeigen
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-tight">
                            {r.missingPaths.slice(0, 200).map((p) => (
                              <li key={`m-${p}`} className="text-amber-700 dark:text-amber-300">
                                · {p}
                              </li>
                            ))}
                            {r.missingPaths.length > 200 && (
                              <li className="text-muted-foreground">
                                … +{r.missingPaths.length - 200} weitere
                              </li>
                            )}
                            {r.blocked.slice(0, 50).map((p) => (
                              <li key={`b-${p}`} className="text-destructive">
                                [blockiert] {p}
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {tree && data && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1fr)_2fr] gap-4">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-sm">Dateien</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <VirtualTree
                tree={tree}
                selected={selected}
                toggle={toggle}
                onPick={setPicked}
                pickedPath={picked?.path ?? null}
              />
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
              <FilePreview file={picked} inlineLimit={data.inline_limit_bytes} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
