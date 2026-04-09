/**
 * Admin Enterprise Data – Licenses, Seats, Organizations.
 * GET ?type=licenses|seats|organizations
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
    const type = url.searchParams.get("type");

    if (type === "licenses") {
      const { data, error } = await sb
        .from("org_licenses")
        .select("id, organization_id, product_id, seat_count, starts_at, ends_at, status, source_type, source_ref, organizations:organization_id(name), products:product_id(title)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);

      // Count used seats per license
      const { data: seatCounts } = await sb
        .from("org_license_seats")
        .select("license_id")
        .is("released_at", null);

      const countMap = new Map<string, number>();
      for (const s of seatCounts ?? []) {
        countMap.set(s.license_id, (countMap.get(s.license_id) || 0) + 1);
      }

      const licenses = (data ?? []).map((l: any) => {
        const used = countMap.get(l.id) || 0;
        return {
          license_id: l.id,
          org_id: l.organization_id,
          org_name: l.organizations?.name || null,
          product_id: l.product_id,
          product_title: l.products?.title || null,
          seats_total: l.seat_count,
          seats_used: used,
          seats_available: Math.max(0, l.seat_count - used),
          starts_at: l.starts_at,
          ends_at: l.ends_at,
          status: l.status,
          source_type: l.source_type,
          source_ref: l.source_ref,
        };
      });
      return json({ data: licenses });
    }

    if (type === "seats") {
      const { data, error } = await sb
        .from("org_license_seats")
        .select("id, license_id, user_id, claimed_at, released_at, org_licenses:license_id(product_id, organization_id, products:product_id(title), organizations:organization_id(name))")
        .order("claimed_at", { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);

      // Get user emails
      const userIds = [...new Set((data ?? []).map((s: any) => s.user_id))];
      const emailMap = new Map<string, { email: string; display_name: string | null }>();
      
      for (const uid of userIds) {
        const { data: u } = await sb.auth.admin.getUserById(uid);
        if (u?.user) {
          emailMap.set(uid, {
            email: u.user.email || '',
            display_name: u.user.user_metadata?.display_name || u.user.user_metadata?.full_name || null,
          });
        }
      }

      const seats = (data ?? []).map((s: any) => ({
        seat_id: s.id,
        license_id: s.license_id,
        user_id: s.user_id,
        email: emailMap.get(s.user_id)?.email || null,
        display_name: emailMap.get(s.user_id)?.display_name || null,
        product_title: s.org_licenses?.products?.title || null,
        org_name: s.org_licenses?.organizations?.name || null,
        claimed_at: s.claimed_at,
        released_at: s.released_at,
        status: s.released_at ? 'revoked' : 'active',
      }));
      return json({ data: seats });
    }

    if (type === "organizations") {
      const { data, error } = await sb
        .from("organizations")
        .select("id, name, org_type, created_at")
        .order("name");
      if (error) return json({ error: error.message }, 500);

      const [membersRes, licensesRes, seatsRes] = await Promise.all([
        sb.from("organization_members").select("organization_id"),
        sb.from("org_licenses").select("organization_id, seat_count, status").eq("status", "active"),
        sb.from("org_license_seats").select("org_licenses:license_id(organization_id)").is("released_at", null),
      ]);

      const memberCounts = new Map<string, number>();
      for (const m of membersRes.data ?? []) {
        memberCounts.set(m.organization_id, (memberCounts.get(m.organization_id) || 0) + 1);
      }

      const licenseData = new Map<string, { count: number; totalSeats: number }>();
      for (const l of licensesRes.data ?? []) {
        const existing = licenseData.get(l.organization_id) || { count: 0, totalSeats: 0 };
        existing.count++;
        existing.totalSeats += l.seat_count || 0;
        licenseData.set(l.organization_id, existing);
      }

      const usedSeatCounts = new Map<string, number>();
      for (const s of seatsRes.data ?? []) {
        const orgId = (s as any).org_licenses?.organization_id;
        if (orgId) usedSeatCounts.set(orgId, (usedSeatCounts.get(orgId) || 0) + 1);
      }

      const orgs = (data ?? []).map((o: any) => ({
        org_id: o.id,
        name: o.name,
        org_type: o.org_type,
        member_count: memberCounts.get(o.id) || 0,
        active_licenses: licenseData.get(o.id)?.count || 0,
        total_seats: licenseData.get(o.id)?.totalSeats || 0,
        used_seats: usedSeatCounts.get(o.id) || 0,
        created_at: o.created_at,
      }));
      return json({ data: orgs });
    }

    return json({ error: "type parameter required (licenses|seats|organizations)" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
