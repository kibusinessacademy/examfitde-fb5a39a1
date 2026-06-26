import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  Loader2, Download, CheckCircle2, XCircle, Package, Info, PlayCircle,
  RefreshCw, ExternalLink, ShieldCheck, ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminVisiblePackages } from "@/hooks/useAdminVisiblePackages";
import { useAdminPublishReadinessBatch } from "@/hooks/useAdminPublishReadinessBatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "all", label: "Alle Status" },
  { value: "published", label: "Published (live verkaufbar)" },
  { value: "done", label: "Done (Build fertig, nicht published)" },
  { value: "building", label: "Building (aktive Pipeline)" },
  { value: "queued", label: "Queued (wartet auf Build)" },
  { value: "planning", label: "Planning" },
  { value: "blocked", label: "Blocked (Integrity/Quality-Gate)" },
  { value: "failed", label: "Failed (manueller Eingriff nötig)" },
  { value: "archived", label: "Archived" },
];

type PlayerValidation = {
  requested: boolean;
  has_player_index_html: boolean;
  has_player_data_json: boolean;
  complete: boolean;
  reason: string;
};

type RowState = {
  status: "idle" | "queued" | "running" | "done" | "error";
  message?: string;
  url?: string;
  playerUrl?: string | null;
  playerValidation?: PlayerValidation;
  variant?: "zip" | "with-player";
};


const CONCURRENCY = 2;

export default function BulkCourseExportPage() {
  const { data: packages = [], isLoading } = useAdminVisiblePackages();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of packages) m[p.status] = (m[p.status] || 0) + 1;
    return m;
  }, [packages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packages.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.canonical_title || "").toLowerCase().includes(q) ||
        (p.beruf_display_name || "").toLowerCase().includes(q) ||
        p.package_id.toLowerCase().includes(q)
      );
    });
  }, [packages, search, statusFilter]);

  // Fetch full publish-gate signals for all non-published packages on the current page
  // — keeps the UI honest about Open Steps, Meta-Drift, Bronze etc.
  const gateProbeIds = useMemo(
    () => filtered.filter((p) => p.status !== "published").map((p) => p.package_id),
    [filtered],
  );
  const { data: readinessMap = {} } = useAdminPublishReadinessBatch(gateProbeIds);

  const selectedIds = useMemo(
    () => filtered.filter((p) => selected[p.package_id]).map((p) => p.package_id),
    [filtered, selected],
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected[p.package_id]);
  const someSelected = selectedIds.length > 0;

  function toggleAll() {
    if (allFilteredSelected) {
      const next = { ...selected };
      for (const p of filtered) delete next[p.package_id];
      setSelected(next);
    } else {
      const next = { ...selected };
      for (const p of filtered) next[p.package_id] = true;
      setSelected(next);
    }
  }

  function toggleOne(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function exportOne(packageId: string, courseId: string | null, includePlayer = false) {
    setRowState((s) => ({ ...s, [packageId]: { status: "running", variant: includePlayer ? "with-player" : "zip" } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("export-course-package", {
        body: { packageId, courseId, includePlayer },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const data = res.data as {
        downloadUrl?: string;
        playerUrl?: string | null;
        player_validation?: PlayerValidation;
      };
      if (!data?.downloadUrl) throw new Error("Keine Download-URL erhalten");
      // trigger browser download
      const a = document.createElement("a");
      a.href = data.downloadUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setRowState((s) => ({
        ...s,
        [packageId]: {
          status: "done",
          url: data.downloadUrl,
          playerUrl: data.playerUrl ?? null,
          playerValidation: data.player_validation,
          variant: includePlayer ? "with-player" : "zip",
        },
      }));
      if (includePlayer && data.player_validation && !data.player_validation.complete) {
        toast.error(`Player-Validierung fehlgeschlagen: ${data.player_validation.reason}`);
      } else if (includePlayer && data.playerUrl) {
        toast.success("Player-Hosting-URL bereit (7 Tage gültig)");
      }
    } catch (e: any) {
      setRowState((s) => ({
        ...s,
        [packageId]: { status: "error", message: e?.message || "Unbekannter Fehler" },
      }));
    }
  }


  async function runBulk() {
    if (selectedIds.length === 0) {
      toast.error("Keine Pakete ausgewählt");
      return;
    }
    setRunning(true);
    const queue = filtered.filter((p) => selected[p.package_id]);
    // mark all queued
    setRowState((s) => {
      const next = { ...s };
      for (const p of queue) next[p.package_id] = { status: "queued" };
      return next;
    });

    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const idx = cursor++;
        const pkg = queue[idx];
        await exportOne(pkg.package_id, pkg.course_id);
      }
    });
    await Promise.all(workers);
    setRunning(false);
    toast.success(`Bulk-Export abgeschlossen (${queue.length} Pakete)`);
  }

  async function forceRebuild(packageId: string) {
    const ok = window.confirm(
      "Force Rebuild: Paket wird auf 'queued' zurückgesetzt und vom Pipeline-Worker neu aufgebaut. Fortfahren?",
    );
    if (!ok) return;
    const { data, error } = await (supabase as any).rpc("admin_force_rebuild_package", {
      p_package_id: packageId,
    });
    if (error) {
      toast.error(`Force Rebuild fehlgeschlagen: ${error.message}`);
      return;
    }
    toast.success(`Paket neu eingereiht (vorher: ${data?.previous_status || "?"})`);
    queryClient.invalidateQueries({ queryKey: ["admin-visible-course-packages"] });
  }

  const doneCount = Object.values(rowState).filter((r) => r.status === "done").length;
  const errorCount = Object.values(rowState).filter((r) => r.status === "error").length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Helmet>
        <title>Bulk Kurs-Export | Admin</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6" /> Bulk Kurspaket-Export
        </h1>
        <p className="text-muted-foreground text-sm">
          Wähle einzelne, mehrere oder alle Kurspakete aus und lade sie als komplette ZIP-Pakete
          herunter. Exports laufen parallel ({CONCURRENCY} gleichzeitig); pro fertigem Paket öffnet
          sich automatisch der Download.
        </p>
      </header>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          <PlayCircle className="h-4 w-4" /> Wie spiele ich ein exportiertes Paket ab?
        </AlertTitle>
        <AlertDescription className="text-sm space-y-1">
          <p>
            Der Export ist ein <strong>ZIP-Archiv</strong> mit Lektions-HTML, PDF-Handbüchern, JSON-Manifest,
            Mini-Checks und (sofern vorhanden) Audio-/Video-Assets. Es ist <em>keine</em> selbst-startende
            Software — die Wiedergabe erfolgt auf einem dieser Wege:
          </p>
          <ul className="list-disc ml-5">
            <li><strong>Web-Player (empfohlen)</strong>: Im Lernerbereich unter <code>/lernen/&lt;package&gt;</code> abspielbar, sobald das Paket published ist.</li>
            <li><strong>Offline-Sichtung</strong>: ZIP entpacken und <code>index.html</code> im Browser öffnen (statisches Bundle).</li>
            <li><strong>SCORM/H5P-Import</strong>: Manifest-Ordner in jedes SCORM-1.2-kompatible LMS (Moodle, ILIAS, TalentLMS) hochladen.</li>
            <li><strong>PDF-only</strong>: Für Print/Druck reicht das Handbuch im <code>/handbook/</code>-Ordner.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Status-Bedeutung</AlertTitle>
        <AlertDescription className="text-sm space-y-1">
          <ul className="list-disc ml-5">
            <li><strong>published</strong> ({statusCounts.published || 0}): Live im Shop, kaufbar, im Web-Player abspielbar.</li>
            <li><strong>done</strong> ({statusCounts.done || 0}): Build zu 100% fertig, aber Council-Approval oder Integrity-Gate noch offen → wird <em>nicht</em> automatisch published. Manuelle Freigabe oder Re-Audit nötig.</li>
            <li><strong>building / queued / planning</strong>: aktive Pipeline. <code>auto-heal-runner</code> + <code>autonomous-factory</code> bewegen sie weiter (cron alle 5–15 Min).</li>
            <li><strong>blocked</strong> ({statusCounts.blocked || 0}): Quality-Gate verweigert (z. B. fehlende Lektionen). Self-Heal versucht es wiederholt; nach 2 Fehlversuchen Hard-Stop bis manueller Eingriff.</li>
            <li><strong>failed</strong> ({statusCounts.failed || 0}): Pipeline hat aufgegeben. Wird <em>nicht</em> automatisch neu gebaut — manueller Re-Enqueue über Admin-Pipeline oder „Force Rebuild" nötig.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Suche nach Titel, Beruf oder Package-ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Status filtern" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
                {opt.value !== "all" && statusCounts[opt.value] != null && (
                  <span className="text-muted-foreground"> ({statusCounts[opt.value]})</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary">{filtered.length} sichtbar</Badge>
        <Badge>{selectedIds.length} ausgewählt</Badge>
        {doneCount > 0 && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {doneCount} fertig
          </Badge>
        )}
        {errorCount > 0 && (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" /> {errorCount} Fehler
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setSelected({})} disabled={!someSelected || running}>
            Auswahl löschen
          </Button>
          <Button onClick={runBulk} disabled={!someSelected || running}>
            {running ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {selectedIds.length > 0 ? `${selectedIds.length} Pakete exportieren` : "Exportieren"}
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Alle auswählen"
                  disabled={running || filtered.length === 0}
                />
              </TableHead>
              <TableHead>Titel</TableHead>
              <TableHead>Beruf</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-56">Gates</TableHead>
              <TableHead className="w-44">Export</TableHead>
              <TableHead className="w-72 text-right">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Keine Kurspakete gefunden.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((pkg) => {
              const rs = rowState[pkg.package_id];
              return (
                <TableRow key={pkg.package_id} data-state={selected[pkg.package_id] ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={!!selected[pkg.package_id]}
                      onCheckedChange={() => toggleOne(pkg.package_id)}
                      disabled={running}
                      aria-label={`${pkg.canonical_title} auswählen`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {pkg.canonical_title}
                    <div className="text-xs text-muted-foreground font-mono">
                      {pkg.package_id.slice(0, 8)}…
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {pkg.beruf_display_name || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{pkg.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-xs">
                      {pkg.status === "published" ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <ShieldCheck className="h-3 w-3" /> Live published
                        </span>
                      ) : (
                        <>
                          <span
                            className={`flex items-center gap-1 ${pkg.integrity_passed ? "text-green-600" : "text-destructive"}`}
                            title="Integrity-Gate: alle Pflicht-Komponenten vorhanden & valide"
                          >
                            {pkg.integrity_passed ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                            Integrity {pkg.integrity_passed ? "OK" : "fehlt"}
                          </span>
                          <span
                            className={`flex items-center gap-1 ${pkg.council_approved ? "text-green-600" : "text-destructive"}`}
                            title="Council-Approval: Quality-Council hat Freigabe erteilt"
                          >
                            {pkg.council_approved ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                            Council {pkg.council_approved ? "OK" : "fehlt"}
                          </span>
                          {pkg.status === "done" && (!pkg.integrity_passed || !pkg.council_approved) && (
                            <span className="text-muted-foreground">→ blockiert Publish</span>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {!rs && <span className="text-xs text-muted-foreground">—</span>}
                    {rs?.status === "queued" && (
                      <span className="text-xs text-muted-foreground">In Warteschlange…</span>
                    )}
                    {rs?.status === "running" && (
                      <span className="text-xs flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Export läuft…
                      </span>
                    )}
                    {rs?.status === "done" && (
                      <div className="text-xs space-y-1">
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Fertig
                          {rs.variant === "with-player" && <Badge variant="outline" className="ml-1 text-[10px] py-0">+Player</Badge>}
                        </span>
                        {rs.variant === "with-player" && rs.playerValidation && (
                          rs.playerValidation.complete ? (
                            <span className="text-green-600 flex items-center gap-1" title={rs.playerValidation.reason}>
                              <ShieldCheck className="h-3 w-3" /> player/ validiert
                            </span>
                          ) : (
                            <span className="text-destructive flex items-start gap-1" title={rs.playerValidation.reason}>
                              <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>
                                player/ fehlt
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  Hinweis: includePlayer=true senden
                                </div>
                              </span>
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {rs?.status === "error" && (
                      <span className="text-xs text-destructive flex items-center gap-1" title={rs.message}>
                        <XCircle className="h-3 w-3" /> {rs.message?.slice(0, 40) || "Fehler"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 flex-wrap">
                      {rs?.playerUrl && (
                        <Button asChild size="sm" variant="default" title="Offline-Player direkt im Browser öffnen (gehostet, kein Entpacken nötig)">
                          <a href={rs.playerUrl} target="_blank" rel="noopener noreferrer">
                            <PlayCircle className="h-3 w-3 mr-1" /> Im Player ansehen
                          </a>
                        </Button>
                      )}
                      {pkg.status === "published" && pkg.course_id && (
                        <Button asChild size="sm" variant="outline" title="Im Web-Player ansehen">
                          <a href={`/course/${pkg.course_id}`} target="_blank" rel="noopener noreferrer">
                            <PlayCircle className="h-3 w-3 mr-1" /> Web-Player
                          </a>
                        </Button>
                      )}
                      {pkg.status === "failed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => forceRebuild(pkg.package_id)}
                          title="Status zurück auf 'queued' setzen und Pipeline neu starten"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" /> Force Rebuild
                        </Button>
                      )}
                      {rs?.status === "done" && rs.url ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={rs.url} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3 w-3 mr-1" /> Erneut
                          </a>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={running || rs?.status === "running"}
                          onClick={() => exportOne(pkg.package_id, pkg.course_id, false)}
                          title="ZIP-Export ohne Player (Daten + Handbuch)"
                        >
                          <Download className="h-3 w-3 mr-1" /> Export
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={running || rs?.status === "running"}
                        onClick={() => exportOne(pkg.package_id, pkg.course_id, true)}
                        title="ZIP inkl. Offline-HTML-Player + direkter Hosting-URL (includePlayer=true)"
                      >
                        <PlayCircle className="h-3 w-3 mr-1" /> + Player
                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                      </Button>
                    </div>
                  </TableCell>

                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
