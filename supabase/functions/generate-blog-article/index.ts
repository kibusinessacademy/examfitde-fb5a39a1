import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { detectGenericContent, resolveGenericSeverity } from "../_shared/generic-content-detector.ts";

/**
 * generate-blog-article v3 – Hardened AI-Search-Optimized Content Factory
 *
 * Hardened points vs v2:
 *  1. 6-state status machine (draft_generated → needs_review → published / failed_*)
 *  2. Topic-fingerprint intent dedup (not just slug/hash)
 *  3. AI detection on ALL text fields (title, meta, short_answer, FAQ)
 *  4. Stronger SEO/AISO validation (single H1, no dupes, no placeholders)
 *  5. Entity-first internal linking (competency/trap/concept before type diversity)
 *  6. Deterministic hero image prompts bound to entity data
 *  7. Smart batch coverage (by article_type, topic_cluster, competency)
 *  8. Publish event hooks (sitemap, RSS, IndexNow)
 */

const GARBAGE_RE = /^(undefined|null|none|n\/a|placeholder|todo|tbd|hier ist ein|lorem ipsum)/i;
const SITE_URL = "https://examfit.de";
const ARTICLE_TYPES = ["definition", "mistake", "example", "comparison", "faq", "strategy"] as const;

// ── 6-state status machine ──
type ArticleStatus = "draft_generated" | "needs_review" | "published" | "failed_validation" | "failed_ai_detection" | "duplicate";

// ── Validation (hardened) ──

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

  // Garbage check on all text fields
  for (const field of ["title", "content_md", "meta_description", "short_answer", "excerpt"]) {
    const val = (article[field] || "").trim();
    if (GARBAGE_RE.test(val)) {
      return { valid: false, reason: `'${field}' contains garbage/placeholder text` };
    }
  }

  // Keywords: deduplicated, min 3
  if (!Array.isArray(article.keywords) || article.keywords.length < 3) {
    return { valid: false, reason: "keywords must have at least 3 entries" };
  }
  const uniqueKw = new Set(article.keywords.map((k: string) => k.toLowerCase().trim()));
  if (uniqueKw.size < 3) {
    return { valid: false, reason: "keywords must have at least 3 unique entries" };
  }

  // FAQ: min 3, no duplicate questions
  if (!Array.isArray(article.faq) || article.faq.length < 3) {
    return { valid: false, reason: "faq must have at least 3 Q&A pairs" };
  }
  const faqQuestions = new Set(article.faq.map((f: any) => f.q?.toLowerCase().trim()));
  if (faqQuestions.size < article.faq.length) {
    return { valid: false, reason: "faq contains duplicate questions" };
  }

  // Answer blocks
  if (!article.answer_blocks?.definition_block) {
    return { valid: false, reason: "answer_blocks.definition_block required" };
  }

  // Single H1 in markdown
  const h1Matches = (article.content_md as string).match(/^# [^\n]+/gm);
  if (!h1Matches || h1Matches.length !== 1) {
    return { valid: false, reason: `content_md must have exactly 1 H1 (found ${h1Matches?.length || 0})` };
  }

  // At least 2 H2 subheadings
  const h2Matches = (article.content_md as string).match(/^## [^\n]+/gm);
  if (!h2Matches || h2Matches.length < 2) {
    return { valid: false, reason: `content_md must have at least 2 H2 subheadings (found ${h2Matches?.length || 0})` };
  }

  // short_answer ≠ excerpt ≠ meta_description
  const sa = article.short_answer?.trim().toLowerCase();
  const ex = article.excerpt?.trim().toLowerCase();
  const md = article.meta_description?.trim().toLowerCase();
  if (sa === ex) return { valid: false, reason: "short_answer must differ from excerpt" };
  if (sa === md) return { valid: false, reason: "short_answer must differ from meta_description" };
  if (ex === md) return { valid: false, reason: "excerpt must differ from meta_description" };

  // hero_image_alt: must contain topic hint but not be keyword spam (>5 commas = spam)
  const altCommas = (article.hero_image_alt || "").split(",").length - 1;
  if (altCommas > 5) return { valid: false, reason: "hero_image_alt looks like keyword spam" };

  return { valid: true };
}

// ── AI Detection on ALL fields (not just body) ──

function runFullAiDetection(article: any): {
  score: number;
  severity: string;
  details: { field: string; genericPhrases: string[]; spellingErrors: string[] }[];
} {
  const fields = [
    { name: "content_md", text: article.content_md, maxGeneric: 2 },
    { name: "title", text: article.title, maxGeneric: 0 },
    { name: "meta_description", text: article.meta_description, maxGeneric: 0 },
    { name: "short_answer", text: article.short_answer, maxGeneric: 1 },
    { name: "excerpt", text: article.excerpt, maxGeneric: 0 },
  ];

  // Add FAQ answers
  if (Array.isArray(article.faq)) {
    for (let i = 0; i < article.faq.length; i++) {
      fields.push({ name: `faq[${i}].a`, text: article.faq[i]?.a || "", maxGeneric: 0 });
    }
  }

  let totalGeneric = 0;
  let totalErrors = 0;
  let totalSentences = 0;
  const details: { field: string; genericPhrases: string[]; spellingErrors: string[] }[] = [];

  for (const { name, text, maxGeneric } of fields) {
    if (!text) continue;
    const result = detectGenericContent(text, maxGeneric);
    totalGeneric += result.genericPhraseCount;
    totalErrors += result.spellingErrors.length;
    const sentences = text.replace(/<[^>]+>/g, " ").split(/[.!?]+/).filter((s: string) => s.trim().length > 10);
    totalSentences += sentences.length;
    if (result.genericPhrases.length > 0 || result.spellingErrors.length > 0) {
      details.push({ field: name, genericPhrases: result.genericPhrases, spellingErrors: result.spellingErrors });
    }
  }

  const genericRatio = totalSentences > 0 ? totalGeneric / totalSentences : 0;
  const severity = resolveGenericSeverity({
    genericPhraseCount: totalGeneric,
    spellingErrorCount: totalErrors,
    genericRatio,
    artifactType: "blog_article",
  });

  const score = Math.max(0, 100 - (totalGeneric * 8) - (totalErrors * 12));

  return { score, severity, details };
}

// ── Topic Fingerprint ──

function computeTopicFingerprint(topic: string, targetKeyword: string, articleType: string): string {
  const normalized = [topic, targetKeyword]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/gi, "")
    .split(/\s+/)
    .filter(w => w.length > 2)
    .sort()
    .join("_");
  return `${articleType}::${normalized}`.substring(0, 200);
}

// ── Entity-first Internal Link Builder ──

async function buildInternalLinks(
  admin: any,
  contentMd: string,
  curriculumId: string | null,
  berufId: string | null,
  currentSlug: string,
  entityData: any,
  competencyId: string | null,
): Promise<{ content: string; links: Array<{ anchor: string; url: string; reason: string; type: string; priority: number }> }> {
  const links: Array<{ anchor: string; url: string; reason: string; type: string; priority: number }> = [];
  let content = contentMd;

  // PRIORITY 1: Same competency (strongest semantic link)
  if (competencyId) {
    const { data: sameComp } = await admin
      .from("blog_articles")
      .select("slug, title, article_type")
      .eq("competency_id", competencyId)
      .eq("status", "published")
      .neq("slug", currentSlug)
      .limit(3);
    for (const a of sameComp || []) {
      links.push({ anchor: a.title, url: `/blog/${a.slug}`, reason: "same_competency", type: "blog", priority: 100 });
    }
  }

  // PRIORITY 2: Related concepts from entity_data
  if (entityData?.related_concepts?.length) {
    for (const concept of entityData.related_concepts.slice(0, 3)) {
      const { data: conceptArticle } = await admin
        .from("blog_articles")
        .select("slug, title")
        .eq("status", "published")
        .ilike("title", `%${concept}%`)
        .neq("slug", currentSlug)
        .limit(1)
        .maybeSingle();
      if (conceptArticle && !links.find(l => l.url === `/blog/${conceptArticle.slug}`)) {
        links.push({ anchor: conceptArticle.title, url: `/blog/${conceptArticle.slug}`, reason: "related_concept", type: "concept", priority: 90 });
      }
    }
  }

  // PRIORITY 3: Same curriculum (topical cluster)
  if (curriculumId && links.length < 5) {
    const { data: sameCurr } = await admin
      .from("blog_articles")
      .select("slug, title, article_type")
      .eq("source_curriculum_id", curriculumId)
      .eq("status", "published")
      .neq("slug", currentSlug)
      .limit(5);
    for (const a of sameCurr || []) {
      if (!links.find(l => l.url === `/blog/${a.slug}`)) {
        links.push({ anchor: a.title, url: `/blog/${a.slug}`, reason: "same_curriculum", type: "blog", priority: 70 });
      }
    }
  }

  // PRIORITY 4: SEO documents
  if ((berufId || curriculumId) && links.length < 6) {
    let query = admin.from("seo_documents").select("slug, title, doc_type").eq("status", "published").limit(3);
    if (berufId) query = query.eq("beruf_id", berufId);
    else if (curriculumId) query = query.eq("curriculum_id", curriculumId);
    const { data: seoDocs } = await query;
    const docTypeUrlMap: Record<string, string> = { blog: "/wissen", landing: "/pruefungstraining", faq: "/faq", glossary: "/glossar", cluster: "/wissen" };
    for (const doc of (seoDocs || []).slice(0, 2)) {
      const base = docTypeUrlMap[doc.doc_type] || "/wissen";
      const linkUrl = `${base}/${doc.slug}`;
      if (!content.includes(linkUrl)) {
        links.push({ anchor: doc.title, url: linkUrl, reason: "seo_document", type: doc.doc_type, priority: 60 });
      }
    }
  }

  // PRIORITY 5: Beruf page inline link
  if (berufId) {
    const { data: beruf } = await admin.from("berufe").select("bezeichnung_kurz").eq("id", berufId).single();
    if (beruf) {
      const berufSlug = generateSlug(beruf.bezeichnung_kurz);
      const berufUrl = `/berufe/${berufSlug}`;
      if (!content.includes(berufUrl)) {
        const regex = new RegExp(`(?<!\\[)${escapeRegex(beruf.bezeichnung_kurz)}(?!\\])(?!\\()`, "i");
        if (regex.test(content)) {
          content = content.replace(regex, `[${beruf.bezeichnung_kurz}](${berufUrl})`);
          links.push({ anchor: beruf.bezeichnung_kurz, url: berufUrl, reason: "beruf_page", type: "beruf", priority: 50 });
        }
      }
    }
  }

  // Sort by priority descending, take top 5 for Weiterlesen
  links.sort((a, b) => b.priority - a.priority);
  const blogLinks = links.filter(l => l.url.startsWith("/blog/") || l.url.startsWith("/wissen/")).slice(0, 4);
  if (blogLinks.length > 0) {
    content += `\n\n## Weiterlesen\n\n${blogLinks.map(l => `- [${l.anchor}](${l.url})`).join("\n")}`;
  }

  // CTA
  if (!content.includes("/pruefungstraining")) {
    content += `\n\n---\n\n**Bereit für die Prüfung?** [Starte jetzt dein Prüfungstraining](/pruefungstraining) und bereite dich systematisch vor.`;
    links.push({ anchor: "Prüfungstraining", url: "/pruefungstraining", reason: "conversion_cta", type: "cta", priority: 10 });
  }

  return { content, links };
}

// ── Publish Event Logger ──

async function logPublishEvent(admin: any, articleId: string, eventType: string, eventData: Record<string, unknown> = {}) {
  await admin.from("blog_publishing_events").insert({
    article_id: articleId,
    event_type: eventType,
    event_data: eventData,
  }).catch((e: any) => console.warn(`[publish-event] ${eventType} log failed:`, e));
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

    // ── Publish mode: transition draft_generated → needs_review → published ──
    if (body.action === "publish" && body.article_id) {
      return await handlePublish(admin, supabaseUrl, body.article_id, headers);
    }
    if (body.action === "review" && body.article_id) {
      return await handleStatusTransition(admin, body.article_id, "draft_generated", "needs_review", headers);
    }

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
      // ── Smart batch: coverage by article_type AND competency ──
      const { data: packages } = await admin
        .from("course_packages")
        .select("id, curriculum_id, status")
        .eq("status", "published")
        .not("curriculum_id", "is", null)
        .limit(50);

      if (packages) {
        const currIds = [...new Set(packages.map((p: any) => p.curriculum_id))];
        for (const cid of currIds) {
          if (sources.length >= Math.min(batch_size, 10)) break;

          // Check existing coverage by article_type
          const { data: existing } = await admin
            .from("blog_articles")
            .select("article_type, competency_id")
            .eq("source_curriculum_id", cid)
            .not("status", "in", '("failed_validation","failed_ai_detection","duplicate")');

          const coveredTypes = new Set((existing || []).map((e: any) => e.article_type));
          const coveredCompetencies = new Set((existing || []).filter((e: any) => e.competency_id).map((e: any) => e.competency_id));

          // Find uncovered article type
          const nextType = ARTICLE_TYPES.find(t => !coveredTypes.has(t));
          if (!nextType && (existing || []).length >= 10) continue; // fully covered

          // Find a question from an uncovered competency if possible
          let questionQuery = admin
            .from("exam_questions")
            .select("id, question_text, trap_tags, difficulty, cognitive_level, competency_id")
            .eq("curriculum_id", cid)
            .in("question_type", ["multiple_choice", "single_choice"])
            .not("trap_tags", "is", null)
            .order("difficulty", { ascending: false })
            .limit(5);

          const { data: questions } = await questionQuery;
          // Prefer question from uncovered competency
          const question = questions?.find((q: any) => q.competency_id && !coveredCompetencies.has(q.competency_id)) || questions?.[0];

          const { data: curriculum } = await admin.from("curricula").select("id, title, description").eq("id", cid).single();
          if (!curriculum) continue;

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
            article_type: nextType || "strategy",
            context: { curriculum, question },
          });
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
        if (!article) { results.push({ topic: source.topic, error: "Generation failed", status: "failed_validation" }); continue; }

        // ── Validate (hardened) ──
        const validation = validateArticle(article);
        if (!validation.valid) {
          results.push({ topic: source.topic, error: `Validation: ${validation.reason}`, status: "failed_validation" });
          continue;
        }

        // ── AI Detection on ALL fields ──
        const detection = runFullAiDetection(article);
        if (detection.severity === "critical" || detection.severity === "error") {
          results.push({ topic: source.topic, status: "failed_ai_detection", ai_score: detection.score, details: detection.details });
          continue;
        }

        // ── Slug dedup ──
        const slug = generateSlug(article.title);
        const { data: existingSlug } = await admin.from("blog_articles").select("id").eq("slug", slug).limit(1);
        if (existingSlug?.length) { results.push({ topic: source.topic, error: `Slug exists: ${slug}`, status: "duplicate" }); continue; }

        // ── Content hash dedup ──
        const contentHash = await computeHash(article.content_md);
        const { data: existingHash } = await admin.from("blog_articles").select("id").eq("content_hash", contentHash).limit(1);
        if (existingHash?.length) { results.push({ topic: source.topic, status: "duplicate" }); continue; }

        // ── Topic fingerprint dedup ──
        const topicFp = computeTopicFingerprint(source.topic, article.target_keyword || "", source.article_type);

        // ── Hero Image (entity-bound prompt) ──
        let heroImageUrl: string | null = null;
        try {
          const entityBeruf = article.entity_data?.beruf || "";
          const entityPruefung = article.entity_data?.pruefung || "";
          const entityConcepts = (article.entity_data?.concepts || []).slice(0, 3).join(", ");
          const typeVisualMap: Record<string, string> = {
            definition: "clean diagram or infographic explaining the concept",
            mistake: "warning or alert visual showing a common error",
            example: "step-by-step calculation or process illustration",
            comparison: "side-by-side comparison chart or Venn diagram",
            faq: "question marks and knowledge bubbles",
            strategy: "structured study plan or roadmap visual",
          };
          const visualStyle = typeVisualMap[source.article_type] || "professional educational illustration";

          const imagePrompt = `Create a professional, modern blog hero image: ${visualStyle}. Topic: ${entityConcepts || source.topic}. Context: ${entityBeruf} ${entityPruefung} exam preparation. Style: minimal, blue and white tones, no text in the image. 16:9 aspect ratio.`;

          const imageResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-image-preview",
              messages: [{ role: "user", content: imagePrompt }],
              modalities: ["image", "text"],
            }),
          });
          if (imageResp.ok) {
            const imageData = await imageResp.json();
            const imageBase64 = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
            if (imageBase64?.startsWith("data:image/")) {
              const base64Data = imageBase64.split(",")[1];
              const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
              const { error: uploadErr } = await admin.storage.from("public-assets").upload(`blog-heroes/${slug}.png`, imageBytes, { contentType: "image/png", upsert: true });
              if (!uploadErr) {
                const { data: urlData } = admin.storage.from("public-assets").getPublicUrl(`blog-heroes/${slug}.png`);
                heroImageUrl = urlData?.publicUrl || null;
              }
            }
          }
        } catch { /* non-blocking */ }

        // ── Internal Links (entity-first) ──
        const { content: linkedContent, links: internalLinks } = await buildInternalLinks(
          admin, article.content_md, source.curriculum_id, source.beruf_id, slug, article.entity_data, source.competency_id,
        );

        const words = linkedContent.split(/\s+/).filter(Boolean).length;
        const readingTime = Math.ceil(words / 200);

        const qualitySignals = {
          content_depth: Math.min(100, Math.round(words / 20)),
          snippet_readiness: article.short_answer?.length >= 50 ? 100 : 50,
          entity_clarity: (article.entity_data?.concepts?.length || 0) >= 2 ? 100 : 50,
          faq_coverage: Math.min(100, (article.faq?.length || 0) * 20),
          ai_detection_score: detection.score,
          internal_link_count: internalLinks.length,
          h2_count: (linkedContent.match(/^## /gm) || []).length,
        };

        const status: ArticleStatus = detection.score >= 75 ? "draft_generated" : "failed_ai_detection";

        const { data: inserted, error: insertErr } = await admin
          .from("blog_articles")
          .insert({
            slug,
            title: article.title,
            meta_description: article.meta_description,
            content_md: linkedContent,
            keywords: [...new Set(article.keywords.map((k: string) => k.toLowerCase().trim()))],
            target_keyword: article.target_keyword,
            topic_cluster: source.topic_cluster,
            topic_fingerprint: topicFp,
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
            internal_link_plan: internalLinks.map((l) => ({ ...l })),
            ai_detection_score: detection.score,
            ai_detection_report: { severity: detection.severity, details: detection.details },
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

        if (insertErr) {
          // Check for topic fingerprint uniqueness violation
          if (insertErr.message?.includes("uq_blog_topic_intent")) {
            results.push({ topic: source.topic, status: "duplicate", error: "Topic intent already covered" });
          } else {
            results.push({ topic: source.topic, error: insertErr.message });
          }
          continue;
        }

        await logPublishEvent(admin, inserted.id, "generated", {
          status, ai_score: detection.score, word_count: words, article_type: source.article_type,
        });

        results.push({
          topic: source.topic, status: "created", article_id: inserted.id, slug,
          word_count: words, ai_detection_score: detection.score,
          has_hero_image: !!heroImageUrl, internal_links: internalLinks.length,
          article_type: source.article_type, quality_signals: qualitySignals,
        });
      } catch (innerErr) {
        results.push({ topic: source.topic, error: innerErr instanceof Error ? innerErr.message : "Unknown" });
      }

      if (sources.length > 1) await new Promise((r) => setTimeout(r, 3000));
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (error) {
    console.error("[generate-blog-article] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers });
  }
});

// ── Publish Handler (SSOT Publish Event) ──

async function handlePublish(admin: any, supabaseUrl: string, articleId: string, headers: Record<string, string>) {
  const { data: article, error } = await admin
    .from("blog_articles")
    .select("id, status, slug, ai_detection_score, content_quality_signals")
    .eq("id", articleId)
    .single();

  if (error || !article) {
    return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers });
  }

  if (article.status !== "needs_review") {
    return new Response(JSON.stringify({
      error: `PUBLISH_BLOCKED: Status muss "needs_review" sein (aktuell: ${article.status})`,
    }), { status: 403, headers });
  }

  if ((article.ai_detection_score || 0) < 70) {
    return new Response(JSON.stringify({
      error: `PUBLISH_BLOCKED: AI-Score zu niedrig (${article.ai_detection_score})`,
    }), { status: 403, headers });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("blog_articles")
    .update({ status: "published", published_at: now })
    .eq("id", articleId);

  if (updateErr) throw updateErr;

  // Fire publish events (all fire-and-forget)
  const canonical = `${SITE_URL}/blog/${article.slug}`;

  // 1. IndexNow
  pingIndexNow(canonical).catch(() => {});

  // 2. Sitemap refresh
  fetch(`${supabaseUrl}/functions/v1/generate-sitemap-index`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
    body: JSON.stringify({ trigger: "blog-publish", article_id: articleId }),
  }).catch((e) => console.warn("[publish] Sitemap trigger failed:", e));

  // Log events
  await Promise.all([
    logPublishEvent(admin, articleId, "published", { published_at: now, canonical }),
    logPublishEvent(admin, articleId, "indexnow_ping", { url: canonical }),
    logPublishEvent(admin, articleId, "sitemap_refresh", { trigger: "blog-publish" }),
  ]);

  return new Response(JSON.stringify({
    success: true, article_id: articleId, slug: article.slug, published_at: now, canonical,
  }), { status: 200, headers });
}

// ── Status Transition Helper ──

async function handleStatusTransition(admin: any, articleId: string, fromStatus: string, toStatus: string, headers: Record<string, string>) {
  const { data, error } = await admin
    .from("blog_articles")
    .select("id, status")
    .eq("id", articleId)
    .single();

  if (error || !data) return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers });
  if (data.status !== fromStatus) {
    return new Response(JSON.stringify({ error: `Status must be "${fromStatus}" (got "${data.status}")` }), { status: 403, headers });
  }

  const { error: updateErr } = await admin
    .from("blog_articles")
    .update({ status: toStatus })
    .eq("id", articleId);

  if (updateErr) throw updateErr;

  await logPublishEvent(admin, articleId, "status_transition", { from: fromStatus, to: toStatus });

  return new Response(JSON.stringify({ success: true, article_id: articleId, status: toStatus }), { status: 200, headers });
}

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
1. Genau EINE H1 (# Titel) mit Suchintention
2. Kurzantwort (2-4 Sätze, direkt unter H1, eigenständiger Block – NICHT identisch mit excerpt oder meta_description)
3. "Was ist/bedeutet [Thema]?" – klare Definition (## Überschrift)
4. "Warum ist das prüfungsrelevant?" (## Überschrift)
5. "Beispiel aus der Prüfung" – konkretes Szenario (## Überschrift)
6. "Typische Fehler" – Bezug zu trap_tags (## Überschrift)
7. "So merkst du es dir" – Lerntipp/Eselsbrücke (## Überschrift)
8. "Häufige Fragen" – 3-5 FAQ (## Überschrift)
9. Mindestens 3 H2-Überschriften

WICHTIG:
- excerpt, short_answer und meta_description müssen UNTERSCHIEDLICHE Formulierungen sein
- FAQ-Fragen dürfen sich NICHT wiederholen
- Keywords deduplizieren
- Keine Platzhaltertexte

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
              short_answer: { type: "string", description: "2-4 sentence direct answer (DIFFERENT from excerpt and meta_description)" },
              meta_description: { type: "string", description: "SEO meta description (120-155 chars, DIFFERENT from excerpt)" },
              excerpt: { type: "string", description: "Short excerpt (100-200 chars, DIFFERENT from meta_description)" },
              content_md: { type: "string", description: "Full article in Markdown. Exactly 1 H1, at least 3 H2s. Answer-first structure." },
              keywords: { type: "array", items: { type: "string" }, description: "5-8 unique SEO keywords (no duplicates)" },
              target_keyword: { type: "string", description: "Primary target keyword" },
              hero_image_prompt: { type: "string", description: "Prompt for hero image (descriptive, no text)" },
              hero_image_alt: { type: "string", description: "Alt text: what is shown + topic + exam context. Max 5 commas." },
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
                  beruf: { type: "string" },
                  pruefung: { type: "string" },
                  concepts: { type: "array", items: { type: "string" } },
                  synonyms: { type: "array", items: { type: "string" } },
                  related_concepts: { type: "array", items: { type: "string" } },
                  difficulty: { type: "string" },
                },
                required: ["concepts", "related_concepts"],
              },
              faq: {
                type: "array",
                items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] },
                description: "3-5 FAQ items (no duplicate questions)",
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
  return text.toLowerCase().split("").map((c) => charMap[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function computeHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.trim().toLowerCase().replace(/\s+/g, " "));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pingIndexNow(url: string): Promise<void> {
  try {
    await fetch(`https://api.indexnow.org/indexnow?url=${encodeURIComponent(url)}&key=examfit2026`, { method: "GET" });
  } catch { /* non-critical */ }
}
