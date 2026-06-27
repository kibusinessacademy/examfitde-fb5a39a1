// MOBILE.COURSE.PACKAGE.OS.1 — Phase A Admin Cockpit
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Download, Smartphone, Apple, Plus, AlertTriangle } from "lucide-react";

interface Manifest {
  course_id: string;
  bundle_id: string;
  app_name: string;
  short_name: string;
  version_name: string;
  version_code: number;
  primary_color: string;
  ios_iap_product_id: string | null;
  android_iap_product_id: string | null;
  iap_price_tier: string | null;
  last_built_at: string | null;
  last_build_status: string | null;
  last_build_output_url: string | null;
  last_build_error: string | null;
}

interface Course {
  id: string;
  title: string;
  slug: string;
  status: string;
  manifest?: Manifest | null;
}

export default function MobileBundleBuilderPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Course | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: cs } = await supabase
      .from("courses")
      .select("id, title, slug, status")
      .eq("status", "published")
      .order("title");
    const { data: ms } = await supabase
      .from("mobile_course_app_manifest")
      .select("*");
    const byId = new Map((ms || []).map((m: any) => [m.course_id, m as Manifest]));
    setCourses((cs || []).map((c: any) => ({ ...c, manifest: byId.get(c.id) || null })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleBuild = async (courseId: string) => {
    setBuildingId(courseId);
    try {
      const { data, error } = await supabase.functions.invoke("mobile-course-package-build", {
        body: { course_id: courseId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Mobile Bundle gebaut", {
        description: `${(data.fileSize / 1024).toFixed(0)} KB · v${data.version}`,
        action: { label: "Download", onClick: () => window.open(data.downloadUrl, "_blank") },
      });
      if (data?.contains?.content_export_warning) {
        toast.warning(data.contains.content_export_warning);
      }
      await load();
    } catch (e: any) {
      toast.error(`Build fehlgeschlagen: ${e.message}`);
    } finally {
      setBuildingId(null);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Smartphone className="w-8 h-8" /> Mobile Bundle Builder
          </h1>
          <p className="text-muted-foreground mt-2">
            Per-Kurs Capacitor-Source-Bundles für Google Play (.aab) & Apple App Store (iOS Archive).
            Finale Signierung & Upload läuft via GitHub Actions oder lokal (Mac + Xcode/Android Studio).
          </p>
        </div>
      </div>

      <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
        <CardContent className="pt-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Phase A · Foundation.</strong> Bundle enthält Capacitor-Config, CI-Workflows, Store-Metadaten,
            Lizenz/Copyright und IAP-Stubs. Kursinhalt wird zur Build-Zeit aus Lovable Cloud Storage
            geladen (SSOT — keine Duplikation). IAP-Receipt-Validation = Phase B.
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid gap-4">
          {courses.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{c.title}</CardTitle>
                    <CardDescription className="font-mono text-xs mt-1">{c.slug}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.manifest?.last_build_status && (
                      <Badge variant={c.manifest.last_build_status === "ready" ? "default" : c.manifest.last_build_status === "failed" ? "destructive" : "secondary"}>
                        {c.manifest.last_build_status}
                      </Badge>
                    )}
                    {!c.manifest && <Badge variant="outline">kein Manifest</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {c.manifest ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div><span className="text-muted-foreground">Bundle ID:</span><div className="font-mono text-xs">{c.manifest.bundle_id}</div></div>
                      <div><span className="text-muted-foreground">App:</span><div>{c.manifest.app_name}</div></div>
                      <div><span className="text-muted-foreground">Version:</span><div>{c.manifest.version_name} ({c.manifest.version_code})</div></div>
                      <div><span className="text-muted-foreground">IAP:</span><div className="flex gap-1"><Apple className="w-3 h-3" />{c.manifest.ios_iap_product_id ? "✓" : "—"} / <Smartphone className="w-3 h-3" />{c.manifest.android_iap_product_id ? "✓" : "—"}</div></div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" onClick={() => handleBuild(c.id)} disabled={buildingId === c.id}>
                        {buildingId === c.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                        Bundle bauen
                      </Button>
                      {c.manifest.last_build_output_url && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={c.manifest.last_build_output_url} target="_blank" rel="noreferrer">
                            <Download className="w-4 h-4 mr-2" /> Letzten Build laden
                          </a>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Bearbeiten</Button>
                    </div>
                    {c.manifest.last_build_error && (
                      <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{c.manifest.last_build_error}</div>
                    )}
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    <Plus className="w-4 h-4 mr-2" /> Manifest anlegen
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {courses.length === 0 && <p className="text-center text-muted-foreground py-8">Keine aktiven, öffentlichen Kurse gefunden.</p>}
        </div>
      )}

      <ManifestDialog course={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

function ManifestDialog({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<Manifest>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (course?.manifest) setForm(course.manifest);
    else if (course) {
      const slug = course.slug.replace(/[^a-z0-9]/g, "").slice(0, 20);
      setForm({
        bundle_id: `com.berufos.${slug || "kurs"}`,
        app_name: course.title.slice(0, 30),
        short_name: course.title.split(" ")[0].slice(0, 12),
        version_name: "1.0.0",
        version_code: 1,
        primary_color: "#0F3D3E",
      });
    }
  }, [course]);

  const save = async () => {
    if (!course) return;
    setSaving(true);
    const { error } = await supabase.from("mobile_course_app_manifest").upsert({
      course_id: course.id,
      bundle_id: form.bundle_id!,
      app_name: form.app_name!,
      short_name: form.short_name!,
      version_name: form.version_name || "1.0.0",
      version_code: form.version_code || 1,
      primary_color: form.primary_color || "#0F3D3E",
      ios_iap_product_id: form.ios_iap_product_id || null,
      android_iap_product_id: form.android_iap_product_id || null,
      iap_price_tier: form.iap_price_tier || null,
    }, { onConflict: "course_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Manifest gespeichert");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={!!course} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Mobile Manifest · {course?.title}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2">
            <Label>Bundle ID (Reverse-DNS, eindeutig im Store)</Label>
            <Input value={form.bundle_id || ""} onChange={(e) => setForm({ ...form, bundle_id: e.target.value })} placeholder="com.berufos.kursname" className="font-mono" />
          </div>
          <div>
            <Label>App-Name (max 30)</Label>
            <Input value={form.app_name || ""} onChange={(e) => setForm({ ...form, app_name: e.target.value })} maxLength={30} />
          </div>
          <div>
            <Label>Kurzname (max 12)</Label>
            <Input value={form.short_name || ""} onChange={(e) => setForm({ ...form, short_name: e.target.value })} maxLength={12} />
          </div>
          <div>
            <Label>Version (SemVer)</Label>
            <Input value={form.version_name || ""} onChange={(e) => setForm({ ...form, version_name: e.target.value })} />
          </div>
          <div>
            <Label>Version Code (Integer ↑)</Label>
            <Input type="number" value={form.version_code || 1} onChange={(e) => setForm({ ...form, version_code: parseInt(e.target.value) || 1 })} />
          </div>
          <div>
            <Label>Markenfarbe (Hex)</Label>
            <Input value={form.primary_color || ""} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} placeholder="#0F3D3E" />
          </div>
          <div>
            <Label>IAP-Preis-Tier</Label>
            <Input value={form.iap_price_tier || ""} onChange={(e) => setForm({ ...form, iap_price_tier: e.target.value })} placeholder="tier_24_90_eur" />
          </div>
          <div>
            <Label>Apple IAP Product ID</Label>
            <Input value={form.ios_iap_product_id || ""} onChange={(e) => setForm({ ...form, ios_iap_product_id: e.target.value })} placeholder="com.berufos.kurs.lifetime" />
          </div>
          <div>
            <Label>Google IAP Product ID</Label>
            <Input value={form.android_iap_product_id || ""} onChange={(e) => setForm({ ...form, android_iap_product_id: e.target.value })} placeholder="kurs_lifetime_2490" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save} disabled={saving || !form.bundle_id || !form.app_name}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Speichern
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
