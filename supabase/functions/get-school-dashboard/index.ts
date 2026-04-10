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

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) return json(400, { error: "organization_id required" }, origin);

    // Guard
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json(403, { error: "No access to this organization" }, origin);

    const allowedRoles = ["OWNER", "MANAGER", "IT_ADMIN", "SCHOOL_ADMIN", "INSTRUCTOR"];
    if (!allowedRoles.includes(membership.role)) {
      return json(403, { error: "Insufficient role for school dashboard" }, origin);
    }

    // Parallel loads
    const [classesRes, instructorsRes, linksRes, orgRes] = await Promise.all([
      supabase
        .from("school_classes")
        .select("id, name, curriculum_id, academic_year, grade_year, status, created_at")
        .eq("org_id", orgId)
        .order("academic_year", { ascending: false }),
      supabase
        .from("instructor_assignments")
        .select("id, user_id, curriculum_id, class_id, role, status, assigned_at")
        .eq("org_id", orgId)
        .eq("status", "active"),
      supabase
        .from("org_links")
        .select("id, org_a_id, org_b_id, link_type")
        .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
        .eq("status", "active"),
      supabase
        .from("organizations")
        .select("id, name, org_type")
        .eq("id", orgId)
        .single(),
    ]);

    const classes = classesRes.data ?? [];
    const instructors = instructorsRes.data ?? [];

    // Get class IDs to load memberships
    const classIds = classes.map((c: any) => c.id);
    let allMemberships: any[] = [];
    if (classIds.length > 0) {
      const { data: cms } = await supabase
        .from("class_memberships")
        .select("id, class_id, user_id, role, status")
        .in("class_id", classIds)
        .eq("status", "active");
      allMemberships = cms ?? [];
    }

    // Student counts per class (only from class_memberships, role=student)
    const classStudentCounts: Record<string, number> = {};
    for (const cm of allMemberships) {
      if (cm.role === "student") {
        classStudentCounts[cm.class_id] = (classStudentCounts[cm.class_id] || 0) + 1;
      }
    }

    // Instructor counts per class (from instructor_assignments, NOT class_memberships)
    const classInstructorCounts: Record<string, number> = {};
    for (const ia of instructors) {
      if (ia.class_id) {
        classInstructorCounts[ia.class_id] = (classInstructorCounts[ia.class_id] || 0) + 1;
      }
    }

    // Resolve curriculum titles
    const curriculumIds = [...new Set(classes.map((c: any) => c.curriculum_id).filter(Boolean))];
    let curriculumMap: Record<string, string> = {};
    if (curriculumIds.length > 0) {
      const { data: currData } = await supabase
        .from("curricula")
        .select("id, title")
        .in("id", curriculumIds);
      curriculumMap = Object.fromEntries((currData ?? []).map((c: any) => [c.id, c.title]));
    }

    const enrichedClasses = classes.map((c: any) => ({
      ...c,
      curriculum_title: curriculumMap[c.curriculum_id] ?? null,
      student_count: classStudentCounts[c.id] || 0,
      instructor_count: classInstructorCounts[c.id] || 0,
    }));

    // Unique students & instructors
    const uniqueStudentIds = new Set(
      allMemberships.filter((m: any) => m.role === "student").map((m: any) => m.user_id)
    );
    const uniqueInstructorIds = new Set(instructors.map((i: any) => i.user_id));

    // If instructor, scope down
    let visibleClasses = enrichedClasses;
    if (membership.role === "INSTRUCTOR") {
      const assignedClassIds = new Set(
        instructors.filter((i: any) => i.user_id === userId).map((i: any) => i.class_id).filter(Boolean)
      );
      visibleClasses = enrichedClasses.filter((c: any) => assignedClassIds.has(c.id));
    }

    // Resolve linked org names
    const links = linksRes.data ?? [];
    let linkedOrgs: any[] = [];
    if (links.length > 0) {
      const linkedIds = [...new Set(links.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id))];
      const { data: linkedOrgData } = await supabase
        .from("organizations")
        .select("id, name, org_type")
        .in("id", linkedIds);
      const orgMapLocal = Object.fromEntries((linkedOrgData ?? []).map((o: any) => [o.id, o]));
      linkedOrgs = links.map((l: any) => {
        const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
        return {
          link_id: l.id,
          link_type: l.link_type,
          partner_org_id: partnerId,
          partner_org_name: orgMapLocal[partnerId]?.name ?? null,
          partner_org_type: orgMapLocal[partnerId]?.org_type ?? null,
        };
      });
    }

    return json(200, {
      org: orgRes.data,
      kpis: {
        total_classes: visibleClasses.length,
        active_classes: visibleClasses.filter((c: any) => c.status === "active").length,
        total_students: uniqueStudentIds.size,
        total_instructors: uniqueInstructorIds.size,
        total_curricula: curriculumIds.length,
      },
      classes: visibleClasses,
      instructors,
      linked_orgs: linkedOrgs,
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
