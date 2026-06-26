import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2, Download, CheckCircle2, XCircle, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminVisiblePackages } from "@/hooks/useAdminVisiblePackages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type RowState = {
  status: "idle" | "queued" | "running" | "done" | "error";
  message?: string;
  url?: string;
};

const CONCURRENCY = 2;

export default function BulkCourseExportPage() {
  const { data: packages = [], isLoading } = useAdminVisiblePackages();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter((p) =>
      (p.canonical_title || "").toLowerCase().includes(q) ||
      (p.beruf_display_name || "").toLowerCase().includes(q) ||
      p.package_id.toLowerCase().includes(q),
    );
  }, [packages, search]);

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

  async function exportOne(packageId: string, courseId: string | null) {
    setRowState((s) => ({ ...s, [packageId]: { status: "running" } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("export-course-package", {
        body: { packageId, courseId },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const data = res.data as { downloadUrl?: string };
      if (!data?.downloadUrl) throw new Error("Keine Download-URL erhalten");
      // trigger browser download
      const a = document.createElement("a");
      a.href = data.downloadUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setRowState((s) => ({ ...s, [packageId]: { status: "done", url: data.downloadUrl } }));
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

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Suche nach Titel, Beruf oder Package-ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
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
              <TableHead className="w-44">Export</TableHead>
              <TableHead className="w-32 text-right">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
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
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Fertig
                      </span>
                    )}
                    {rs?.status === "error" && (
                      <span className="text-xs text-destructive flex items-center gap-1" title={rs.message}>
                        <XCircle className="h-3 w-3" /> {rs.message?.slice(0, 40) || "Fehler"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
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
                        onClick={() => exportOne(pkg.package_id, pkg.course_id)}
                      >
                        <Download className="h-3 w-3 mr-1" /> Export
                      </Button>
                    )}
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
