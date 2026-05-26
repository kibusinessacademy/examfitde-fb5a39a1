/**
 * /admin/products/registry
 * Admin UI für marketing_product_pages (SSOT Welle 2).
 * Liste + Inline-Editor mit JSON-Feldern für USPs / FAQs / Persona-CTAs.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface Row {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  hero_kicker: string | null;
  hero_headline: string;
  hero_subline: string | null;
  product_intro: string | null;
  usps: unknown;
  faqs: unknown;
  trust_items: unknown;
  changelog: unknown;
  cta_primary_label: string | null;
  cta_primary_url: string | null;
  cta_secondary_label: string | null;
  cta_secondary_url: string | null;
  persona_cta_map: unknown;
  seo_title: string | null;
  seo_description: string | null;
  seo_canonical: string | null;
  seo_og_image: string | null;
  updated_at: string;
  published_at: string | null;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch {
    return "[]";
  }
}

export default function MarketingProductPagesAdminPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Row> | null>(null);
  const [uspsText, setUspsText] = useState("");
  const [faqsText, setFaqsText] = useState("");
  const [personaText, setPersonaText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-marketing-product-pages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_product_pages" as any)
        .select("*")
        .order("slug");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  // auto-select first
  useEffect(() => {
    if (!selectedId && rows?.length) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = useMemo(
    () => rows?.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setDraft({ ...selected });
    setUspsText(pretty(selected.usps));
    setFaqsText(pretty(selected.faqs));
    setPersonaText(pretty(selected.persona_cta_map));
  }, [selected]);

  async function handleSave() {
    if (!draft || !selectedId) return;
    setSaving(true);
    try {
      const usps = JSON.parse(uspsText || "[]");
      const faqs = JSON.parse(faqsText || "[]");
      const persona_cta_map = JSON.parse(personaText || "{}");

      const patch: Record<string, unknown> = {
        status: draft.status,
        hero_kicker: draft.hero_kicker,
        hero_headline: draft.hero_headline,
        hero_subline: draft.hero_subline,
        product_intro: draft.product_intro,
        cta_primary_label: draft.cta_primary_label,
        cta_primary_url: draft.cta_primary_url,
        cta_secondary_label: draft.cta_secondary_label,
        cta_secondary_url: draft.cta_secondary_url,
        seo_title: draft.seo_title,
        seo_description: draft.seo_description,
        seo_canonical: draft.seo_canonical,
        seo_og_image: draft.seo_og_image,
        usps,
        faqs,
        persona_cta_map,
        published_at:
          draft.status === "published" && !selected?.published_at
            ? new Date().toISOString()
            : selected?.published_at,
      };

      const { error } = await supabase
        .from("marketing_product_pages" as any)
        .update(patch as any)
        .eq("id", selectedId);
      if (error) throw error;

      toast.success("Gespeichert");
      await qc.invalidateQueries({ queryKey: ["admin-marketing-product-pages"] });
      await qc.invalidateQueries({ queryKey: ["marketing_product_page"] });
    } catch (e: any) {
      toast.error(`Speichern fehlgeschlagen: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Product Pages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            SSOT-Registry für <code>/produkte/:slug</code>. Änderungen sind sofort live.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-marketing-product-pages"] })}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Reload
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* List */}
        <Card className="col-span-12 md:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Produktseiten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {rows?.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                  r.id === selectedId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.slug}</span>
                  <Badge variant={r.status === "published" ? "default" : "secondary"}>
                    {r.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {r.hero_headline}
                </div>
              </button>
            ))}
            {!isLoading && !rows?.length && (
              <p className="text-xs text-muted-foreground">Keine Einträge.</p>
            )}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className="col-span-12 md:col-span-8">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {selected ? `Bearbeite: ${selected.slug}` : "Auswählen…"}
            </CardTitle>
            {selected && (
              <a
                href={`/produkte/${selected.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                Live ansehen <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!draft && <p className="text-sm text-muted-foreground">Bitte links eine Produktseite wählen.</p>}
            {draft && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft((d) => ({ ...(d ?? {}), status: e.target.value as Row["status"] }))
                      }
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="draft">draft</option>
                      <option value="published">published</option>
                      <option value="archived">archived</option>
                    </select>
                  </div>
                  <div>
                    <Label>Hero Kicker</Label>
                    <Input
                      value={draft.hero_kicker ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), hero_kicker: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <Label>Hero Headline *</Label>
                  <Textarea
                    rows={2}
                    value={draft.hero_headline ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...(d ?? {}), hero_headline: e.target.value }))}
                  />
                </div>

                <div>
                  <Label>Hero Subline</Label>
                  <Textarea
                    rows={3}
                    value={draft.hero_subline ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...(d ?? {}), hero_subline: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>CTA Primary Label</Label>
                    <Input
                      value={draft.cta_primary_label ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), cta_primary_label: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>CTA Primary URL</Label>
                    <Input
                      value={draft.cta_primary_url ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), cta_primary_url: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <Label>USPs (JSON Array: {`{title, body}`})</Label>
                  <Textarea
                    rows={8}
                    value={uspsText}
                    onChange={(e) => setUspsText(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>

                <div>
                  <Label>FAQs (JSON Array: {`{question, answer}`})</Label>
                  <Textarea
                    rows={8}
                    value={faqsText}
                    onChange={(e) => setFaqsText(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>

                <div>
                  <Label>Persona-CTA-Map (JSON Object: persona → {`{label, href}`})</Label>
                  <Textarea
                    rows={6}
                    value={personaText}
                    onChange={(e) => setPersonaText(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SEO</div>
                  <div>
                    <Label>SEO Title</Label>
                    <Input
                      value={draft.seo_title ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), seo_title: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>SEO Description</Label>
                    <Textarea
                      rows={2}
                      value={draft.seo_description ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), seo_description: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Canonical URL</Label>
                    <Input
                      value={draft.seo_canonical ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...(d ?? {}), seo_canonical: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Speichern
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
