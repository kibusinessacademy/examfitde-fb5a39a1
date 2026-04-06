import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DiscoveryCandidate {
  title: string;
  source: string;
  source_url?: string;
  year?: number;
  profession_type?: string;
  raw_data?: Record<string, unknown>;
}

// ── Scoring Engine ──────────────────────────────────────────────
function evaluateCandidate(c: DiscoveryCandidate): {
  score: number;
  breakdown: Record<string, number>;
} {
  const t = (c.title ?? "").toLowerCase();
  const breakdown: Record<string, number> = {};

  // 1. Demand score (keyword-based)
  let demand = 0;
  if (/digital|it-|informatik|daten|cyber|ki\b|ai\b/.test(t)) demand += 3;
  if (/kaufm|büro|management|verwaltung/.test(t)) demand += 2;
  if (/industrie|mechatronik|elektro|metall/.test(t)) demand += 1.5;
  if (/pflege|gesundheit/.test(t)) demand += 1.5;
  if (/nachhaltigkeit|umwelt|klima|energie/.test(t)) demand += 1;
  breakdown.demand = demand;

  // 2. Monetization score
  let monetization = 0;
  if (/§34|34c|34f|34i|34d/.test(t)) monetization += 4;
  if (/fachwirt|meister|betriebswirt|bilanzbuch/.test(t)) monetization += 3;
  if (/verwalter|weg/.test(t)) monetization += 2.5;
  if (/ihk|hwk/.test(t)) monetization += 2;
  if (/zertifiz|pflicht|gesetz/.test(t)) monetization += 2;
  breakdown.monetization = monetization;

  // 3. Exam structure score (clear exam = higher value)
  let examStructure = 0;
  if (/ihk|hwk|prüfung/.test(t)) examStructure += 2;
  if (/ausbildung/.test(t)) examStructure += 1.5;
  if (c.profession_type === "ausbildung") examStructure += 1;
  if (c.profession_type === "fortbildung") examStructure += 1.5;
  if (c.profession_type === "zertifizierung") examStructure += 2;
  breakdown.exam_structure = examStructure;

  // 4. B2B fit
  let b2b = 0;
  if (/industrie|logistik|handel|bank|versicherung/.test(t)) b2b += 2;
  if (/compliance|datenschutz|geldwäsche|sicherheit/.test(t)) b2b += 2;
  if (/unternehmen|betrieb/.test(t)) b2b += 1;
  breakdown.b2b_fit = b2b;

  // 5. Freshness bonus
  let freshness = 0;
  if (c.year && c.year >= 2024) freshness += 2;
  else if (c.year && c.year >= 2020) freshness += 1;
  breakdown.freshness = freshness;

  // 6. Negative filters (niche penalty)
  let penalty = 0;
  if (/schornstein|bestatter|kürschner|segelmacher/.test(t)) penalty -= 3;
  breakdown.niche_penalty = penalty;

  const score =
    demand + monetization + examStructure + b2b + freshness + penalty;
  breakdown.total = score;

  return { score: Math.max(0, score), breakdown };
}

function determinePriority(score: number): number {
  if (score >= 10) return 1;
  if (score >= 6) return 2;
  if (score >= 3) return 3;
  return 4;
}

function determineTrack(
  score: number,
  profType: string
): string {
  if (score >= 10 && (profType === "fortbildung" || profType === "zertifizierung"))
    return "EXAM_FIRST_PLUS";
  if (score >= 6) return "EXAM_FIRST";
  return "EXAM_FIRST";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action ?? "evaluate";

    // ── ACTION: ingest ──────────────────────────────────────
    // Insert new candidates from external sources
    if (action === "ingest") {
      const candidates: DiscoveryCandidate[] = body.candidates ?? [];
      if (!candidates.length) {
        return new Response(
          JSON.stringify({ error: "No candidates provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rows = candidates.map((c) => ({
        title: c.title,
        source: c.source ?? "manual",
        source_url: c.source_url,
        year: c.year,
        profession_type: c.profession_type ?? "ausbildung",
        raw_data: c.raw_data ?? {},
        status: "detected",
      }));

      // Insert one by one to handle unique index on lower(title),source
      const inserted: Array<{ id: string; title: string }> = [];
      for (const row of rows) {
        const { data: d, error: e } = await sb
          .from("curriculum_discovery")
          .insert(row)
          .select("id, title")
          .maybeSingle();
        if (e) {
          if (e.code === "23505") continue; // duplicate, skip
          console.error("Insert error:", e);
          continue;
        }
        if (d) inserted.push(d);
      }
      const data = inserted;
      const error = null;

      if (error) throw error;

      return new Response(
        JSON.stringify({ ingested: data?.length ?? 0, items: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: evaluate ────────────────────────────────────
    // Score all 'detected' candidates
    if (action === "evaluate") {
      const { data: candidates, error } = await sb
        .from("curriculum_discovery")
        .select("*")
        .eq("status", "detected")
        .limit(50);

      if (error) throw error;
      if (!candidates?.length) {
        return new Response(
          JSON.stringify({ evaluated: 0, message: "No candidates to evaluate" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let evaluated = 0;
      const results: Array<{ title: string; score: number; priority: number }> = [];

      for (const c of candidates) {
        const { score, breakdown } = evaluateCandidate({
          title: c.title,
          source: c.source,
          year: c.year,
          profession_type: c.profession_type,
          raw_data: c.raw_data,
        });

        await sb
          .from("curriculum_discovery")
          .update({
            score,
            score_breakdown: breakdown,
            status: "evaluated",
            evaluated_at: new Date().toISOString(),
          })
          .eq("id", c.id);

        evaluated++;
        results.push({
          title: c.title,
          score,
          priority: determinePriority(score),
        });
      }

      return new Response(
        JSON.stringify({ evaluated, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: auto_approve ────────────────────────────────
    // Auto-approve high-scoring candidates and create packages
    if (action === "auto_approve") {
      const threshold = body.threshold ?? 8;

      const { data: candidates, error } = await sb
        .from("curriculum_discovery")
        .select("*")
        .eq("status", "evaluated")
        .gte("score", threshold)
        .order("score", { ascending: false })
        .limit(body.limit ?? 10);

      if (error) throw error;
      if (!candidates?.length) {
        return new Response(
          JSON.stringify({ approved: 0, message: "No candidates above threshold" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let approved = 0;
      const created: Array<{ title: string; package_id: string; priority: number }> = [];

      for (const c of candidates) {
        const priority = determinePriority(c.score);
        const track = determineTrack(c.score, c.profession_type);

        // Check if curriculum already exists
        const { data: existing } = await sb
          .from("curricula")
          .select("id")
          .ilike("title", c.title)
          .maybeSingle();

        let curriculumId = existing?.id;

        if (!curriculumId) {
          // Create curriculum
          const certType =
            c.profession_type === "fortbildung"
              ? "fortbildung_ihk"
              : c.profession_type === "zertifizierung"
                ? "branchenzertifikat"
                : "ausbildungsberuf";

          const { data: newCurr, error: currErr } = await sb
            .from("curricula")
            .insert({
              title: c.title,
              certification_type: certType,
              track,
            })
            .select("id")
            .single();

          if (currErr) {
            console.error(`Failed to create curriculum for ${c.title}:`, currErr);
            continue;
          }
          curriculumId = newCurr.id;
        }

        // Create package
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

        // Update discovery record
        await sb
          .from("curriculum_discovery")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            curriculum_id: curriculumId,
            package_id: newPkg.id,
          })
          .eq("id", c.id);

        approved++;
        created.push({ title: c.title, package_id: newPkg.id, priority });
      }

      return new Response(
        JSON.stringify({ approved, created }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: status ──────────────────────────────────────
    if (action === "status") {
      const { data, error } = await sb
        .from("curriculum_discovery")
        .select("status")
        .then((res) => {
          if (res.error) throw res.error;
          const counts: Record<string, number> = {};
          for (const r of res.data ?? []) {
            counts[r.status] = (counts[r.status] ?? 0) + 1;
          }
          return { data: counts, error: null };
        });

      const { data: topCandidates } = await sb
        .from("curriculum_discovery")
        .select("title, score, status, source, year")
        .order("score", { ascending: false })
        .limit(10);

      return new Response(
        JSON.stringify({ counts: data, top_candidates: topCandidates }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: reject ──────────────────────────────────────
    if (action === "reject") {
      const ids: string[] = body.ids ?? [];
      const reason = body.reason ?? "manual_rejection";

      if (!ids.length) {
        return new Response(
          JSON.stringify({ error: "No IDs provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await sb
        .from("curriculum_discovery")
        .update({ status: "rejected", rejection_reason: reason })
        .in("id", ids);

      if (error) throw error;

      return new Response(
        JSON.stringify({ rejected: ids.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        error: "Unknown action",
        available: ["ingest", "evaluate", "auto_approve", "status", "reject"],
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Discovery error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
