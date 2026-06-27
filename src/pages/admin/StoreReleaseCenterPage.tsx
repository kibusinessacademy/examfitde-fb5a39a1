// Store Release Center — Admin Cockpit
// Foundation page for MOBILE.COURSE.PACKAGE.OS.1 release lifecycle:
//   - Lists courses with a mobile_course_app_manifest
//   - Shows Apple/Google listing status + version + screenshot counts + build status
//   - Per-row actions: Generate/Refresh Listing (Apple/Google) + Enqueue Screenshots
//   - Approve listing inline (status: review_ready → approved)
//
// All writes go through edge functions or RPCs; no client shadow state.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Apple, Smartphone, Camera, FileText, CheckCircle2, AlertCircle, Hammer, Rocket } from "lucide-react";

type Row = {
  course_id: string;
  course_title: string;
  bundle_id: string | null;
  version_name: string | null;
  app_store_listing_status: string | null;
  google_play_listing_status: string | null;
  release_status: string | null;
  last_built_at: string | null;
  last_build_status: string | null;
  apple_listing_status: string | null;
  apple_listing_version: number | null;
  google_listing_status: string | null;
  google_listing_version: number | null;
  apple_screenshots_ready: number;
  google_screenshots_ready: number;
};

const statusVariant = (s: string | null): "default" | "secondary" | "destructive" | "outline" => {
  if (!s) return "outline";
  if (s === "approved" || s === "published") return "default";
  if (s === "review_ready") return "secondary";
  if (s === "failed") return "destructive";
  return "outline";
};

export default function StoreReleaseCenterPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["store-release-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_store_release_status" as any)
        .select("*")
        .order("course_title", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  async function generateListing(courseId: string, platform: "apple" | "google") {
    const key = `${courseId}:${platform}:listing`;
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("store-listing-persist", {
        body: { courseId, platform, locale: "de" },
      });
      if (error) throw error;
      if ((data as any)?.deduped) {
        toast.info(`Listing unverändert (Hash identisch) – ${platform === "apple" ? "Apple" : "Google"}.`);
      } else {
        toast.success(`Neue Listing-Version erzeugt (${platform === "apple" ? "Apple" : "Google"}).`);
      }
      qc.invalidateQueries({ queryKey: ["store-release-status"] });
    } catch (e: any) {
      toast.error(`Listing-Erstellung fehlgeschlagen: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function enqueueScreenshots(courseId: string, platform: "apple" | "google") {
    const key = `${courseId}:${platform}:shots`;
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("store-screenshots-enqueue", {
        body: { courseId, platform },
      });
      if (error) throw error;
      toast.success(`Screenshot-Run eingereiht (${(data as any)?.pending_shots ?? 0} Aufnahmen).`);
      qc.invalidateQueries({ queryKey: ["store-release-status"] });
    } catch (e: any) {
      toast.error(`Screenshots fehlgeschlagen: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  async function approveListing(courseId: string, platform: "apple" | "google") {
    const key = `${courseId}:${platform}:approve`;
    setBusy(key);
    try {
      // Approve latest listing for this course/platform
      const { data: latest } = await supabase
        .from("store_release_listings" as any)
        .select("id, status, version")
        .eq("course_id", courseId)
        .eq("platform", platform)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) {
        toast.error("Kein Listing zum Freigeben vorhanden.");
        return;
      }
      const { error } = await supabase
        .from("store_release_listings" as any)
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", (latest as any).id);
      if (error) throw error;
      toast.success(`Listing v${(latest as any).version} freigegeben.`);
      qc.invalidateQueries({ queryKey: ["store-release-status"] });
    } catch (e: any) {
      toast.error(`Freigabe fehlgeschlagen: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }

  const summary = useMemo(() => {
    const r = rows ?? [];
    return {
      total: r.length,
      appleReady: r.filter((x) => x.apple_listing_status === "approved").length,
      googleReady: r.filter((x) => x.google_listing_status === "approved").length,
      shotsApple: r.filter((x) => x.apple_screenshots_ready > 0).length,
      shotsGoogle: r.filter((x) => x.google_screenshots_ready > 0).length,
    };
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Store Release Center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Listings, Screenshots und Build-Status pro Kurs (Apple / Google). Builds &amp; Uploads laufen
          erst nach Hinterlegen der Store-Credentials in den Workspace Build Secrets.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Kurse mit Manifest</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.total}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Apple Listings approved</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.appleReady}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Google Listings approved</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.googleReady}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Apple Screenshots</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.shotsApple}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Google Screenshots</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.shotsGoogle}</CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="size-4" /> Release-Status pro Kurs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !rows || rows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
              <AlertCircle className="size-4" /> Keine Kurse mit Mobile-Manifest gefunden. Erstelle zuerst ein
              Manifest im <a className="underline" href="/admin/tools/mobile-bundle-builder">Mobile Bundle Builder</a>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kurs</TableHead>
                    <TableHead>Bundle / Version</TableHead>
                    <TableHead><Apple className="size-4 inline" /> Apple Listing</TableHead>
                    <TableHead><Camera className="size-4 inline" /> Shots</TableHead>
                    <TableHead><Smartphone className="size-4 inline" /> Google Listing</TableHead>
                    <TableHead><Camera className="size-4 inline" /> Shots</TableHead>
                    <TableHead>Build</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.course_id}>
                      <TableCell className="font-medium">{r.course_title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{r.bundle_id ?? "—"}</div>
                        <div>v{r.version_name ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.apple_listing_status)}>
                          {r.apple_listing_status ? `${r.apple_listing_status} v${r.apple_listing_version}` : "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.apple_screenshots_ready > 0 ? "secondary" : "outline"}>
                          {r.apple_screenshots_ready}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.google_listing_status)}>
                          {r.google_listing_status ? `${r.google_listing_status} v${r.google_listing_version}` : "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.google_screenshots_ready > 0 ? "secondary" : "outline"}>
                          {r.google_screenshots_ready}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.last_build_status === "success" ? "default" : "outline"}>
                          {r.last_build_status ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="outline"
                            disabled={busy === `${r.course_id}:apple:listing`}
                            onClick={() => generateListing(r.course_id, "apple")}>
                            Apple Text
                          </Button>
                          <Button size="sm" variant="outline"
                            disabled={busy === `${r.course_id}:apple:shots`}
                            onClick={() => enqueueScreenshots(r.course_id, "apple")}>
                            Apple Shots
                          </Button>
                          {r.apple_listing_status === "review_ready" && (
                            <Button size="sm"
                              disabled={busy === `${r.course_id}:apple:approve`}
                              onClick={() => approveListing(r.course_id, "apple")}>
                              <CheckCircle2 className="size-3 mr-1" /> Apple OK
                            </Button>
                          )}
                          <Button size="sm" variant="outline"
                            disabled={busy === `${r.course_id}:google:listing`}
                            onClick={() => generateListing(r.course_id, "google")}>
                            Google Text
                          </Button>
                          <Button size="sm" variant="outline"
                            disabled={busy === `${r.course_id}:google:shots`}
                            onClick={() => enqueueScreenshots(r.course_id, "google")}>
                            Google Shots
                          </Button>
                          {r.google_listing_status === "review_ready" && (
                            <Button size="sm"
                              disabled={busy === `${r.course_id}:google:approve`}
                              onClick={() => approveListing(r.course_id, "google")}>
                              <CheckCircle2 className="size-3 mr-1" /> Google OK
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hinweis: Build &amp; Upload</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Diese Foundation deckt Listing-Texte (inkl. Datenschutz/Support) und Screenshot-Orchestrierung ab.
            Apple/Google-Uploads benötigen Build Secrets in den Workspace-Einstellungen:
          </p>
          <ul className="list-disc pl-5">
            <li><code>GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</code> (Google Play Internal Track Upload)</li>
            <li><code>ASC_API_KEY_P8</code>, <code>ASC_KEY_ID</code>, <code>ASC_ISSUER_ID</code> (TestFlight Upload)</li>
            <li><code>ANDROID_KEYSTORE_BASE64</code>, <code>ANDROID_KEYSTORE_PASSWORD</code> (Signing)</li>
          </ul>
          <p>
            Screenshot-Renderer läuft via <code>.github/workflows/store-screenshots.yml</code> – nimmt den
            jeweils ältesten queued Run aus <code>store_release_screenshot_runs</code> auf.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
