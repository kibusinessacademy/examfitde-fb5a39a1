import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface DiscoveryCandidate {
  title: string;
  source: string;
  source_url?: string;
  year?: number;
  profession_type?: string;
  raw_data?: Record<string, unknown>;
}

// ── Canonical Slug ─────────────────────────────────────────────
function canonicalSlug(title: string, source: string, year?: number): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-zäöüß0-9§ ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${normalized}:${source || "unknown"}:${year ?? "0000"}`;
}

// ── Alias Detection ────────────────────────────────────────────
// Known alias patterns for modernized professions
const ALIAS_PATTERNS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /kaufmann.*e-commerce|e-commerce.*kaufmann/i, canonical: "kaufmann-im-e-commerce" },
  { pattern: /kaufmann.*digitalisierungsmanagement/i, canonical: "kaufmann-fuer-digitalisierungsmanagement" },
  { pattern: /fachinformatik.*anwendungsentwicklung/i, canonical: "fachinformatiker-anwendungsentwicklung" },
  { pattern: /fachinformatik.*systemintegration/i, canonical: "fachinformatiker-systemintegration" },
  { pattern: /fachinformatik.*daten.*prozess/i, canonical: "fachinformatiker-daten-und-prozessanalyse" },
  { pattern: /fachinformatik.*digitale.*vernetzung/i, canonical: "fachinformatiker-digitale-vernetzung" },
  { pattern: /it.*system.*management/i, canonical: "it-system-management" },
  { pattern: /kaufmann.*büromanagement/i, canonical: "kaufmann-fuer-bueromanagement" },
];

function detectAlias(title: string): string | null {
  const t = title.toLowerCase();
  for (const { pattern, canonical } of ALIAS_PATTERNS) {
    if (pattern.test(t)) return canonical;
  }
  return null;
}

// ── Scoring Engine ─────────────────────────────────────────────
function evaluateCandidate(c: DiscoveryCandidate): {
  score: number;
  breakdown: Record<string, number>;
} {
  const t = (c.title ?? "").toLowerCase();
  const breakdown: Record<string, number> = {};

  let demand = 0;
  if (/digital|it-|informatik|daten|cyber|ki\b|ai\b/.test(t)) demand += 3;
  if (/kaufm|büro|management|verwaltung/.test(t)) demand += 2;
  if (/industrie|mechatronik|elektro|metall/.test(t)) demand += 1.5;
  if (/pflege|gesundheit/.test(t)) demand += 1.5;
  if (/nachhaltigkeit|umwelt|klima|energie/.test(t)) demand += 1;
  breakdown.demand = demand;

  let monetization = 0;
  if (/§34|34c|34f|34i|34d/.test(t)) monetization += 4;
  if (/fachwirt|meister|betriebswirt|bilanzbuch/.test(t)) monetization += 3;
  if (/verwalter|weg/.test(t)) monetization += 2.5;
  if (/ihk|hwk/.test(t)) monetization += 2;
  if (/zertifiz|pflicht|gesetz/.test(t)) monetization += 2;
  breakdown.monetization = monetization;

  let examStructure = 0;
  if (/ihk|hwk|prüfung/.test(t)) examStructure += 2;
  if (/ausbildung/.test(t)) examStructure += 1.5;
  if (c.profession_type === "ausbildung") examStructure += 1;
  if (c.profession_type === "fortbildung") examStructure += 1.5;
  if (c.profession_type === "zertifizierung") examStructure += 2;
  breakdown.exam_structure = examStructure;

  let b2b = 0;
  if (/industrie|logistik|handel|bank|versicherung/.test(t)) b2b += 2;
  if (/compliance|datenschutz|geldwäsche|sicherheit/.test(t)) b2b += 2;
  if (/unternehmen|betrieb/.test(t)) b2b += 1;
  breakdown.b2b_fit = b2b;

  let freshness = 0;
  if (c.year && c.year >= 2024) freshness += 2;
  else if (c.year && c.year >= 2020) freshness += 1;
  breakdown.freshness = freshness;

  let penalty = 0;
  if (/schornstein|bestatter|kürschner|segelmacher/.test(t)) penalty -= 3;
  breakdown.niche_penalty = penalty;

  const score = demand + monetization + examStructure + b2b + freshness + penalty;
  breakdown.total = score;

  return { score: Math.max(0, score), breakdown };
}

function determinePriority(score: number): number {
  if (score >= 10) return 1;
  if (score >= 6) return 2;
  if (score >= 3) return 3;
  return 4;
}

function determineTrack(score: number, profType: string): string {
  if (score >= 10 && (profType === "fortbildung" || profType === "zertifizierung"))
    return "EXAM_FIRST_PLUS";
  return "EXAM_FIRST";
}

// ── Hold Reason Detection ──────────────────────────────────────
// Determines if a candidate should be held for manual review
function detectHoldReason(
  title: string,
  profType: string,
  collisions: { curricula: number; packages: number; alias: string | null }
): string | null {
  if (collisions.alias) return "alias_suspected";
  if (collisions.curricula > 0 || collisions.packages > 0) return "existing_product_collision";
  if (/§|verordnung|regelung|gesetz/.test(title.toLowerCase())) return "regulatory_review";
  if (profType === "zertifizierung") return "certification_review";
  // Fuzzy/ambiguous titles
  if (title.length < 10) return "ambiguous_title";
  return null;
}

// ── Collision Check ────────────────────────────────────────────
async function checkCollisions(
  sb: ReturnType<typeof createClient>,
  title: string
): Promise<{ curricula: number; packages: number; alias: string | null; details: unknown }> {
  const alias = detectAlias(title);
  const searchTerms = [title];
  if (alias) searchTerms.push(alias.replace(/-/g, " "));

  let curriculaCount = 0;
  let packagesCount = 0;
  const details: Record<string, unknown> = {};

  for (const term of searchTerms) {
    const { data: currs } = await sb
      .from("curricula")
      .select("id, title")
      .ilike("title", `%${term}%`)
      .limit(5);
    if (currs?.length) {
      curriculaCount += currs.length;
      details.matching_curricula = currs;
    }

    const { data: pkgs } = await sb
      .from("course_packages")
      .select("id, title, status")
      .ilike("title", `%${term}%`)
      .limit(5);
    if (pkgs?.length) {
      packagesCount += pkgs.length;
      details.matching_packages = pkgs;
    }
  }

  return { curricula: curriculaCount, packages: packagesCount, alias, details };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "evaluate";

    // ── ACTION: ingest ──────────────────────────────────────
    if (action === "ingest") {
      const candidates: DiscoveryCandidate[] = body.candidates ?? [];
      if (!candidates.length) {
        return json({ error: "No candidates provided" }, 400);
      }

      const inserted: Array<{ id: string; title: string; slug: string }> = [];
      const skipped: string[] = [];

      for (const c of candidates) {
        const slug = canonicalSlug(c.title, c.source ?? "manual", c.year);

        const row = {
          title: c.title,
          source: c.source ?? "manual",
          source_url: c.source_url,
          year: c.year,
          profession_type: c.profession_type ?? "ausbildung",
          raw_data: c.raw_data ?? {},
          canonical_slug: slug,
          status: "detected",
        };

        const { data: d, error: e } = await sb
          .from("curriculum_discovery")
          .insert(row)
          .select("id, title")
          .maybeSingle();

        if (e) {
          if (e.code === "23505") {
            skipped.push(c.title);
            continue;
          }
          console.error("Insert error:", e);
          continue;
        }
        if (d) inserted.push({ ...d, slug });
      }

      return json({ ingested: inserted.length, skipped: skipped.length, items: inserted, skipped_titles: skipped });
    }

    // ── ACTION: evaluate ────────────────────────────────────
    // Scores candidates AND runs collision checks + hold detection
    if (action === "evaluate") {
      const { data: candidates, error } = await sb
        .from("curriculum_discovery")
        .select("*")
        .eq("status", "detected")
        .limit(body.limit ?? 50);

      if (error) throw error;
      if (!candidates?.length) {
        return json({ evaluated: 0, message: "No candidates to evaluate" });
      }

      let evaluated = 0;
      let held = 0;
      const results: Array<{
        title: string;
        score: number;
        priority: number;
        status: string;
        hold_reason?: string;
        collisions?: unknown;
      }> = [];

      for (const c of candidates) {
        const { score, breakdown } = evaluateCandidate({
          title: c.title,
          source: c.source,
          year: c.year,
          profession_type: c.profession_type,
          raw_data: c.raw_data,
        });

        // Run collision check
        const collisions = await checkCollisions(sb, c.title);

        // Determine if manual hold is needed
        const holdReason = detectHoldReason(c.title, c.profession_type ?? "", {
          curricula: collisions.curricula,
          packages: collisions.packages,
          alias: collisions.alias,
        });

        const newStatus = holdReason ? "manual_hold" : "evaluated";

        await sb
          .from("curriculum_discovery")
          .update({
            score,
            score_breakdown: breakdown,
            status: newStatus,
            hold_reason: holdReason,
            collision_check: {
              curricula_matches: collisions.curricula,
              package_matches: collisions.packages,
              alias_detected: collisions.alias,
              details: collisions.details,
              checked_at: new Date().toISOString(),
            },
            evaluated_at: new Date().toISOString(),
            canonical_slug: c.canonical_slug || canonicalSlug(c.title, c.source, c.year),
          })
          .eq("id", c.id);

        evaluated++;
        if (holdReason) held++;

        results.push({
          title: c.title,
          score,
          priority: determinePriority(score),
          status: newStatus,
          hold_reason: holdReason ?? undefined,
          collisions: holdReason ? collisions.details : undefined,
        });
      }

      return json({ evaluated, held, clean: evaluated - held, results });
    }

    // ── ACTION: review ──────────────────────────────────────
    // List candidates pending review (evaluated + manual_hold)
    if (action === "review") {
      const statusFilter = body.status ?? ["evaluated", "manual_hold"];
      const minScore = body.min_score ?? 0;

      const { data, error } = await sb
        .from("curriculum_discovery")
        .select("id, title, source, year, profession_type, score, score_breakdown, status, hold_reason, collision_check, canonical_slug, detected_at, evaluated_at")
        .in("status", Array.isArray(statusFilter) ? statusFilter : [statusFilter])
        .gte("score", minScore)
        .order("score", { ascending: false })
        .limit(body.limit ?? 50);

      if (error) throw error;

      return json({
        candidates: data ?? [],
        count: data?.length ?? 0,
        filters: { status: statusFilter, min_score: minScore },
      });
    }

    // ── ACTION: approve (manual) ────────────────────────────
    // Admin approves specific candidates by ID
    if (action === "approve") {
      const ids: string[] = body.ids ?? [];
      if (!ids.length) return json({ error: "No IDs provided" }, 400);

      const { data: candidates, error } = await sb
        .from("curriculum_discovery")
        .select("*")
        .in("id", ids)
        .in("status", ["evaluated", "manual_hold"]);

      if (error) throw error;
      if (!candidates?.length) return json({ approved: 0, message: "No eligible candidates found" });

      let approved = 0;
      const created: Array<{ title: string; package_id: string; priority: number }> = [];

      for (const c of candidates) {
        const priority = determinePriority(c.score ?? 0);
        const track = determineTrack(c.score ?? 0, c.profession_type ?? "");

        // Check if curriculum already exists (robust: title match)
        const { data: existing } = await sb
          .from("curricula")
          .select("id")
          .ilike("title", c.title)
          .maybeSingle();

        let curriculumId = existing?.id;

        if (!curriculumId) {
          const certType =
            c.profession_type === "fortbildung" ? "fortbildung_ihk"
            : c.profession_type === "zertifizierung" ? "branchenzertifikat"
            : "ausbildungsberuf";

          const { data: newCurr, error: currErr } = await sb
            .from("curricula")
            .insert({ title: c.title, certification_type: certType, track })
            .select("id")
            .single();

          if (currErr) {
            console.error(`Failed to create curriculum for ${c.title}:`, currErr);
            continue;
          }
          curriculumId = newCurr.id;
        }

        // Check for existing package
        const { data: existingPkg } = await sb
          .from("course_packages")
          .select("id")
          .eq("curriculum_id", curriculumId)
          .maybeSingle();

        if (existingPkg) {
          // Already has a package — just link and approve
          await sb
            .from("curriculum_discovery")
            .update({
              status: "approved",
              approved_at: new Date().toISOString(),
              curriculum_id: curriculumId,
              package_id: existingPkg.id,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", c.id);
          approved++;
          created.push({ title: c.title, package_id: existingPkg.id, priority });
          continue;
        }

        const { data: newPkg, error: pkgErr } = await sb
          .from("course_packages")
          .insert({
            curriculum_id: curriculumId,
            title: c.title,
            priority,
            status: "queued",
            track,
            build_progress: 0,
          })
          .select("id")
          .single();

        if (pkgErr) {
          console.error(`Failed to create package for ${c.title}:`, pkgErr);
          continue;
        }

        await sb
          .from("curriculum_discovery")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            curriculum_id: curriculumId,
            package_id: newPkg.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", c.id);

        approved++;
        created.push({ title: c.title, package_id: newPkg.id, priority });
      }

      return json({ approved, created });
    }

    // ── ACTION: auto_approve_safe ───────────────────────────
    // Only approves high-confidence candidates with NO collisions and NO hold
    if (action === "auto_approve_safe") {
      const threshold = body.threshold ?? 10; // Higher threshold for auto

      const { data: candidates, error } = await sb
        .from("curriculum_discovery")
        .select("*")
        .eq("status", "evaluated") // NOT manual_hold
        .gte("score", threshold)
        .is("hold_reason", null)
        .order("score", { ascending: false })
        .limit(body.limit ?? 5); // Conservative batch size

      if (error) throw error;
      if (!candidates?.length) {
        return json({ approved: 0, message: "No high-confidence candidates" });
      }

      // Double-check collisions before auto-approve
      let approved = 0;
      const created: Array<{ title: string; package_id: string; priority: number }> = [];
      const blocked: Array<{ title: string; reason: string }> = [];

      for (const c of candidates) {
        const collisions = await checkCollisions(sb, c.title);
        if (collisions.curricula > 0 || collisions.packages > 0 || collisions.alias) {
          // Move to manual_hold instead
          await sb.from("curriculum_discovery").update({
            status: "manual_hold",
            hold_reason: collisions.alias ? "alias_suspected" : "existing_product_collision",
            collision_check: {
              curricula_matches: collisions.curricula,
              package_matches: collisions.packages,
              alias_detected: collisions.alias,
              details: collisions.details,
              rechecked_at: new Date().toISOString(),
            },
          }).eq("id", c.id);
          blocked.push({ title: c.title, reason: "collision_on_recheck" });
          continue;
        }

        // Safe to create
        const priority = determinePriority(c.score ?? 0);
        const track = determineTrack(c.score ?? 0, c.profession_type ?? "");
        const certType =
          c.profession_type === "fortbildung" ? "fortbildung_ihk"
          : c.profession_type === "zertifizierung" ? "branchenzertifikat"
          : "ausbildungsberuf";

        const { data: newCurr, error: currErr } = await sb
          .from("curricula")
          .insert({ title: c.title, certification_type: certType, track })
          .select("id")
          .single();

        if (currErr) {
          console.error(`Auto-approve curriculum error for ${c.title}:`, currErr);
          continue;
        }

        const { data: newPkg, error: pkgErr } = await sb
          .from("course_packages")
          .insert({
            curriculum_id: newCurr.id,
            title: c.title,
            priority,
            status: "queued",
            track,
            build_progress: 0,
          })
          .select("id")
          .single();

        if (pkgErr) {
          console.error(`Auto-approve package error for ${c.title}:`, pkgErr);
          continue;
        }

        await sb.from("curriculum_discovery").update({
          status: "approved",
          approved_at: new Date().toISOString(),
          curriculum_id: newCurr.id,
          package_id: newPkg.id,
        }).eq("id", c.id);

        approved++;
        created.push({ title: c.title, package_id: newPkg.id, priority });
      }

      return json({ approved, blocked: blocked.length, created, blocked_details: blocked });
    }

    // ── ACTION: status ──────────────────────────────────────
    if (action === "status") {
      const { data: allRows } = await sb
        .from("curriculum_discovery")
        .select("status");

      const counts: Record<string, number> = {};
      for (const r of allRows ?? []) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }

      const { data: topCandidates } = await sb
        .from("curriculum_discovery")
        .select("title, score, status, source, year, hold_reason, profession_type")
        .order("score", { ascending: false })
        .limit(15);

      const { data: holdItems } = await sb
        .from("curriculum_discovery")
        .select("title, score, hold_reason, collision_check")
        .eq("status", "manual_hold")
        .order("score", { ascending: false })
        .limit(10);

      return json({ counts, top_candidates: topCandidates, held_for_review: holdItems });
    }

    // ── ACTION: reject ──────────────────────────────────────
    if (action === "reject") {
      const ids: string[] = body.ids ?? [];
      const reason = body.reason ?? "manual_rejection";
      if (!ids.length) return json({ error: "No IDs provided" }, 400);

      const { error } = await sb
        .from("curriculum_discovery")
        .update({
          status: "rejected",
          rejection_reason: reason,
          reviewed_at: new Date().toISOString(),
        })
        .in("id", ids);

      if (error) throw error;
      return json({ rejected: ids.length });
    }

    // ── ACTION: release_hold ────────────────────────────────
    // Release a manual_hold back to evaluated (after admin review)
    if (action === "release_hold") {
      const ids: string[] = body.ids ?? [];
      if (!ids.length) return json({ error: "No IDs provided" }, 400);

      const { error } = await sb
        .from("curriculum_discovery")
        .update({
          status: "evaluated",
          hold_reason: null,
          hold_notes: body.notes ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .in("id", ids)
        .eq("status", "manual_hold");

      if (error) throw error;
      return json({ released: ids.length });
    }

    return json({
      error: "Unknown action",
      available: ["ingest", "evaluate", "review", "approve", "auto_approve_safe", "reject", "release_hold", "status"],
    }, 400);
  } catch (err) {
    console.error("Discovery error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
