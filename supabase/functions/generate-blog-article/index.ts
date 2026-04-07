import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { detectGenericContent, resolveGenericSeverity } from "../_shared/generic-content-detector.ts";

/**
 * generate-blog-article – Automated Blog Article Factory
 *
 * Pipeline:
 * 1. Pick source (exam question or curriculum topic)
 * 2. Generate article via LLM with anti-AI-detection prompt hardening
 * 3. Run generic-content-detector for quality gating
 * 4. Generate hero image + OG image via AI
 * 5. Build internal links automatically
 * 6. Save as draft (if quality gate fails) or in_review
 * 7. Trigger sitemap + IndexNow ping
 */

const GARBAGE_STRINGS = ["undefined", "null", "none", "n/a", "placeholder", "todo", "tbd"];
const SITE_URL = "https://examfit.de";

// ── Validation ──

function validateArticle(article: any): { valid: boolean; reason?: string } {
  if (!article) return { valid: false, reason: "No article returned" };

  const checks: Array<{ field: string; minLen: number }> = [
    { field: "title", minLen: 20 },
    { field: "content_md", minLen: 500 },
    { field: "meta_description", minLen: 50 },
    { field: "excerpt", minLen: 30 },
    { field: "hero_image_alt", minLen: 10 },
  ];

  for (const { field, minLen } of checks) {
    const val = article[field];
    if (!val || val.length < minLen) {
      return { valid: false, reason: `${field} too short or missing (min ${minLen}, got ${val?.length || 0})` };
    }
  }

  // Garbage detection
  for (const field of ["title", "content_md", "meta_description"]) {
    const val = (article[field] || "").trim().toLowerCase();
    if (GARBAGE_STRINGS.includes(val)) {
      return { valid: false, reason: `'${field}' contains garbage: ${val}` };
    }
  }

  // Keywords must be array with at least 3 items
  if (!Array.isArray(article.keywords) || article.keywords.length < 3) {
    return { valid: false, reason: "keywords must have at least 3 entries" };
  }

  // FAQ must be array with at least 2 items
  if (!Array.isArray(article.faq) || article.faq.length < 2) {
    return { valid: false, reason: "faq must have at least 2 Q&A pairs" };
  }

  return { valid: true };
}

// ── Internal Link Builder ──

async function buildInternalLinks(
  admin: any,
  contentMd: string,
  curriculumId: string | null,
  berufId: string | null,
  currentSlug: string,
): Promise<{ content: string; links: Array<{ anchor: string; url: string }> }> {
  const links: Array<{ anchor: string; url: string }> = [];
  let content = contentMd;

  // 1. Link to related blog articles
  const { data: relatedArticles } = await admin
    .from("blog_articles")
    .select("slug, title, topic_cluster")
    .eq("status", "published")
    .neq("slug", currentSlug)
    .limit(10);

  if (relatedArticles && relatedArticles.length > 0) {
    // Pick up to 3 related articles
    const toLink = relatedArticles.slice(0, 3);
    for (const rel of toLink) {
      const linkUrl = `/blog/${rel.slug}`;
      if (!content.includes(linkUrl)) {
        links.push({ anchor: rel.title, url: linkUrl });
      }
    }
  }

  // 2. Link to SEO documents (same beruf/curriculum)
  if (berufId || curriculumId) {
    let query = admin.from("seo_documents")
      .select("slug, title, doc_type")
      .eq("status", "published")
      .limit(5);

    if (berufId) query = query.eq("beruf_id", berufId);
    else if (curriculumId) query = query.eq("curriculum_id", curriculumId);

    const { data: seoDocs } = await query;
    const docTypeUrlMap: Record<string, string> = {
      blog: "/wissen", landing: "/pruefungstraining", faq: "/faq",
      glossary: "/glossar", cluster: "/wissen",
    };

    if (seoDocs) {
      for (const doc of seoDocs.slice(0, 2)) {
        const base = docTypeUrlMap[doc.doc_type] || "/wissen";
        const linkUrl = `${base}/${doc.slug}`;
        if (!content.includes(linkUrl)) {
          links.push({ anchor: doc.title, url: linkUrl });
        }
      }
    }
  }

  // 3. Link to Beruf page
  if (berufId) {
    const { data: beruf } = await admin
      .from("berufe")
      .select("bezeichnung_kurz")
      .eq("id", berufId)
      .single();

    if (beruf) {
      const berufSlug = generateSlug(beruf.bezeichnung_kurz);
      const berufUrl = `/berufe/${berufSlug}`;
      if (!content.includes(berufUrl)) {
        // Replace first mention with link
        const regex = new RegExp(`(?<!\\[)${escapeRegex(beruf.bezeichnung_kurz)}(?!\\])(?!\\()`, "i");
        if (regex.test(content)) {
          content = content.replace(regex, `[${beruf.bezeichnung_kurz}](${berufUrl})`);
          links.push({ anchor: beruf.bezeichnung_kurz, url: berufUrl });
        }
      }
    }
  }

  // 4. Inject "Weiterlesen" section at the end with related links
  if (links.length > 0) {
    const linkSection = links
      .filter(l => l.url.startsWith("/blog/") || l.url.startsWith("/wissen/"))
      .slice(0, 3)
      .map(l => `- [${l.anchor}](${l.url})`)
      .join("\n");

    if (linkSection) {
      content += `\n\n## Weiterlesen\n\n${linkSection}`;
    }
  }

  // 5. Always add CTA
  if (!content.includes("/pruefungstraining")) {
    content += `\n\n---\n\n**Bereit für die Prüfung?** [Starte jetzt dein Prüfungstraining](/pruefungstraining) und bereite dich systematisch auf deine Abschlussprüfung vor.`;
    links.push({ anchor: "Prüfungstraining", url: "/pruefungstraining" });
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
    const {
      curriculum_id,
      source_question_id,
      topic,
      topic_cluster,
      mode = "single",
      batch_size = 5,
    } = body;

    if (mode === "single" && !curriculum_id && !source_question_id && !topic) {
      return new Response(JSON.stringify({ error: "curriculum_id, source_question_id, or topic required" }), { status: 400, headers });
    }

    // ── Determine what to write about ──
    interface ArticleSource {
      curriculum_id: string | null;
      source_question_id: string | null;
      source_package_id: string | null;
      beruf_id: string | null;
      topic: string;
      topic_cluster: string;
      context: Record<string, unknown>;
    }

    const sources: ArticleSource[] = [];

    if (mode === "batch") {
      // Find published curricula that don't have enough blog articles
      const { data: packages } = await admin
        .from("course_packages")
        .select("id, curriculum_id, status")
        .eq("status", "published")
        .not("curriculum_id", "is", null)
        .limit(50);

      if (packages) {
        const currIds = [...new Set(packages.map((p: any) => p.curriculum_id))];

        for (const cid of currIds.slice(0, batch_size)) {
          // Count existing articles for this curriculum
          const { count } = await admin
            .from("blog_articles")
            .select("id", { count: "exact", head: true })
            .eq("source_curriculum_id", cid);

          if ((count || 0) < 5) {
            // Pick a question as source
            const { data: question } = await admin
              .from("exam_questions")
              .select("id, question_text, trap_tags, difficulty, cognitive_level")
              .eq("curriculum_id", cid)
              .in("question_type", ["multiple_choice", "single_choice"])
              .not("trap_tags", "is", null)
              .order("difficulty", { ascending: false })
              .limit(1)
              .single();

            const { data: curriculum } = await admin
              .from("curricula")
              .select("id, title, description")
              .eq("id", cid)
              .single();

            if (curriculum) {
              const pkg = packages.find((p: any) => p.curriculum_id === cid);
              sources.push({
                curriculum_id: cid,
                source_question_id: question?.id || null,
                source_package_id: pkg?.id || null,
                beruf_id: null,
                topic: question
                  ? `Typischer Prüfungsfehler: ${(question.trap_tags || [])[0] || question.question_text.substring(0, 50)}`
                  : `Prüfungsvorbereitung ${curriculum.title}`,
                topic_cluster: topic_cluster || "pruefungstipps",
                context: { curriculum, question },
              });
            }
          }
        }
      }
    } else {
      // Single mode
      let context: Record<string, unknown> = {};
      let sourceTopic = topic || "";
      let berufId: string | null = null;
      let srcQuestionId = source_question_id || null;
      let srcPackageId: string | null = null;

      if (curriculum_id) {
        const { data: curriculum } = await admin
          .from("curricula")
          .select("id, title, description")
          .eq("id", curriculum_id)
          .single();
        context.curriculum = curriculum;

        if (!sourceTopic && curriculum) {
          sourceTopic = `Prüfungsvorbereitung ${curriculum.title}`;
        }

        // Find package
        const { data: pkg } = await admin
          .from("course_packages")
          .select("id")
          .eq("curriculum_id", curriculum_id)
          .eq("status", "published")
          .limit(1)
          .maybeSingle();
        srcPackageId = pkg?.id || null;
      }

      if (source_question_id) {
        const { data: question } = await admin
          .from("exam_questions")
          .select("id, question_text, options, correct_answer, explanation, difficulty, trap_tags, cognitive_level, curriculum_id")
          .eq("id", source_question_id)
          .single();
        context.question = question;

        if (question && !sourceTopic) {
          sourceTopic = `Prüfungsfehler: ${(question.trap_tags || [])[0] || question.question_text.substring(0, 60)}`;
        }
      }

      sources.push({
        curriculum_id: curriculum_id || null,
        source_question_id: srcQuestionId,
        source_package_id: srcPackageId,
        beruf_id: berufId,
        topic: sourceTopic,
        topic_cluster: topic_cluster || "pruefungstipps",
        context,
      });
    }

    if (sources.length === 0) {
      return new Response(JSON.stringify({ message: "No sources found for article generation" }), { status: 200, headers });
    }

    // ── Generate articles ──
    const results: any[] = [];

    for (const source of sources) {
      try {
        const curriculum = source.context.curriculum as any;
        const question = source.context.question as any;

        // Build rich prompt with anti-AI-detection instructions
        const systemPrompt = `Du bist ein erfahrener Fach-Redakteur für berufliche Prüfungsvorbereitung.
Dein Stil ist:
- Direkt, klar, praxisnah – kein akademischer Duktus
- Kurze Sätze wechseln mit längeren ab (Satzlängenvariation!)
- Du verwendest NIEMALS generische Füllphrasen wie "in diesem Zusammenhang", "es ist wichtig zu beachten", "zusammenfassend lässt sich sagen", "spielt eine wichtige Rolle"
- Du schreibst wie ein Mensch, der das Thema kennt – nicht wie eine KI, die Informationen zusammenfasst
- Du darfst Meinungen äußern, Praxisbeispiele bringen, rhetorische Fragen stellen
- Vermeide Passivkonstruktionen wo möglich
- Verwende KEIN "in der heutigen Zeit", "nicht zu unterschätzen", "darüber hinaus"
- Baue 1-2 kurze Anekdoten oder konkrete Szenarien ein
- Der Text soll sich lesen wie ein Blogpost eines Praktikers, nicht wie ein Wikipedia-Artikel

WICHTIG: Der Artikel MUSS für Google und andere Suchmaschinen optimiert sein.
Verwende das Target-Keyword natürlich im Titel, H2s, ersten 100 Wörtern und meta_description.

Formatierung:
- Genau 1x H1 (# Titel) am Anfang
- Mindestens 3x H2 (## Abschnitt)
- Bullet-Points oder nummerierte Listen wo sinnvoll
- Ein FAQ-Abschnitt mit mindestens 3 Fragen am Ende
- Bilder-Platzhalter: Beschreibe an 2-3 Stellen im Text, wo ein Bild sinnvoll wäre mit [IMAGE: Beschreibung des Bildes]`;

        const userPrompt = `Schreibe einen ausführlichen Blogartikel (1200-2000 Wörter) zum Thema:

THEMA: ${source.topic}
${curriculum ? `BERUF/FACH: ${curriculum.title}` : ""}
${question ? `BASIEREND AUF PRÜFUNGSFRAGE: ${question.question_text}` : ""}
${question ? `TYPISCHE FALLE: ${(question.trap_tags || []).join(", ")}` : ""}
${question ? `SCHWIERIGKEIT: ${question.difficulty}` : ""}
TARGET-KEYWORD: ${source.topic.toLowerCase().replace(/[^a-zäöüß\s]/gi, "").trim()}

Der Artikel soll:
1. Ein konkretes Prüfungsproblem adressieren
2. Praktische Tipps geben
3. Typische Fehler aufzeigen und erklären
4. Praxisbeispiele enthalten
5. Für das Target-Keyword optimiert sein

Gib das Ergebnis als strukturiertes JSON zurück.`;

        const llmResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            temperature: 0.85,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "return_blog_article",
                description: "Return the generated blog article",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Article title (50-70 chars)" },
                    meta_description: { type: "string", description: "SEO meta description (120-155 chars)" },
                    excerpt: { type: "string", description: "Short excerpt (100-200 chars)" },
                    content_md: { type: "string", description: "Full article in Markdown" },
                    keywords: { type: "array", items: { type: "string" }, description: "5-8 SEO keywords" },
                    target_keyword: { type: "string", description: "Primary target keyword" },
                    hero_image_prompt: { type: "string", description: "Prompt for hero image generation (descriptive, no text)" },
                    hero_image_alt: { type: "string", description: "Alt text for hero image (descriptive, keyword-rich)" },
                    faq: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          q: { type: "string" },
                          a: { type: "string" },
                        },
                        required: ["q", "a"],
                      },
                      description: "3-5 FAQ items for structured data",
                    },
                  },
                  required: ["title", "meta_description", "excerpt", "content_md", "keywords", "target_keyword", "hero_image_prompt", "hero_image_alt", "faq"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "return_blog_article" } },
          }),
        });

        if (!llmResp.ok) {
          const errText = await llmResp.text();
          results.push({ topic: source.topic, error: `LLM error: ${llmResp.status} ${errText}` });
          continue;
        }

        const llmData = await llmResp.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        let article: any;

        if (toolCall?.function?.arguments) {
          try {
            article = JSON.parse(toolCall.function.arguments);
          } catch {
            results.push({ topic: source.topic, error: "Failed to parse LLM tool call" });
            continue;
          }
        } else {
          results.push({ topic: source.topic, error: "No tool call in LLM response" });
          continue;
        }

        // ── Validate ──
        const validation = validateArticle(article);
        if (!validation.valid) {
          results.push({ topic: source.topic, error: `Validation failed: ${validation.reason}`, status: "failed_validation" });
          continue;
        }

        // ── AI Detection (Generic Content Detector) ──
        const detectionResult = detectGenericContent(article.content_md, 2);
        const severity = resolveGenericSeverity({
          genericPhraseCount: detectionResult.genericPhraseCount,
          spellingErrorCount: detectionResult.spellingErrors.length,
          genericRatio: detectionResult.genericRatio,
          artifactType: "blog_article",
        });

        const aiDetectionScore = detectionResult.ok ? 100 : Math.max(0, 100 - (detectionResult.genericPhraseCount * 10) - (detectionResult.spellingErrors.length * 15));

        // Block on critical/error severity
        if (severity === "critical" || severity === "error") {
          results.push({
            topic: source.topic,
            status: "failed_ai_detection",
            ai_score: aiDetectionScore,
            issues: {
              generic_phrases: detectionResult.genericPhrases,
              spelling_errors: detectionResult.spellingErrors,
              severity,
            },
          });
          continue;
        }

        // ── Generate slug ──
        const slug = generateSlug(article.title);

        // ── Check for duplicate slug ──
        const { data: existingSlug } = await admin
          .from("blog_articles")
          .select("id")
          .eq("slug", slug)
          .limit(1);

        if (existingSlug && existingSlug.length > 0) {
          results.push({ topic: source.topic, error: `Slug already exists: ${slug}`, status: "duplicate" });
          continue;
        }

        // ── Content hash for duplicate detection ──
        const contentHash = await computeHash(article.content_md);
        const { data: existingHash } = await admin
          .from("blog_articles")
          .select("id")
          .eq("content_hash", contentHash)
          .limit(1);

        if (existingHash && existingHash.length > 0) {
          results.push({ topic: source.topic, error: "Duplicate content hash", status: "duplicate" });
          continue;
        }

        // ── Generate Hero Image ──
        let heroImageUrl: string | null = null;
        try {
          const imageResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image",
              messages: [
                {
                  role: "user",
                  content: `Create a professional, clean blog hero image for an educational article about: ${article.hero_image_prompt}. Style: modern, minimal, professional. Colors: blue tones. No text in the image. 16:9 aspect ratio. High quality.`,
                },
              ],
              modalities: ["image", "text"],
            }),
          });

          if (imageResp.ok) {
            const imageData = await imageResp.json();
            const imageBase64 = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
            if (imageBase64 && imageBase64.startsWith("data:image/")) {
              // Upload to storage
              const base64Data = imageBase64.split(",")[1];
              const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              const imagePath = `blog-heroes/${slug}.png`;

              const { error: uploadErr } = await admin.storage
                .from("public-assets")
                .upload(imagePath, imageBytes, {
                  contentType: "image/png",
                  upsert: true,
                });

              if (!uploadErr) {
                const { data: urlData } = admin.storage
                  .from("public-assets")
                  .getPublicUrl(imagePath);
                heroImageUrl = urlData?.publicUrl || null;
              }
            }
          }
        } catch (imgErr) {
          console.warn("[generate-blog-article] Image generation failed:", imgErr);
          // Non-blocking — continue without image
        }

        // ── Build Internal Links ──
        const { content: linkedContent, links: internalLinks } = await buildInternalLinks(
          admin,
          article.content_md,
          source.curriculum_id,
          source.beruf_id,
          slug,
        );

        // ── Word count + reading time ──
        const words = linkedContent.split(/\s+/).filter(Boolean).length;
        const readingTime = Math.ceil(words / 200);

        // ── Determine status ──
        const status = aiDetectionScore >= 80 && validation.valid ? "draft" : "failed_generation";

        // ── Insert ──
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
            hero_image_url: heroImageUrl,
            hero_image_alt: article.hero_image_alt,
            og_image_url: heroImageUrl, // Same image for OG
            faq_json: article.faq,
            internal_links_json: internalLinks,
            ai_detection_score: aiDetectionScore,
            ai_detection_report: {
              generic_phrases: detectionResult.genericPhrases,
              spelling_errors: detectionResult.spellingErrors,
              generic_ratio: detectionResult.genericRatio,
              severity,
            },
            content_hash: contentHash,
            canonical_url: `${SITE_URL}/blog/${slug}`,
            word_count: words,
            reading_time_min: readingTime,
            source_curriculum_id: source.curriculum_id,
            source_package_id: source.source_package_id,
            source_question_id: source.source_question_id,
            generated_by_model: "google/gemini-2.5-flash",
            status,
          })
          .select("id, slug")
          .single();

        if (insertErr) {
          results.push({ topic: source.topic, error: insertErr.message });
          continue;
        }

        // ── Ping IndexNow (fire-and-forget) ──
        pingIndexNow(`${SITE_URL}/blog/${slug}`).catch(() => {});

        results.push({
          topic: source.topic,
          status: "created",
          article_id: inserted.id,
          slug: inserted.slug,
          word_count: words,
          ai_detection_score: aiDetectionScore,
          has_hero_image: !!heroImageUrl,
          internal_links: internalLinks.length,
        });
      } catch (innerErr) {
        results.push({ topic: source.topic, error: innerErr instanceof Error ? innerErr.message : "Unknown" });
      }

      // Rate limit
      if (sources.length > 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (error) {
    console.error("[generate-blog-article] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers },
    );
  }
});

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
    // IndexNow supports Bing, Yandex, Seznam, Naver
    const indexNowUrl = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(url)}&key=examfit2026`;
    await fetch(indexNowUrl, { method: "GET" });
  } catch {
    // Non-critical, ignore
  }
}
