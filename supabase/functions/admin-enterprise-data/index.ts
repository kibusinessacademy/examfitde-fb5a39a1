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

    // ─── Licenses ───
    if (type === "licenses") {
      const { data, error } = await sb
        .from("org_licenses")
        .select("id, org_id, product_id, seat_count, seats_used, starts_at, ends_at, status, contract_ref, organizations:org_id(name), products:product_id(title)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);

      // Derive actual used seats from org_license_seats (SSOT)
      const licenseIds = (data ?? []).map((l: any) => l.id);
      const { data: seatCounts } = await sb
        .from("org_license_seats")
        .select("license_id")
        .in("license_id", licenseIds)
        .is("released_at", null);

      const countMap = new Map<string, number>();
      for (const s of seatCounts ?? []) {
        countMap.set(s.license_id, (countMap.get(s.license_id) || 0) + 1);
      }

      const licenses = (data ?? []).map((l: any) => {
        const used = countMap.get(l.id) || 0;
        return {
          license_id: l.id,
          org_id: l.org_id,
          org_name: l.organizations?.name || null,
          product_id: l.product_id,
          product_title: l.products?.title || null,
          seats_total: l.seat_count,
          seats_used: used,
          seats_available: Math.max(0, l.seat_count - used),
          starts_at: l.starts_at,
          ends_at: l.ends_at,
          status: l.status,
          contract_ref: l.contract_ref || null,
        };
      });
      return json({ data: licenses });
    }

    // ─── Seats ───
    if (type === "seats") {
      const { data, error } = await sb
        .from("org_license_seats")
        .select("id, license_id, user_id, claimed_at, released_at, org_licenses:license_id(product_id, org_id, products:product_id(title), organizations:org_id(name))")
        .order("claimed_at", { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);

      // Batch-fetch user info via profiles + learner_identities (no N+1)
      const userIds = [...new Set((data ?? []).map((s: any) => s.user_id))];
      const emailMap = new Map<string, { email: string; display_name: string | null }>();

      if (userIds.length > 0) {
        // Try profiles first (much cheaper than auth.admin per-user)
        const { data: profiles } = await sb
          .from("profiles")
          .select("id, display_name, email")
          .in("id", userIds);

        for (const p of profiles ?? []) {
          emailMap.set(p.id, {
            email: p.email || '',
            display_name: p.display_name || null,
          });
        }

        // For any users not in profiles, batch via learner_identities
        const missing = userIds.filter(uid => !emailMap.has(uid));
        if (missing.length > 0) {
          const { data: identities } = await sb
            .from("learner_identities")
            .select("user_id, display_name")
            .in("user_id", missing);

          for (const li of identities ?? []) {
            if (!emailMap.has(li.user_id)) {
              emailMap.set(li.user_id, {
                email: '',
                display_name: li.display_name || null,
              });
            }
          }
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

    // ─── Organizations ───
    if (type === "organizations") {
      const { data, error } = await sb
        .from("organizations")
        .select("id, name, org_type, created_at, is_active")
        .order("name");
      if (error) return json({ error: error.message }, 500);

      const orgIds = (data ?? []).map((o: any) => o.id);

      const [membersRes, licensesRes, seatsRes] = await Promise.all([
        sb.from("org_memberships").select("org_id").in("org_id", orgIds),
        sb.from("org_licenses").select("org_id, seat_count, status").in("org_id", orgIds).eq("status", "active"),
        sb.from("org_license_seats")
          .select("org_licenses:license_id(org_id)")
          .is("released_at", null),
      ]);

      const memberCounts = new Map<string, number>();
      for (const m of membersRes.data ?? []) {
        memberCounts.set(m.org_id, (memberCounts.get(m.org_id) || 0) + 1);
      }

      const licenseData = new Map<string, { count: number; totalSeats: number }>();
      for (const l of licensesRes.data ?? []) {
        const existing = licenseData.get(l.org_id) || { count: 0, totalSeats: 0 };
        existing.count++;
        existing.totalSeats += l.seat_count || 0;
        licenseData.set(l.org_id, existing);
      }

      const usedSeatCounts = new Map<string, number>();
      for (const s of seatsRes.data ?? []) {
        const oid = (s as any).org_licenses?.org_id;
        if (oid) usedSeatCounts.set(oid, (usedSeatCounts.get(oid) || 0) + 1);
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
        is_active: o.is_active ?? true,
      }));
      return json({ data: orgs });
    }

    return json({ error: "type parameter required (licenses|seats|organizations)" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
