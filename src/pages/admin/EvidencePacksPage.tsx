import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listEvidencePacks,
  listLatestEvidencePacks,
  getSignedUrlForPack,
  getInlinePack,
  generateEvidencePack,
  type EvidencePackRow,
  type LatestPackRow,
} from "@/lib/evidencePacks";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Copy,
  RefreshCw,
  FileArchive,
  GitCompare,
  Loader2,
  Database,
  Cloud,
  Plus,
} from "lucide-react";

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function shortId(s: string | null | undefined, left = 8, right = 6): string {
  if (!s) return "—";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export default function EvidencePacksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters
  const [courseId, setCourseId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [selectedCourseForGenerate, setSelectedCourseForGenerate] = useState("");

  // Diff selection
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  // Courses for dropdown
  const { data: courses = [] } = useQuery({
    queryKey: ["admin-courses-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, title, curriculum_id")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });

  // All packs query
  const {
    data: allPacks = [],
    isLoading: loadingAll,
    refetch: refetchAll,
  } = useQuery({
    queryKey: ["evidence-packs", courseId, curriculumId],
    queryFn: () =>
      listEvidencePacks({
        courseId: courseId.trim() || undefined,
        curriculumId: curriculumId.trim() || undefined,
        limit: 100,
      }),
  });

  // Latest packs query
  const {
    data: latestPacks = [],
    isLoading: loadingLatest,
    refetch: refetchLatest,
  } = useQuery({
    queryKey: ["evidence-packs-latest"],
    queryFn: () => listLatestEvidencePacks(50),
  });

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: (courseId: string) => generateEvidencePack(courseId),
    onSuccess: (data) => {
      toast({
        title: "Evidence Pack erstellt",
        description: `Fingerprint: ${shortId(data.fingerprint_sha256, 12, 10)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["evidence-packs"] });
      queryClient.invalidateQueries({ queryKey: ["evidence-packs-latest"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Fehler",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const canDiff = useMemo(
    () => !!selectedA && !!selectedB && selectedA !== selectedB,
    [selectedA, selectedB]
  );

  async function handleDownload(pack: EvidencePackRow) {
    try {
      if (pack.storage_path) {
        const url = await getSignedUrlForPack(pack.id);
        window.open(url, "_blank");
      } else if (pack.has_inline_pack) {
        const data = await getInlinePack(pack.id);
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `evidence-pack-${shortId(pack.id)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        throw new Error("Pack hat weder Storage-Pfad noch Inline-Daten");
      }
    } catch (err: any) {
      toast({
        title: "Download fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} kopiert` });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            Evidence Packs
          </h1>
          <p className="text-muted-foreground">
            Audit-sichere Kurs-Snapshots verwalten und vergleichen
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FileArchive className="h-8 w-8 text-primary" />
        </div>
      </div>

      <Tabs defaultValue="latest" className="space-y-4">
        <TabsList>
          <TabsTrigger value="latest">Übersicht</TabsTrigger>
          <TabsTrigger value="all">Alle Packs</TabsTrigger>
          <TabsTrigger value="generate">Neu erstellen</TabsTrigger>
        </TabsList>

        {/* Latest Packs Tab */}
        <TabsContent value="latest" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Neuestes Pack pro Kurs
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchLatest()}
              disabled={loadingLatest}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loadingLatest ? "animate-spin" : ""}`}
              />
              Aktualisieren
            </Button>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kurs</TableHead>
                  <TableHead>Curriculum</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>Größe</TableHead>
                  <TableHead>Packs</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLatest && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingLatest && latestPacks.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Keine Evidence Packs vorhanden
                    </TableCell>
                  </TableRow>
                )}
                {latestPacks.map((p) => (
                  <TableRow key={p.latest_pack_id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {p.course_title || shortId(p.course_id)}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {shortId(p.course_id)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {p.curriculum_title || shortId(p.curriculum_id)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(p.generated_at).toLocaleString("de-DE")}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {shortId(p.fingerprint_sha256, 10, 8)}
                      </code>
                    </TableCell>
                    <TableCell>{formatBytes(p.size_bytes)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.pack_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCourseId(p.course_id);
                          }}
                        >
                          Alle anzeigen
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* All Packs Tab */}
        <TabsContent value="all" className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Course ID</label>
              <Input
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                placeholder="uuid..."
                className="w-80"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">
                Curriculum ID
              </label>
              <Input
                value={curriculumId}
                onChange={(e) => setCurriculumId(e.target.value)}
                placeholder="uuid..."
                className="w-80"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => refetchAll()}
              disabled={loadingAll}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loadingAll ? "animate-spin" : ""}`}
              />
              Laden
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCourseId("");
                setCurriculumId("");
                setSelectedA(null);
                setSelectedB(null);
              }}
            >
              Reset
            </Button>
          </div>

          {/* Diff Selection */}
          <div className="glass-card rounded-xl p-4 flex flex-wrap items-center gap-4">
            <GitCompare className="h-5 w-5 text-primary" />
            <span className="font-medium">Diff-Auswahl:</span>
            <div className="flex gap-2 items-center">
              <Badge variant={selectedA ? "default" : "outline"}>
                A: {selectedA ? shortId(selectedA, 8, 6) : "—"}
              </Badge>
              <Badge variant={selectedB ? "default" : "outline"}>
                B: {selectedB ? shortId(selectedB, 8, 6) : "—"}
              </Badge>
            </div>
            <Button
              disabled={!canDiff}
              onClick={() => {
                toast({
                  title: "Diff-Ansicht (nächster Schritt)",
                  description: `A: ${shortId(selectedA!, 8, 6)} vs B: ${shortId(selectedB!, 8, 6)}`,
                });
              }}
            >
              <GitCompare className="h-4 w-4 mr-2" />
              Diff anzeigen
            </Button>
            {(selectedA || selectedB) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedA(null);
                  setSelectedB(null);
                }}
              >
                Auswahl löschen
              </Button>
            )}
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Diff</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Curriculum</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Speicher</TableHead>
                  <TableHead>Größe</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingAll && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingAll && allPacks.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Keine Evidence Packs gefunden
                    </TableCell>
                  </TableRow>
                )}
                {allPacks.map((pack) => {
                  const isA = selectedA === pack.id;
                  const isB = selectedB === pack.id;

                  return (
                    <TableRow key={pack.id}>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={isA ? "default" : "outline"}
                            className="w-8 h-8 p-0"
                            onClick={() => setSelectedA(pack.id)}
                          >
                            A
                          </Button>
                          <Button
                            size="sm"
                            variant={isB ? "default" : "outline"}
                            className="w-8 h-8 p-0"
                            onClick={() => setSelectedB(pack.id)}
                          >
                            B
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(pack.generated_at).toLocaleString("de-DE")}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">
                          {shortId(pack.course_id, 8, 6)}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">
                          {shortId(pack.curriculum_id, 8, 6)}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {shortId(pack.fingerprint_sha256, 10, 8)}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{pack.export_version}</Badge>
                      </TableCell>
                      <TableCell>
                        {pack.storage_path ? (
                          <Cloud className="h-4 w-4 text-primary" />
                        ) : pack.has_inline_pack ? (
                          <Database className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <span className="text-destructive">—</span>
                        )}
                      </TableCell>
                      <TableCell>{formatBytes(pack.size_bytes)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(pack)}
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(pack.id, "Pack ID")}
                            title="Pack ID kopieren"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Generate Tab */}
        <TabsContent value="generate" className="space-y-4">
          <div className="glass-card rounded-xl p-6 max-w-xl">
            <h2 className="text-lg font-semibold mb-4">
              Neues Evidence Pack erstellen
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Erstellt einen audit-sicheren Snapshot des Kurses mit SHA256-Fingerprint.
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kurs auswählen</label>
                <Select
                  value={selectedCourseForGenerate}
                  onValueChange={setSelectedCourseForGenerate}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kurs wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => generateMutation.mutate(selectedCourseForGenerate)}
                disabled={!selectedCourseForGenerate || generateMutation.isPending}
                className="w-full"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Evidence Pack generieren
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
