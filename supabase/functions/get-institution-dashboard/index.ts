import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) return json(400, { error: "organization_id required" }, origin);

    // Parallel: org + membership
    const [orgRes, membershipRes] = await Promise.all([
      supabase.from("organizations").select("id, name, org_type").eq("id", orgId).single(),
      supabase.from("org_memberships").select("role").eq("org_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    ]);

    const org = orgRes.data;
    if (!org) return json(404, { error: "Organization not found" }, origin);
    if (!["IHK", "HWK"].includes(org.org_type)) return json(400, { error: "Not an institution (IHK/HWK)" }, origin);

    const membership = membershipRes.data;
    if (!membership) return json(403, { error: "No access" }, origin);

    const allowedRoles = ["OWNER", "MANAGER", "IT_ADMIN", "IHK_ADMIN", "HWK_ADMIN"];
    if (!allowedRoles.includes(membership.role)) return json(403, { error: "Insufficient role" }, origin);

    // Empty defaults
    const emptyResponse = {
      org: { id: org.id, name: org.name, org_type: org.org_type },
      kpis: { linked_schools_count: 0, linked_companies_count: 0, active_curricula_count: 0, active_classes_count: 0, active_learners_count: 0, avg_readiness_score: 0, high_risk_count: 0 },
      linked_orgs: { schools: [] as any[], companies: [] as any[] },
      curricula: [] as any[],
      risk_distribution: { high: 0, medium: 0, low: 0, not_started: 0 },
      recent_activity: { active_last_7_days: 0, active_last_14_days: 0, inactive_over_14_days: 0 },
    };

    // Linked orgs
    const { data: links } = await supabase
      .from("org_links")
      .select("id, org_a_id, org_b_id, link_type")
      .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
      .eq("status", "active");

    const allLinks = links ?? [];
    if (allLinks.length === 0) return json(200, emptyResponse, origin);

    // Resolve partner orgs
    const linkedIds = [...new Set(allLinks.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id))];
    const { data: linkedOrgs } = await supabase.from("organizations").select("id, name, org_type").in("id", linkedIds);
    const orgMap = Object.fromEntries((linkedOrgs ?? []).map((o: any) => [o.id, o]));

    const schools: any[] = [];
    const companies: any[] = [];
    for (const l of allLinks) {
      const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
      const p = orgMap[partnerId];
      if (!p) continue;
      const entry = { org_id: p.id, name: p.name, org_type: p.org_type, link_type: l.link_type };
      if (p.org_type === "SCHOOL" || p.org_type === "UNIVERSITY") schools.push(entry);
      else if (p.org_type === "COMPANY") companies.push(entry);
    }

    // Classes from linked schools
    const schoolIds = schools.map((s: any) => s.org_id);
    if (schoolIds.length === 0) {
      emptyResponse.kpis.linked_companies_count = companies.length;
      emptyResponse.linked_orgs = { schools, companies };
      return json(200, emptyResponse, origin);
    }

    const { data: classes } = await supabase
      .from("school_classes")
      .select("id, curriculum_id, org_id")
      .in("org_id", schoolIds)
      .eq("status", "active");

    const classList = classes ?? [];
    const allClassIds = classList.map((c: any) => c.id);
    const curriculumIdSet = new Set<string>();
    // Track class→curriculum mapping for per-curriculum aggregation
    const classCurrMap: Record<string, string> = {};
    for (const c of classList) {
      if (c.curriculum_id) {
        curriculumIdSet.add(c.curriculum_id);
        classCurrMap[c.id] = c.curriculum_id;
      }
    }

    // Students from those classes
    let allStudentIds: string[] = [];
    // Track student→curriculum for per-curriculum stats
    const studentCurrMap: Record<string, Set<string>> = {};

    if (allClassIds.length > 0) {
      const { data: cms } = await supabase
        .from("class_memberships")
        .select("user_id, class_id")
        .in("class_id", allClassIds)
        .eq("role", "student")
        .eq("status", "active");

      const studentSet = new Set<string>();
      for (const m of (cms ?? [])) {
        studentSet.add(m.user_id);
        const currId = classCurrMap[m.class_id];
        if (currId) {
          if (!studentCurrMap[m.user_id]) studentCurrMap[m.user_id] = new Set();
          studentCurrMap[m.user_id].add(currId);
        }
      }
      allStudentIds = [...studentSet];
    }

    // Curricula titles
    const curriculumIds = [...curriculumIdSet];
    const currTitleMap: Record<string, string> = {};
    if (curriculumIds.length > 0) {
      const { data: currData } = await supabase.from("curricula").select("id, title").in("id", curriculumIds);
      for (const c of (currData ?? [])) currTitleMap[c.id] = c.title;
    }

    // Readiness snapshots
    const riskDist = { high: 0, medium: 0, low: 0, not_started: 0 };
    let avgReadiness = 0;
    let active7 = 0;
    let active14 = 0;
    let inactiveOver14 = 0;
    // Per-curriculum aggregation
    const currStats: Record<string, { learners: Set<string>; classes: number; totalScore: number; count: number }> = {};
    for (const cid of curriculumIds) {
      currStats[cid] = { learners: new Set(), classes: 0, totalScore: 0, count: 0 };
    }
    // Count classes per curriculum
    for (const c of classList) {
      if (c.curriculum_id && currStats[c.curriculum_id]) currStats[c.curriculum_id].classes++;
    }
    // Count learners per curriculum
    for (const [uid, cids] of Object.entries(studentCurrMap)) {
      for (const cid of cids) {
        if (currStats[cid]) currStats[cid].learners.add(uid);
      }
    }

    if (allStudentIds.length > 0 && curriculumIds.length > 0) {
      const { data: snapshots } = await supabase
        .from("readiness_snapshots")
        .select("user_id, curriculum_id, readiness_score, risk_level, created_at")
        .in("user_id", allStudentIds)
        .in("curriculum_id", curriculumIds)
        .order("created_at", { ascending: false });

      // Deduplicate: latest per (user_id, curriculum_id)
      const seen = new Set<string>();
      const latestSnapshots: any[] = [];
      for (const s of (snapshots ?? [])) {
        const key = `${s.user_id}:${s.curriculum_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          latestSnapshots.push(s);
        }
      }

      const now = Date.now();
      let totalScore = 0;
      const userActivity = new Map<string, number>(); // user → most recent snapshot age in days

      for (const s of latestSnapshots) {
        totalScore += (s.readiness_score ?? 0);
        const rl = s.risk_level as keyof typeof riskDist;
        if (rl in riskDist) riskDist[rl]++;
        else riskDist.not_started++;

        // Per-curriculum readiness
        if (currStats[s.curriculum_id]) {
          currStats[s.curriculum_id].totalScore += (s.readiness_score ?? 0);
          currStats[s.curriculum_id].count++;
        }

        // Activity: track most recent snapshot per user
        const days = Math.floor((now - new Date(s.created_at).getTime()) / 86400000);
        const prev = userActivity.get(s.user_id);
        if (prev === undefined || days < prev) userActivity.set(s.user_id, days);
      }

      avgReadiness = latestSnapshots.length > 0
        ? Math.round((totalScore / latestSnapshots.length) * 10) / 10
        : 0;

      // Activity from per-user most-recent
      for (const days of userActivity.values()) {
        if (days <= 7) active7++;
        if (days <= 14) active14++;
        if (days > 14) inactiveOver14++;
      }

      // Students without any snapshot → not_started
      const studentsWithSnapshot = new Set(latestSnapshots.map((s: any) => s.user_id));
      const noSnapshotCount = allStudentIds.filter(id => !studentsWithSnapshot.has(id)).length;
      riskDist.not_started += noSnapshotCount;
      inactiveOver14 += noSnapshotCount;
    } else {
      riskDist.not_started = allStudentIds.length;
      inactiveOver14 = allStudentIds.length;
    }

    // Build enriched curricula
    const enrichedCurricula = curriculumIds.map((cid) => {
      const s = currStats[cid];
      return {
        curriculum_id: cid,
        title: currTitleMap[cid] ?? null,
        active_classes: s?.classes ?? 0,
        active_learners: s?.learners.size ?? 0,
        avg_readiness_score: s && s.count > 0
          ? Math.round((s.totalScore / s.count) * 10) / 10
          : 0,
      };
    });

    return json(200, {
      org: { id: org.id, name: org.name, org_type: org.org_type },
      kpis: {
        linked_schools_count: schools.length,
        linked_companies_count: companies.length,
        active_curricula_count: curriculumIdSet.size,
        active_classes_count: classList.length,
        active_learners_count: allStudentIds.length,
        avg_readiness_score: avgReadiness,
        high_risk_count: riskDist.high,
      },
      linked_orgs: { schools, companies },
      curricula: enrichedCurricula,
      risk_distribution: riskDist,
      recent_activity: {
        active_last_7_days: active7,
        active_last_14_days: active14,
        inactive_over_14_days: inactiveOver14,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
