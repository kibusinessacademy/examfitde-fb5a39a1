import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { findChecklist } from "@/lib/authority/checklists";
import { findTopic } from "@/lib/authority/catalog";
import NotFound from "@/pages/NotFound";

export default function AuthorityChecklistPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = slug ? findChecklist(slug) : undefined;
  const topic = doc ? findTopic(doc.topicSlug) : undefined;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const progress = useMemo(() => {
    if (!doc) return 0;
    const done = Object.values(checked).filter(Boolean).length;
    return Math.round((done / doc.items.length) * 100);
  }, [checked, doc]);

  if (!doc || !topic) return <NotFound />;

  const exportTxt = () => {
    const body = [
      doc.title,
      "=".repeat(doc.title.length),
      "",
      `Rechtsgrundlage: ${doc.source}`,
      "",
      ...doc.items.map((it, i) => `[${checked[it.id] ? "x" : " "}] ${i + 1}. ${it.label}${it.detail ? `\n      ${it.detail}` : ""}${it.legal ? `\n      (${it.legal})` : ""}`),
      "",
      "Quelle: berufos.com/authority/checkliste/" + doc.slug,
    ].join("\n");
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkliste-${doc.slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: doc.title,
    description: doc.metaDescription,
    step: doc.items.map((it, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: it.label,
      text: it.detail ?? it.label,
    })),
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{doc.title} · BerufOS Authority</title>
        <meta name="description" content={doc.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/authority/checkliste/${doc.slug}`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <section className="mx-auto max-w-3xl px-6 pt-10 pb-6 print:pt-4">
        <Link
          to={`/authority/${topic.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 print:hidden"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {topic.title}
        </Link>
        <Badge variant="outline" className="mt-3">{doc.source}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">{doc.intro}</p>

        <div className="mt-5 flex items-center gap-3 print:hidden">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Drucken
          </Button>
          <Button size="sm" variant="outline" onClick={exportTxt}>
            <Download className="h-4 w-4 mr-1.5" /> Exportieren
          </Button>
          <div className="flex-1">
            <Progress value={progress} className="h-2" />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{progress}%</span>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-12">
        <Card>
          <CardContent className="p-5 space-y-3">
            {doc.items.map((it, i) => (
              <label
                key={it.id}
                className="flex items-start gap-3 p-2 rounded hover:bg-muted/40 transition cursor-pointer"
              >
                <Checkbox
                  checked={!!checked[it.id]}
                  onCheckedChange={(v) => setChecked((p) => ({ ...p, [it.id]: !!v }))}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium leading-snug">
                    <span className="text-muted-foreground mr-2 font-mono text-sm">{i + 1}.</span>
                    {it.label}
                  </div>
                  {it.detail && <div className="text-sm text-muted-foreground mt-0.5">{it.detail}</div>}
                  {it.legal && <div className="text-xs text-muted-foreground mt-1 font-mono">{it.legal}</div>}
                </div>
              </label>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
