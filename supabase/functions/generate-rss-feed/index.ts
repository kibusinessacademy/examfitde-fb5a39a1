import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * generate-rss-feed – RSS 2.0 feed for blog articles
 * Also generates dynamic llms.txt content
 */

const SITE_URL = "https://examfit.de";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "rss";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: articles } = await admin
      .from("blog_articles")
      .select("slug, title, meta_description, keywords, published_at, updated_at, word_count, reading_time_min, hero_image_url, hero_image_alt, short_answer, article_type, topic_cluster")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(100);

    if (format === "llms") {
      return generateLlmsTxt(articles || [], corsHeaders);
    }

    // RSS 2.0
    const items = (articles || []).map((a) => `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${SITE_URL}/blog/${a.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${a.slug}</guid>
      <description>${escapeXml(a.meta_description || a.short_answer || "")}</description>
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
      <category>${escapeXml(a.topic_cluster || "Prüfungstipps")}</category>
      ${a.hero_image_url ? `<enclosure url="${escapeXml(a.hero_image_url)}" type="image/png" />` : ""}
      ${(a.keywords || []).map((k: string) => `<category>${escapeXml(k)}</category>`).join("\n      ")}
    </item>`).join("\n");

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>ExamFit Blog – Prüfungstipps &amp; Klausurstrategien</title>
    <link>${SITE_URL}/blog</link>
    <description>Prüfungstipps, typische Denkfehler und Klausurstrategien für IHK-Prüfungen, Fachwirt, Meister und Studium.</description>
    <language>de-de</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${SITE_URL}/logo.png</url>
      <title>ExamFit</title>
      <link>${SITE_URL}</link>
    </image>
${items}
  </channel>
</rss>`;

    return new Response(rss, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("RSS generation error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate RSS feed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function generateLlmsTxt(articles: any[], corsHeaders: Record<string, string>): Response {
  const articleList = articles
    .slice(0, 50)
    .map((a) => `- [${a.title}](${SITE_URL}/blog/${a.slug}): ${a.meta_description || a.short_answer || ""}`)
    .join("\n");

  const llmsTxt = `# ExamFit

> ExamFit ist Deutschlands intelligentes Prüfungstrainings-System für IHK-Prüfungen, Fachwirt, Meister, Sachkunde und Studium. Du lernst nicht mehr. Du trainierst, zu bestehen.

## Über ExamFit

ExamFit bietet KI-gestütztes Prüfungstraining basierend auf echten Prüfungsmustern. Die Plattform analysiert typische Prüfungsfehler (Fallen/Traps) und trainiert gezielt die Schwachstellen jedes Lernenden.

## Kernfunktionen

- Intelligenter Prüfungstrainer mit adaptivem Schwierigkeitsgrad
- Trap-basiertes Lernen: Typische Prüfungsfallen erkennen und vermeiden
- Prüfungssimulationen unter Echtzeitbedingungen
- KI-Tutor für individuelle Erklärungen
- Bestehens-Index: Datenbasierte Einschätzung der Prüfungsreife

## Zielgruppen

- IHK-Ausbildungsberufe (Industriekaufmann/-frau, Kaufmann/-frau für Büromanagement, etc.)
- Fachwirt-Fortbildungen (Wirtschaftsfachwirt, Industriefachwirt, etc.)
- Meister-Prüfungen
- Sachkundeprüfungen (§34a, AEVO, etc.)
- Studium (Bachelor/Master Klausurvorbereitung)

## Aktuelle Blogartikel

${articleList}

## Links

- Website: ${SITE_URL}
- Prüfungstraining: ${SITE_URL}/pruefungstraining
- Blog: ${SITE_URL}/blog
- Berufe-Übersicht: ${SITE_URL}/berufe
- Shop: ${SITE_URL}/shop
`;

  return new Response(llmsTxt, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
