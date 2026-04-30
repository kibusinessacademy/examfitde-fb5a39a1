/**
 * SEO Dead-End Drift Cockpit-Card
 *
 * Zeigt alle published SEO-Seiten ohne valide Produktbindung an
 * (v_seo_dead_end_drift) und bietet pro Eintrag gezielte Bulk-Actions:
 *
 *  - seo_content_pages → package_not_published
 *      → "Paket re-publishen"  (admin_seo_republish_package)
 *      → "Auf Entwurf setzen"  (admin_seo_set_page_draft)
 *
 *  - certification_seo_pages → unmatched_no_product
 *      → "Produkt-Slug-Override setzen"  (admin_seo_set_product_override)
 *      → "Draft-Paket anlegen"           (admin_seo_create_draft_package)
 *
 * Bewusst keine Bulk-Aktion über alle Zeilen — jede Entscheidung pro Zeile,
 * weil viele SEO-Seiten Traffic bringen können.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";

interface DriftRow {
  source_table: "seo_content_pages" | "certification_seo_pages";
  seo_id: string;
  slug: string;
  page_type: string | null;
  status: string | null;
  package_id: string | null;
  curriculum_id: string | null;
  drift_reason: string;
  auto_repairable: boolean;
}

interface MatchSuggestion {
  package_id: string;
  package_title: string;
  package_status: string;
  canonical_slug: string;
  match_score: number;
  match_reason: "strong_match" | "likely_match" | "weak_match" | "no_match";
}

type DialogState =
  | { kind: "none" }
  | { kind: "override"; row: DriftRow; value: string }
  | { kind: "createPackage"; row: DriftRow; curriculumId: string; title: string; track: string }
  | { kind: "suggest"; row: DriftRow; loading: boolean; suggestions: MatchSuggestion[] };

const REASON_LABEL: Record<string, string> = {
  package_not_published: "Paket nicht published",
  unmatched_no_product: "Kein Produkt zugeordnet",
  missing_package_id: "package_id fehlt",
  package_not_found: "Paket existiert nicht",
  missing_curriculum_id_repairable: "curriculum_id fehlt (auto)",
};

const REASON_RECOMMENDATION: Record<string, string> = {
  package_not_published: "Quality prüfen, dann republish",
  unmatched_no_product: "Override setzen, falls ähnliches Produkt existiert",
  missing_package_id: "Manuelle Prüfung — kein Paket verknüpft",
  package_not_found: "Auf Entwurf setzen — Paket existiert nicht mehr",
  missing_curriculum_id_repairable: "Auto-Heal verfügbar",
};

const MATCH_VARIANT: Record<string, "success" | "info" | "warning"> = {
  strong_match: "success",
  likely_match: "info",
  weak_match: "warning",
};

export function SeoDeadEndDriftCard() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["seo-dead-end-drift"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_seo_dead_end_drift" as never)
        .select("*")
        .order("source_table", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as DriftRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((r) =>
      [r.slug, r.drift_reason, r.page_type ?? ""].some((s) => s.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      contentPkgUnpublished: list.filter(
        (r) => r.source_table === "seo_content_pages" && r.drift_reason === "package_not_published",
      ).length,
      certUnmatched: list.filter(
        (r) =>
          r.source_table === "certification_seo_pages" && r.drift_reason === "unmatched_no_product",
      ).length,
    };
  }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["seo-dead-end-drift"] });
  };

  const republish = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc("admin_seo_republish_package" as never, {
        p_package_id: packageId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Paket re-published");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDraft = useMutation({
    mutationFn: async (seoId: string) => {
      const { data, error } = await supabase.rpc("admin_seo_set_page_draft" as never, {
        p_seo_id: seoId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("SEO-Seite auf Entwurf gesetzt");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setOverride = useMutation({
    mutationFn: async (vars: { seoId: string; slug: string }) => {
      const { data, error } = await supabase.rpc("admin_seo_set_product_override" as never, {
        p_seo_id: vars.seoId,
        p_product_slug: vars.slug,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Produkt-Slug-Override gesetzt");
      setDialog({ kind: "none" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPkg = useMutation({
    mutationFn: async (vars: { curriculumId: string; title: string; track: string }) => {
      const { data, error } = await supabase.rpc("admin_seo_create_draft_package" as never, {
        p_curriculum_id: vars.curriculumId,
        p_title: vars.title,
        p_track: vars.track,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Draft-Paket angelegt");
      setDialog({ kind: "none" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loadSuggestions = async (row: DriftRow) => {
    setDialog({ kind: "suggest", row, loading: true, suggestions: [] });
    const { data, error } = await supabase.rpc(
      "admin_seo_suggest_product_matches" as never,
      { p_seo_id: row.seo_id, p_limit: 5 } as never,
    );
    if (error) {
      toast.error(error.message);
      setDialog({ kind: "none" });
      return;
    }
    setDialog({
      kind: "suggest",
      row,
      loading: false,
      suggestions: (data ?? []) as MatchSuggestion[],
    });
  };

  const batchApply = useMutation({
    mutationFn: async (vars: { dryRun: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_seo_batch_apply_strong_matches" as never,
        { p_min_score: 0.7, p_limit: 25, p_dry_run: vars.dryRun } as never,
      );
      if (error) throw error;
      return data as {
        ok: boolean;
        dry_run: boolean;
        applied_count: number;
        skipped_count: number;
      };
    },
    onSuccess: (res) => {
      const verb = res.dry_run ? "Vorschau" : "Übernommen";
      toast.success(
        `${verb}: ${res.applied_count} starke Matches · ${res.skipped_count} übersprungen`,
      );
      if (!res.dry_run) invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              SEO Dead-End Drift
            </CardTitle>
            <CardDescription>
              Published SEO-Seiten ohne valides Produkt — pro Zeile entscheiden statt blind heilen.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline">Gesamt: {counts.total}</Badge>
          <Badge variant="warning">Paket unpublished: {counts.contentPkgUnpublished}</Badge>
          <Badge variant="warning">Cert ohne Produkt: {counts.certUnmatched}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Slug / Reason / Page-Type filtern…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Keine Dead-Ends — sauber. ✅
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Quelle</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead className="w-[180px]">Reason</TableHead>
                  <TableHead className="w-[280px] text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.source_table}-${row.seo_id}`}>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {row.source_table === "seo_content_pages" ? "content" : "certification"}
                      </Badge>
                      {row.page_type && (
                        <div className="text-[10px] text-muted-foreground mt-1">{row.page_type}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <a
                        href={`/${row.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        {row.slug}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="warning" className="text-[10px]">
                        {REASON_LABEL[row.drift_reason] ?? row.drift_reason}
                      </Badge>
                      {REASON_RECOMMENDATION[row.drift_reason] && (
                        <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                          → {REASON_RECOMMENDATION[row.drift_reason]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {row.source_table === "seo_content_pages" && row.package_id && (
                        <>
                          <Button
                            size="sm"
                            variant="success"
                            onClick={() => republish.mutate(row.package_id!)}
                            disabled={republish.isPending}
                          >
                            Re-publish
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDraft.mutate(row.seo_id)}
                            disabled={setDraft.isPending}
                          >
                            → Draft
                          </Button>
                        </>
                      )}
                      {row.source_table === "certification_seo_pages" && (
                        <>
                          <Button
                            size="sm"
                            variant="success"
                            onClick={() => loadSuggestions(row)}
                            title="Auto-Match-Vorschläge anzeigen"
                          >
                            Auto-Match
                          </Button>
                          <Button
                            size="sm"
                            variant="info"
                            onClick={() =>
                              setDialog({ kind: "override", row, value: "" })
                            }
                          >
                            Override
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDialog({
                                kind: "createPackage",
                                row,
                                curriculumId: "",
                                title: row.slug.replace(/-pruefung$/, "").replace(/-/g, " "),
                                track: "EXAM_FIRST",
                              })
                            }
                          >
                            + Paket
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Dialog: Product-Slug-Override */}
      <Dialog
        open={dialog.kind === "override"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Produkt-Slug-Override setzen</DialogTitle>
            <DialogDescription>
              Verknüpft die Zertifikats-SEO-Seite mit dem Slug eines existierenden Pakets.
            </DialogDescription>
          </DialogHeader>
          {dialog.kind === "override" && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono">{dialog.row.slug}</div>
              <div>
                <Label htmlFor="override-slug">Produkt-Slug</Label>
                <Input
                  id="override-slug"
                  placeholder="z. B. fachwirt-einkauf-bundle"
                  value={dialog.value}
                  onChange={(e) =>
                    setDialog({ ...dialog, value: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ kind: "none" })}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                if (dialog.kind !== "override") return;
                setOverride.mutate({ seoId: dialog.row.seo_id, slug: dialog.value });
              }}
              disabled={
                dialog.kind !== "override" ||
                !dialog.value.trim() ||
                setOverride.isPending
              }
            >
              {setOverride.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Setzen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Create draft package */}
      <Dialog
        open={dialog.kind === "createPackage"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft-Paket anlegen</DialogTitle>
            <DialogDescription>
              Legt ein unveröffentlichtes Kurspaket an. Inhalte später füllen, dann re-publishen.
            </DialogDescription>
          </DialogHeader>
          {dialog.kind === "createPackage" && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono">{dialog.row.slug}</div>
              <div>
                <Label htmlFor="cur-id">Curriculum ID</Label>
                <Input
                  id="cur-id"
                  placeholder="UUID des Curriculums"
                  value={dialog.curriculumId}
                  onChange={(e) => setDialog({ ...dialog, curriculumId: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pkg-title">Titel</Label>
                <Input
                  id="pkg-title"
                  value={dialog.title}
                  onChange={(e) => setDialog({ ...dialog, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pkg-track">Track</Label>
                <Input
                  id="pkg-track"
                  value={dialog.track}
                  onChange={(e) => setDialog({ ...dialog, track: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ kind: "none" })}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                if (dialog.kind !== "createPackage") return;
                createPkg.mutate({
                  curriculumId: dialog.curriculumId,
                  title: dialog.title,
                  track: dialog.track,
                });
              }}
              disabled={
                dialog.kind !== "createPackage" ||
                !dialog.curriculumId.trim() ||
                !dialog.title.trim() ||
                createPkg.isPending
              }
            >
              {createPkg.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Auto-Match-Vorschläge */}
      <Dialog
        open={dialog.kind === "suggest"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Auto-Match-Vorschläge</DialogTitle>
            <DialogDescription>
              Trigram-basierte Top-Kandidaten. Klick auf „Übernehmen" setzt den Slug-Override sofort.
            </DialogDescription>
          </DialogHeader>
          {dialog.kind === "suggest" && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono break-all">
                {dialog.row.slug}
              </div>
              {dialog.loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : dialog.suggestions.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center border rounded-md">
                  Keine ähnlichen Pakete gefunden — bitte „+ Paket" anlegen oder manuell prüfen.
                </div>
              ) : (
                <div className="rounded-md border divide-y">
                  {dialog.suggestions.map((s) => (
                    <div
                      key={s.package_id}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={MATCH_VARIANT[s.match_reason] ?? "outline"}
                            className="text-[10px]"
                          >
                            {s.match_reason} · {(s.match_score * 100).toFixed(0)}%
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {s.package_status}
                          </Badge>
                        </div>
                        <div className="text-sm font-medium truncate mt-1">
                          {s.package_title}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {s.canonical_slug}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={setOverride.isPending}
                        onClick={() =>
                          setOverride.mutate({
                            seoId: dialog.row.seo_id,
                            slug: s.canonical_slug,
                          })
                        }
                      >
                        Übernehmen
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ kind: "none" })}>
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default SeoDeadEndDriftCard;
