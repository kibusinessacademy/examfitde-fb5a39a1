/**
 * Admin Read Users – Enterprise user directory.
 * GET ?search=&org_id=&role=&status=&page=&per_page=
 * GET ?user_id=<uuid> → single user detail
 */
import { handleCors, json, requireAdmin } from "../_shared/adminGuard.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { sb } = auth;

    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id");
    const search = url.searchParams.get("search");
    const orgId = url.searchParams.get("org_id");
    const role = url.searchParams.get("role");
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "50", 10)));

    // ─── Single user detail ───
    if (userId) {
      const { data: authUser } = await sb.auth.admin.getUserById(userId);
      if (!authUser?.user) return json({ user: null });

      const u = authUser.user;

      const [membershipsRes, seatsRes, entitlementsRes] = await Promise.all([
        sb.from("org_memberships")
          .select("org_id, role, status, created_at, organizations:org_id(name)")
          .eq("user_id", userId),
        sb.from("org_license_seats")
          .select("id, license_id, claimed_at, released_at, org_licenses:license_id(product_id, products:product_id(title))")
          .eq("user_id", userId)
          .is("released_at", null),
        sb.from("entitlements")
          .select("id, product_id, valid_from, valid_until, products:product_id(title)")
          .eq("user_id", userId),
      ]);

      return json({
        user: {
          user_id: u.id,
          email: u.email,
          display_name: u.user_metadata?.display_name || u.user_metadata?.full_name || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          memberships: (membershipsRes.data ?? []).map((m: any) => ({
            org_id: m.org_id,
            org_name: m.organizations?.name || null,
            role: m.role,
            status: m.status,
            created_at: m.created_at,
          })),
          seats: (seatsRes.data ?? []).map((s: any) => ({
            seat_id: s.id,
            license_id: s.license_id,
            product_title: s.org_licenses?.products?.title || null,
            claimed_at: s.claimed_at,
            released_at: s.released_at,
          })),
          entitlements: (entitlementsRes.data ?? []).map((e: any) => ({
            id: e.id,
            product_id: e.product_id,
            product_title: e.products?.title || null,
            valid_from: e.valid_from,
            valid_until: e.valid_until,
          })),
        },
      });
    }

    // ─── List users (paginated) ───
    const { data: authList, error: authErr } = await sb.auth.admin.listUsers({
      page,
      perPage,
    });
    if (authErr) return json({ error: authErr.message }, 500);

    const users = authList?.users ?? [];
    if (users.length === 0) {
      return json({ users: [], page, per_page: perPage, total: 0 });
    }

    const userIds = users.map((u) => u.id);

    // Batch-load org memberships and seats for this page only
    const [membershipsRes, seatsRes] = await Promise.all([
      sb.from("org_memberships")
        .select("user_id, role, org_id, status, organizations:org_id(name)")
        .in("user_id", userIds),
      sb.from("org_license_seats")
        .select("user_id, org_licenses:license_id(product_id, products:product_id(title))")
        .in("user_id", userIds)
        .is("released_at", null),
    ]);

    const memberMap = new Map<string, any[]>();
    for (const m of membershipsRes.data ?? []) {
      const list = memberMap.get(m.user_id) || [];
      list.push(m);
      memberMap.set(m.user_id, list);
    }

    const seatMap = new Map<string, any[]>();
    for (const s of seatsRes.data ?? []) {
      const list = seatMap.get(s.user_id) || [];
      list.push(s);
      seatMap.set(s.user_id, list);
    }

    let result = users.map((u) => {
      const memberships = memberMap.get(u.id) || [];
      const seats = seatMap.get(u.id) || [];
      const primaryMembership = memberships.find((m: any) => m.status === 'active') || memberships[0];

      return {
        user_id: u.id,
        email: u.email || '',
        display_name: u.user_metadata?.display_name || u.user_metadata?.full_name || null,
        org_name: primaryMembership?.organizations?.name || null,
        org_id: primaryMembership?.org_id || null,
        role: primaryMembership?.role || null,
        seat_count: seats.length,
        active_products: seats.map((s: any) => s.org_licenses?.products?.title).filter(Boolean),
        status: u.banned_until ? 'deactivated' : 'active',
        last_sign_in_at: u.last_sign_in_at || null,
        created_at: u.created_at,
        source_type: u.app_metadata?.provider || 'manual',
      };
    });

    // Apply filters
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(u =>
        u.email.toLowerCase().includes(s) ||
        (u.display_name && u.display_name.toLowerCase().includes(s))
      );
    }
    if (orgId) result = result.filter(u => u.org_id === orgId);
    if (role) result = result.filter(u => u.role === role);

    return json({
      users: result,
      page,
      per_page: perPage,
      total: authList?.total ?? result.length,
    });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
