import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, GraduationCap, FileText, BookOpen, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";

type SearchResult = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  url: string;
  score: number;
  match_reason: string;
};

const TYPE_META: Record<string, { label: string; icon: typeof GraduationCap; color: string }> = {
  beruf: { label: "Beruf", icon: GraduationCap, color: "bg-primary/10 text-primary" },
  blog: { label: "Artikel", icon: FileText, color: "bg-accent/10 text-accent-foreground" },
  landing: { label: "Landingpage", icon: FileText, color: "bg-secondary/10 text-secondary-foreground" },
  course: { label: "Kurs", icon: BookOpen, color: "bg-primary/10 text-primary" },
  faq: { label: "FAQ", icon: FileText, color: "bg-muted text-muted-foreground" },
  glossary: { label: "Glossar", icon: FileText, color: "bg-muted text-muted-foreground" },
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const qParam = params.get("q") ?? "";
  const [q, setQ] = useState(qParam);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => setQ(qParam), [qParam]);

  async function runSearch(query: string) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("search-public", {
        body: { q: query.trim(), limit: 20, types: ["beruf", "seo", "course"] },
      });
      if (error) throw error;
      setResults((data?.results ?? []) as SearchResult[]);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (qParam.trim().length >= 2) runSearch(qParam);
    else setResults([]);
  }, [qParam]);

  const empty = useMemo(
    () => !loading && qParam.trim().length >= 2 && results.length === 0,
    [loading, qParam, results]
  );

  function submit() {
    if (q.trim().length >= 2) setParams({ q: q.trim() });
  }

  return (
    <div className="container py-10 max-w-3xl">
      <SEOHead
        title={qParam ? `Suche: ${qParam} | ExamFit` : "Suche | ExamFit"}
        description="Durchsuche alle Berufe, Kurse und Artikel auf ExamFit."
        noindex
      />
      <h1 className="text-3xl font-bold mb-6">Suche</h1>

      <div className="flex gap-2 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='z. B. „Elektriker", „Bankkaufmann", „Bestatter"'
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <Button onClick={submit} disabled={q.trim().length < 2}>
          Suchen
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Suche läuft…
        </div>
      )}

      {empty && (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Keine Treffer für „{qParam}". Probiere Synonyme oder einen Teilbegriff.
        </div>
      )}

      <div className="space-y-3">
        {results.map((r) => {
          const meta = TYPE_META[r.type] ?? TYPE_META.beruf;
          const Icon = meta.icon;
          return (
            <Link
              key={`${r.type}:${r.id}`}
              to={r.url}
              className="block rounded-lg border p-4 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold truncate">{r.title}</span>
                    <Badge variant="outline" className={`text-xs shrink-0 ${meta.color}`}>
                      {meta.label}
                    </Badge>
                  </div>
                  {r.subtitle && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{r.subtitle}</p>
                  )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground/60">
                        {r.match_reason === "fts" ? "Volltexttreffer" : r.match_reason === "fuzzy" ? "Ähnlicher Treffer" : "Schwacher Treffer"}
                      </span>
                      {r.score > 0 && (
                        <span className="text-[10px] text-muted-foreground/40">
                          Relevanz {Math.round(r.score * 100)}%
                        </span>
                      )}
                    </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
