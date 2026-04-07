import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { detectGenericContent, resolveGenericSeverity } from "../_shared/generic-content-detector.ts";

/**
 * generate-blog-article v2 – AI-Search-Optimized Content Factory
 *
 * Multi-step pipeline:
 * 1. Pick source (exam question / curriculum / trap)
 * 2. Determine article_type (definition, mistake, example, comparison, faq, strategy)
 * 3. Generate outline → then content per section (humanized)
 * 4. Generate answer_blocks (short_answer, definition, example, mistake, faq)
 * 5. Extract entity_data
 * 6. Run AI detection quality gate
 * 7. Generate hero image + alt text
 * 8. Build internal links with semantic reasoning
 * 9. Save as draft with quality signals
 * 10. IndexNow ping
 */

const GARBAGE_STRINGS = ["undefined", "null", "none", "n/a", "placeholder", "todo", "tbd"];
const SITE_URL = "https://examfit.de";

const ARTICLE_TYPES = ["definition", "mistake", "example", "comparison", "faq", "strategy"] as const;

// ── Validation ──

function validateArticle(article: any): { valid: boolean; reason?: string } {
  if (!article) return { valid: false, reason: "No article returned" };

  const checks: Array<{ field: string; minLen: number }> = [
    { field: "title", minLen: 20 },
    { field: "content_md", minLen: 500 },
    { field: "meta_description", minLen: 50 },
    { field: "excerpt", minLen: 30 },
    { field: "hero_image_alt", minLen: 10 },
    { field: "short_answer", minLen: 30 },
    { field: "primary_question", minLen: 10 },
  ];

  for (const { field, minLen } of checks) {
    const val = article[field];
    if (!val || val.length < minLen) {
      return { valid: false, reason: `${field} too short or missing (min ${minLen}, got ${val?.length || 0})` };
    }
  }

  for (const field of ["title", "content_md", "meta_description", "short_answer"]) {
    const val = (article[field] || "").trim().toLowerCase();
    if (GARBAGE_STRINGS.includes(val)) {
      return { valid: false, reason: `'${field}' contains garbage: ${val}` };
    }
  }

  if (!Array.isArray(article.keywords) || article.keywords.length < 3) {
    return { valid: false, reason: "keywords must have at least 3 entries" };
  }
  if (!Array.isArray(article.faq) || article.faq.length < 3) {
    return { valid: false, reason: "faq must have at least 3 Q&A pairs" };
  }
  if (!article.answer_blocks?.definition_block) {
    return { valid: false, reason: "answer_blocks.definition_block required" };
  }

  return { valid: true };
}

// ── Internal Link Builder (semantic) ──

async function buildInternalLinks(
  admin: any,
  contentMd: string,
  curriculumId: string | null,
  berufId: string | null,
  currentSlug: string,
  entityData: any,
): Promise<{ content: string; links: Array<{ anchor: string; url: string; reason: string; type: string }> }> {
  const links: Array<{ anchor: string; url: string; reason: string; type: string }> = [];
  let content = contentMd;

  // 1. Related blog articles by entity/topic
  const { data: relatedArticles } = await admin
    .from("blog_articles")
    .select("slug, title, article_type, topic_cluster")
    .eq("status", "published")
    .neq("slug", currentSlug)
    .limit(20);

  if (relatedArticles?.length) {
    // Prioritize by article_type diversity
    const typeMap: Record<string, any[]> = {};
    for (const a of relatedArticles) {
      const t = a.article_type || "general";
      if (!typeMap[t]) typeMap[t] = [];
      typeMap[t].push(a);
    }

    // Link to different types: definition → mistake, mistake → example, etc.
    const linkTargets: any[] = [];
    for (const type of ["definition", "mistake", "example", "comparison", "strategy"]) {
      if (typeMap[type]?.length) {
        linkTargets.push(typeMap[type][0]);
        if (linkTargets.length >= 3) break;
      }
    }
    // Fill remaining from any type
    if (linkTargets.length < 3) {
      for (const a of relatedArticles) {
        if (!linkTargets.find(l => l.slug === a.slug)) {
          linkTargets.push(a);
          if (linkTargets.length >= 3) break;
        }
      }
    }

    for (const rel of linkTargets) {
      const linkUrl = `/blog/${rel.slug}`;
      if (!content.includes(linkUrl)) {
        links.push({ anchor: rel.title, url: linkUrl, reason: `related_${rel.article_type}`, type: "blog" });
      }
    }
  }

  // 2. Link to SEO documents
  if (berufId || curriculumId) {
    let query = admin.from("seo_documents")
      .select("slug, title, doc_type")
      .eq("status", "published")
      .limit(5);
    if (berufId) query = query.eq("beruf_id", berufId);
    else if (curriculumId) query = query.eq("curriculum_id", curriculumId);

    const { data: seoDocs } = await query;
    const docTypeUrlMap: Record<string, string> = {
      blog: "/wissen", landing: "/pruefungstraining", faq: "/faq", glossary: "/glossar", cluster: "/wissen",
    };
    if (seoDocs) {
      for (const doc of seoDocs.slice(0, 2)) {
        const base = docTypeUrlMap[doc.doc_type] || "/wissen";
        const linkUrl = `${base}/${doc.slug}`;
        if (!content.includes(linkUrl)) {
          links.push({ anchor: doc.title, url: linkUrl, reason: "seo_document", type: doc.doc_type });
        }
      }
    }
  }

  // 3. Link to Beruf page
  if (berufId) {
    const { data: beruf } = await admin.from("berufe").select("bezeichnung_kurz").eq("id", berufId).single();
    if (beruf) {
      const berufSlug = generateSlug(beruf.bezeichnung_kurz);
      const berufUrl = `/berufe/${berufSlug}`;
      if (!content.includes(berufUrl)) {
        const regex = new RegExp(`(?<!\\[)${escapeRegex(beruf.bezeichnung_kurz)}(?!\\])(?!\\()`, "i");
        if (regex.test(content)) {
          content = content.replace(regex, `[${beruf.bezeichnung_kurz}](${berufUrl})`);
          links.push({ anchor: beruf.bezeichnung_kurz, url: berufUrl, reason: "beruf_page", type: "beruf" });
        }
      }
    }
  }

  // 4. Link to related concepts from entity_data
  if (entityData?.related_concepts?.length) {
    for (const concept of entityData.related_concepts.slice(0, 2)) {
      const conceptSlug = generateSlug(concept);
      const { data: conceptArticle } = await admin
        .from("blog_articles")
        .select("slug, title")
        .eq("status", "published")
        .ilike("title", `%${concept}%`)
        .neq("slug", currentSlug)
        .limit(1)
        .maybeSingle();
      if (conceptArticle && !content.includes(`/blog/${conceptArticle.slug}`)) {
        links.push({ anchor: conceptArticle.title, url: `/blog/${conceptArticle.slug}`, reason: "related_concept", type: "concept" });
      }
    }
  }

  // 5. Weiterlesen section
  const blogLinks = links.filter(l => l.url.startsWith("/blog/") || l.url.startsWith("/wissen/")).slice(0, 3);
  if (blogLinks.length > 0) {
    content += `\n\n## Weiterlesen\n\n${blogLinks.map(l => `- [${l.anchor}](${l.url})`).join("\n")}`;
  }

  // 6. CTA
  if (!content.includes("/pruefungstraining")) {
    content += `\n\n---\n\n**Bereit für die Prüfung?** [Starte jetzt dein Prüfungstraining](/pruefungstraining) und bereite dich systematisch vor.`;
    links.push({ anchor: "Prüfungstraining", url: "/pruefungstraining", reason: "conversion_cta", type: "cta" });
  }

  return { content, links };
}

// ── Main Handler ──

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { curriculum_id, source_question_id, topic, topic_cluster, article_type, mode = "single", batch_size = 5 } = body;

    if (mode === "single" && !curriculum_id && !source_question_id && !topic) {
      return new Response(JSON.stringify({ error: "curriculum_id, source_question_id, or topic required" }), { status: 400, headers });
    }

    // ── Determine sources ──
    interface ArticleSource {
      curriculum_id: string | null;
      source_question_id: string | null;
      source_package_id: string | null;
      beruf_id: string | null;
      competency_id: string | null;
      topic: string;
      topic_cluster: string;
      article_type: string;
      context: Record<string, unknown>;
    }

    const sources: ArticleSource[] = [];

    if (mode === "batch") {
      const { data: packages } = await admin
        .from("course_packages")
        .select("id, curriculum_id, status")
        .eq("status", "published")
        .not("curriculum_id", "is", null)
        .limit(50);

      if (packages) {
        const currIds = [...new Set(packages.map((p: any) => p.curriculum_id))];
        for (const cid of currIds.slice(0, batch_size)) {
          const { count } = await admin.from("blog_articles").select("id", { count: "exact", head: true }).eq("source_curriculum_id", cid);
          if ((count || 0) < 10) {
            const { data: question } = await admin
              .from("exam_questions")
              .select("id, question_text, trap_tags, difficulty, cognitive_level, competency_id")
              .eq("curriculum_id", cid)
              .in("question_type", ["multiple_choice", "single_choice"])
              .not("trap_tags", "is", null)
              .order("difficulty", { ascending: false })
              .limit(1)
              .single();

            const { data: curriculum } = await admin.from("curricula").select("id, title, description").eq("id", cid).single();

            if (curriculum) {
              // Determine article type based on existing coverage
              const { data: existingTypes } = await admin
                .from("blog_articles")
                .select("article_type")
                .eq("source_curriculum_id", cid)
                .eq("status", "published");
              const coveredTypes = new Set((existingTypes || []).map((e: any) => e.article_type));
              const nextType = ARTICLE_TYPES.find(t => !coveredTypes.has(t)) || "strategy";

              const pkg = packages.find((p: any) => p.curriculum_id === cid);
              sources.push({
                curriculum_id: cid,
                source_question_id: question?.id || null,
                source_package_id: pkg?.id || null,
                beruf_id: null,
                competency_id: question?.competency_id || null,
                topic: question
                  ? `Typischer Prüfungsfehler: ${(question.trap_tags || [])[0] || question.question_text.substring(0, 50)}`
                  : `Prüfungsvorbereitung ${curriculum.title}`,
                topic_cluster: topic_cluster || "pruefungstipps",
                article_type: nextType,
                context: { curriculum, question },
              });
            }
          }
        }
      }
    } else {
      let context: Record<string, unknown> = {};
      let sourceTopic = topic || "";
      let berufId: string | null = null;
      let competencyId: string | null = null;
      let srcQuestionId = source_question_id || null;
      let srcPackageId: string | null = null;

      if (curriculum_id) {
        const { data: curriculum } = await admin.from("curricula").select("id, title, description").eq("id", curriculum_id).single();
        context.curriculum = curriculum;
        if (!sourceTopic && curriculum) sourceTopic = `Prüfungsvorbereitung ${curriculum.title}`;
        const { data: pkg } = await admin.from("course_packages").select("id").eq("curriculum_id", curriculum_id).eq("status", "published").limit(1).maybeSingle();
        srcPackageId = pkg?.id || null;
      }
      if (source_question_id) {
        const { data: question } = await admin
          .from("exam_questions")
          .select("id, question_text, options, correct_answer, explanation, difficulty, trap_tags, cognitive_level, curriculum_id, competency_id")
          .eq("id", source_question_id).single();
        context.question = question;
        if (question) {
          competencyId = question.competency_id;
          if (!sourceTopic) sourceTopic = `Prüfungsfehler: ${(question.trap_tags || [])[0] || question.question_text.substring(0, 60)}`;
        }
      }

      sources.push({
        curriculum_id: curriculum_id || null,
        source_question_id: srcQuestionId,
        source_package_id: srcPackageId,
        beruf_id: berufId,
        competency_id: competencyId,
        topic: sourceTopic,
        topic_cluster: topic_cluster || "pruefungstipps",
        article_type: article_type || "mistake",
        context,
      });
    }

    if (sources.length === 0) {
      return new Response(JSON.stringify({ message: "No sources found" }), { status: 200, headers });
    }

    // ── Generate articles ──
    const results: any[] = [];

    for (const source of sources) {
      try {
        const article = await generateArticle(lovableKey, source);
        if (!article) { results.push({ topic: source.topic, error: "Generation failed" }); continue; }

        // ── Validate ──
        const validation = validateArticle(article);
        if (!validation.valid) {
          results.push({ topic: source.topic, error: `Validation: ${validation.reason}`, status: "failed_validation" });
          continue;
        }

        // ── AI Detection ──
        const detectionResult = detectGenericContent(article.content_md, 2);
        const severity = resolveGenericSeverity({
          genericPhraseCount: detectionResult.genericPhraseCount,
          spellingErrorCount: detectionResult.spellingErrors.length,
          genericRatio: detectionResult.genericRatio,
          artifactType: "blog_article",
        });
        const aiDetectionScore = detectionResult.ok ? 100 : Math.max(0, 100 - (detectionResult.genericPhraseCount * 10) - (detectionResult.spellingErrors.length * 15));

        if (severity === "critical" || severity === "error") {
          results.push({ topic: source.topic, status: "failed_ai_detection", ai_score: aiDetectionScore });
          continue;
        }

        // ── Slug + dedup ──
        const slug = generateSlug(article.title);
        const { data: existingSlug } = await admin.from("blog_articles").select("id").eq("slug", slug).limit(1);
        if (existingSlug?.length) { results.push({ topic: source.topic, error: `Slug exists: ${slug}`, status: "duplicate" }); continue; }

        const contentHash = await computeHash(article.content_md);
        const { data: existingHash } = await admin.from("blog_articles").select("id").eq("content_hash", contentHash).limit(1);
        if (existingHash?.length) { results.push({ topic: source.topic, status: "duplicate" }); continue; }

        // ── Hero Image ──
        let heroImageUrl: string | null = null;
        try {
          const imageResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-image-preview",
              messages: [{ role: "user", content: `Create a professional, clean blog hero image for an educational article about: ${article.hero_image_prompt}. Style: modern, minimal, professional. Colors: blue and white tones. No text in the image. 16:9 aspect ratio.` }],
              modalities: ["image", "text"],
            }),
          });
          if (imageResp.ok) {
            const imageData = await imageResp.json();
            const imageBase64 = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
            if (imageBase64?.startsWith("data:image/")) {
              const base64Data = imageBase64.split(",")[1];
              const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              const { error: uploadErr } = await admin.storage.from("public-assets").upload(`blog-heroes/${slug}.png`, imageBytes, { contentType: "image/png", upsert: true });
              if (!uploadErr) {
                const { data: urlData } = admin.storage.from("public-assets").getPublicUrl(`blog-heroes/${slug}.png`);
                heroImageUrl = urlData?.publicUrl || null;
              }
            }
          }
        } catch { /* non-blocking */ }

        // ── Internal Links ──
        const { content: linkedContent, links: internalLinks } = await buildInternalLinks(
          admin, article.content_md, source.curriculum_id, source.beruf_id, slug, article.entity_data,
        );

        const words = linkedContent.split(/\s+/).filter(Boolean).length;
        const readingTime = Math.ceil(words / 200);

        // Quality signals
        const qualitySignals = {
          content_depth: Math.min(100, Math.round(words / 20)),
          snippet_readiness: article.short_answer?.length >= 50 ? 100 : 50,
          entity_clarity: article.entity_data?.concepts?.length >= 2 ? 100 : 50,
          faq_coverage: Math.min(100, (article.faq?.length || 0) * 20),
          ai_detection_score: aiDetectionScore,
          internal_link_count: internalLinks.length,
        };

        const status = aiDetectionScore >= 80 && validation.valid ? "draft" : "failed_generation";

        const { data: inserted, error: insertErr } = await admin
          .from("blog_articles")
          .insert({
            slug,
            title: article.title,
            meta_description: article.meta_description,
            content_md: linkedContent,
            keywords: article.keywords,
            target_keyword: article.target_keyword,
            topic_cluster: source.topic_cluster,
            article_type: source.article_type,
            primary_question: article.primary_question,
            short_answer: article.short_answer,
            answer_blocks: article.answer_blocks,
            entity_data: article.entity_data,
            content_quality_signals: qualitySignals,
            hero_image_url: heroImageUrl,
            hero_image_alt: article.hero_image_alt,
            og_image_url: heroImageUrl,
            faq_json: article.faq,
            internal_links_json: internalLinks,
            internal_link_plan: internalLinks.map(l => ({ ...l, priority: l.type === "cta" ? 10 : 5 })),
            ai_detection_score: aiDetectionScore,
            ai_detection_report: { generic_phrases: detectionResult.genericPhrases, spelling_errors: detectionResult.spellingErrors, severity },
            content_hash: contentHash,
            canonical_url: `${SITE_URL}/blog/${slug}`,
            word_count: words,
            reading_time_min: readingTime,
            source_curriculum_id: source.curriculum_id,
            source_package_id: source.source_package_id,
            source_question_id: source.source_question_id,
            beruf_id: source.beruf_id,
            competency_id: source.competency_id,
            generated_by_model: "google/gemini-2.5-flash",
            speakable_selectors: [".short-answer", "h1", ".definition-block"],
            status,
          } as any)
          .select("id, slug")
          .single();

        if (insertErr) { results.push({ topic: source.topic, error: insertErr.message }); continue; }

        pingIndexNow(`${SITE_URL}/blog/${slug}`).catch(() => {});

        results.push({
          topic: source.topic, status: "created", article_id: inserted.id, slug,
          word_count: words, ai_detection_score: aiDetectionScore,
          has_hero_image: !!heroImageUrl, internal_links: internalLinks.length,
          article_type: source.article_type, quality_signals: qualitySignals,
        });
      } catch (innerErr) {
        results.push({ topic: source.topic, error: innerErr instanceof Error ? innerErr.message : "Unknown" });
      }

      if (sources.length > 1) await new Promise(r => setTimeout(r, 3000));
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (error) {
    console.error("[generate-blog-article] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers });
  }
});

// ── Article Generation (answer-first structure) ──

async function generateArticle(lovableKey: string, source: any): Promise<any> {
  const curriculum = source.context.curriculum as any;
  const question = source.context.question as any;

  const systemPrompt = `Du bist ein erfahrener Fach-Redakteur für berufliche Prüfungsvorbereitung bei ExamFit.
Dein Stil:
- Direkt, klar, praxisnah – kein akademischer Duktus
- Kurze Sätze wechseln mit längeren ab (natürliche Satzlängenvariation)
- KEINE generischen Phrasen: "in diesem Zusammenhang", "es ist wichtig zu beachten", "zusammenfassend lässt sich sagen", "spielt eine wichtige Rolle", "nicht zu unterschätzen", "darüber hinaus", "in der heutigen Zeit"
- Du schreibst wie ein Praktiker, der das Thema beherrscht
- Meinungen, Praxisbeispiele, rhetorische Fragen sind erwünscht
- Vermeide Passivkonstruktionen
- Baue 1-2 konkrete Szenarien ein
- Der Artikel MUSS maschinenlesbar, zitierfähig und snippet-ready sein

ARTIKELSTRUKTUR (PFLICHT):
1. H1 mit Suchintention (= primary_question umformuliert)
2. Kurzantwort (2-4 Sätze, direkt unter H1, als eigenständiger Block)
3. "Was ist/bedeutet [Thema]?" – klare Definition
4. "Warum ist das prüfungsrelevant?" – Einordnung
5. "Beispiel aus der Prüfung" – konkretes Szenario
6. "Typische Fehler" – Bezug zu trap_tags
7. "So merkst du es dir" – Lerntipp/Eselsbrücke
8. "Häufige Fragen" – 3-5 FAQ
9. CTA

ARTIKELTYP: ${source.article_type}
- definition: Fokus auf klare Begriffserklärung
- mistake: Fokus auf typische Prüfungsfehler
- example: Fokus auf durchgerechnetes/durchdachtes Beispiel
- comparison: Fokus auf Gegenüberstellung ähnlicher Konzepte
- faq: Fokus auf häufige Suchfragen
- strategy: Fokus auf Lern-/Prüfungsstrategie

SEO: Target-Keyword natürlich im Titel, H2s, ersten 100 Wörtern und meta_description.
Schreibe 1200-2000 Wörter.`;

  const userPrompt = `Schreibe einen ${source.article_type}-Artikel zum Thema:

THEMA: ${source.topic}
${curriculum ? `BERUF/FACH: ${curriculum.title}` : ""}
${question ? `BASIEREND AUF PRÜFUNGSFRAGE: ${question.question_text}` : ""}
${question ? `TYPISCHE FALLE: ${(question.trap_tags || []).join(", ")}` : ""}
${question ? `SCHWIERIGKEIT: ${question.difficulty}` : ""}
TARGET-KEYWORD: ${source.topic.toLowerCase().replace(/[^a-zäöüß\s]/gi, "").trim()}

Generiere ALLE Felder inkl. answer_blocks und entity_data.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.85,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      tools: [{
        type: "function",
        function: {
          name: "return_blog_article",
          description: "Return the generated blog article with answer blocks and entity data",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "SEO title (50-70 chars)" },
              primary_question: { type: "string", description: "Central search question this article answers" },
              short_answer: { type: "string", description: "2-4 sentence direct answer to the primary question, snippet-ready" },
              meta_description: { type: "string", description: "SEO meta description (120-155 chars)" },
              excerpt: { type: "string", description: "Short excerpt (100-200 chars)" },
              content_md: { type: "string", description: "Full article in Markdown with answer-first structure" },
              keywords: { type: "array", items: { type: "string" }, description: "5-8 SEO keywords" },
              target_keyword: { type: "string", description: "Primary target keyword" },
              hero_image_prompt: { type: "string", description: "Prompt for hero image (descriptive, no text)" },
              hero_image_alt: { type: "string", description: "Alt text: what is shown + topic + exam context" },
              answer_blocks: {
                type: "object",
                properties: {
                  definition_block: { type: "string", description: "Clear 2-3 sentence definition" },
                  example_block: { type: "string", description: "Concrete exam-like example" },
                  mistake_block: { type: "string", description: "Most common mistake explained" },
                  memory_tip: { type: "string", description: "Mnemonic or learning tip" },
                },
                required: ["definition_block", "example_block", "mistake_block"],
              },
              entity_data: {
                type: "object",
                properties: {
                  beruf: { type: "string", description: "Relevant profession/qualification" },
                  pruefung: { type: "string", description: "Relevant exam type" },
                  concepts: { type: "array", items: { type: "string" }, description: "Core concepts covered" },
                  synonyms: { type: "array", items: { type: "string" }, description: "Alternative terms" },
                  related_concepts: { type: "array", items: { type: "string" }, description: "Related topics" },
                  difficulty: { type: "string", description: "easy/medium/hard" },
                },
                required: ["concepts", "related_concepts"],
              },
              faq: {
                type: "array",
                items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] },
                description: "3-5 FAQ items",
              },
            },
            required: ["title", "primary_question", "short_answer", "meta_description", "excerpt", "content_md", "keywords", "target_keyword", "hero_image_prompt", "hero_image_alt", "answer_blocks", "entity_data", "faq"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_blog_article" } },
    }),
  });

  if (!resp.ok) { console.error(`LLM error: ${resp.status}`); return null; }
  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return null;
  try { return JSON.parse(toolCall.function.arguments); } catch { return null; }
}

// ── Helpers ──

function generateSlug(text: string): string {
  const charMap: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
  return text.toLowerCase().split("").map(c => charMap[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function computeHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.trim().toLowerCase().replace(/\s+/g, " "));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function pingIndexNow(url: string): Promise<void> {
  try {
    await fetch(`https://api.indexnow.org/indexnow?url=${encodeURIComponent(url)}&key=examfit2026`, { method: "GET" });
  } catch { /* non-critical */ }
}
