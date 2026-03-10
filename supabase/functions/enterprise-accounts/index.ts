// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[ENTERPRISE-ACCOUNTS] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: verify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) throw new Error("Not authenticated");

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'create_account';

    // ========== CREATE ENTERPRISE ACCOUNT ==========
    if (action === 'create_account') {
      const body = await req.json();
      const {
        package_id,
        seat_id,
        username,
        password,
        first_name,
        last_name,
        personnel_number,
        email,
      } = body;

      if (!package_id || !seat_id || !username || !password || !first_name || !last_name) {
        throw new Error("Missing required fields: package_id, seat_id, username, password, first_name, last_name");
      }

      // Verify package ownership
      const { data: pkg, error: pkgError } = await adminClient
        .from('license_packages')
        .select('*')
        .eq('id', package_id)
        .single();

      if (pkgError || !pkg) throw new Error("Package not found");
      if (pkg.buyer_user_id !== user.id) throw new Error("Not authorized");
      if (pkg.status !== 'active') throw new Error("Package not active");

      // Verify seat
      const { data: seat, error: seatError } = await adminClient
        .from('license_seats')
        .select('*')
        .eq('id', seat_id)
        .eq('package_id', package_id)
        .single();

      if (seatError || !seat) throw new Error("Seat not found in package");
      if (seat.assigned_user_id) throw new Error("Seat already assigned");

      // Check username uniqueness
      const { data: existingUser } = await adminClient
        .from('profiles')
        .select('id')
        .eq('login_username', username.toLowerCase().trim())
        .maybeSingle();

      if (existingUser) throw new Error("Username already taken");

      // Create auth user with internal email (username-based login)
      const internalEmail = email || `${username.toLowerCase().trim()}@managed.examfit.internal`;

      const { data: newAuthUser, error: authError } = await adminClient.auth.admin.createUser({
        email: internalEmail,
        password: password,
        email_confirm: true, // auto-confirm managed accounts
        user_metadata: {
          full_name: `${first_name} ${last_name}`,
          login_username: username.toLowerCase().trim(),
          managed_account: true,
          company_id: pkg.company_id || null,
        },
      });

      if (authError || !newAuthUser?.user) {
        throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
      }

      const newUserId = newAuthUser.user.id;
      logStep("Auth user created", { newUserId, username });

      // Update profile
      await adminClient.from('profiles').upsert({
        id: newUserId,
        user_id: newUserId,
        full_name: `${first_name} ${last_name}`,
        login_username: username.toLowerCase().trim(),
        personnel_number: personnel_number || null,
        company_id: pkg.company_id || null,
        managed_account: true,
      });

      // Assign seat
      await adminClient.from('license_seats').update({
        assigned_user_id: newUserId,
        assigned_at: new Date().toISOString(),
        licensee_first_name: first_name,
        licensee_last_name: last_name,
        licensee_personnel_number: personnel_number || null,
      }).eq('id', seat_id);

      // Get product for entitlement
      const { data: product } = await adminClient
        .from('store_products')
        .select('*')
        .eq('id', pkg.product_id)
        .single();

      // Create entitlement
      if (product) {
        await adminClient.from('entitlements').insert({
          user_id: newUserId,
          seat_id: seat_id,
          curriculum_id: pkg.curriculum_id,
          has_learning_course: product.includes_learning_course,
          has_exam_trainer: product.includes_exam_trainer,
          has_ai_tutor: product.includes_ai_tutor,
          has_oral_trainer: product.includes_oral_trainer,
          valid_until: pkg.expires_at,
        });
      }

      logStep("Enterprise account fully created", { newUserId, seatId: seat_id });

      return new Response(JSON.stringify({
        success: true,
        user_id: newUserId,
        username: username.toLowerCase().trim(),
        email: internalEmail,
        seat_id: seat_id,
        message: "Account created and seat assigned",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ========== BATCH CREATE ==========
    if (action === 'batch_create') {
      const body = await req.json();
      const { package_id, accounts } = body;

      if (!package_id || !Array.isArray(accounts) || accounts.length === 0) {
        throw new Error("Missing package_id or accounts array");
      }

      // Verify package ownership
      const { data: pkg } = await adminClient
        .from('license_packages')
        .select('*')
        .eq('id', package_id)
        .eq('buyer_user_id', user.id)
        .single();

      if (!pkg) throw new Error("Package not found or not authorized");

      // Get unassigned seats
      const { data: availableSeats } = await adminClient
        .from('license_seats')
        .select('id')
        .eq('package_id', package_id)
        .is('assigned_user_id', null)
        .order('created_at')
        .limit(accounts.length);

      if (!availableSeats || availableSeats.length < accounts.length) {
        throw new Error(`Not enough unassigned seats. Available: ${availableSeats?.length || 0}, Requested: ${accounts.length}`);
      }

      const { data: product } = await adminClient
        .from('store_products')
        .select('*')
        .eq('id', pkg.product_id)
        .single();

      const results: Array<Record<string, unknown>> = [];

      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const seatId = availableSeats[i].id;

        try {
          const username = acc.username.toLowerCase().trim();
          const internalEmail = acc.email || `${username}@managed.examfit.internal`;

          const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
            email: internalEmail,
            password: acc.password,
            email_confirm: true,
            user_metadata: {
              full_name: `${acc.first_name} ${acc.last_name}`,
              login_username: username,
              managed_account: true,
            },
          });

          if (createErr || !newUser?.user) {
            results.push({ username, status: 'error', error: createErr?.message || 'Create failed' });
            continue;
          }

          const uid = newUser.user.id;

          await adminClient.from('profiles').upsert({
            id: uid, user_id: uid,
            full_name: `${acc.first_name} ${acc.last_name}`,
            login_username: username,
            personnel_number: acc.personnel_number || null,
            company_id: pkg.company_id || null,
            managed_account: true,
          });

          await adminClient.from('license_seats').update({
            assigned_user_id: uid,
            assigned_at: new Date().toISOString(),
            licensee_first_name: acc.first_name,
            licensee_last_name: acc.last_name,
            licensee_personnel_number: acc.personnel_number || null,
          }).eq('id', seatId);

          if (product) {
            await adminClient.from('entitlements').insert({
              user_id: uid,
              seat_id: seatId,
              curriculum_id: pkg.curriculum_id,
              has_learning_course: product.includes_learning_course,
              has_exam_trainer: product.includes_exam_trainer,
              has_ai_tutor: product.includes_ai_tutor,
              has_oral_trainer: product.includes_oral_trainer,
              valid_until: pkg.expires_at,
            });
          }

          results.push({
            username, status: 'created', user_id: uid, seat_id: seatId,
            login_email: internalEmail,
            first_name: acc.first_name, last_name: acc.last_name,
          });
        } catch (e) {
          results.push({ username: acc.username, status: 'error', error: String(e) });
        }
      }

      logStep("Batch create completed", { total: accounts.length, created: results.filter(r => r.status === 'created').length });

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ========== EXPORT LOGIN DATA (for PDF generation on frontend) ==========
    if (action === 'export_login_data') {
      const packageId = url.searchParams.get('package_id');
      if (!packageId) throw new Error("Missing package_id");

      const { data: pkg } = await adminClient
        .from('license_packages')
        .select('*, curricula:curriculum_id(title)')
        .eq('id', packageId)
        .eq('buyer_user_id', user.id)
        .single();

      if (!pkg) throw new Error("Package not found or not authorized");

      const { data: seats } = await adminClient
        .from('license_seats')
        .select('id, assigned_user_id, licensee_first_name, licensee_last_name, licensee_personnel_number, assigned_at')
        .eq('package_id', packageId)
        .not('assigned_user_id', 'is', null);

      if (!seats || seats.length === 0) {
        return new Response(JSON.stringify({ accounts: [], curriculum_title: (pkg as any).curricula?.title }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      // Get profiles with usernames
      const userIds = seats.map(s => s.assigned_user_id).filter(Boolean);
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('user_id, login_username, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const accounts = seats.map(s => {
        const profile = profileMap.get(s.assigned_user_id);
        return {
          first_name: s.licensee_first_name,
          last_name: s.licensee_last_name,
          username: profile?.login_username || '-',
          personnel_number: s.licensee_personnel_number,
          assigned_at: s.assigned_at,
        };
      });

      return new Response(JSON.stringify({
        accounts,
        curriculum_title: (pkg as any).curricula?.title,
        company: pkg.billing_company,
        expires_at: pkg.expires_at,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
