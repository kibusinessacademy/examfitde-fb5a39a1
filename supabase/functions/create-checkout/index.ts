// Deno.serve is built-in
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
};

interface CheckoutRequest {
  product_key: 'learning_course' | 'exam_trainer' | 'bundle';
  curriculum_id: string;
  quantity: number;
  // Billing recipient (may differ from logged-in buyer)
  billing_email?: string;
  billing_name?: string;
  billing_company?: string;
  billing_vat_id?: string;
  billing_address?: Record<string, string>;
  // Whether the buyer is also a licensee (gets first seat)
  buyer_is_licensee?: boolean;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user?.email) {
      throw new Error("User not authenticated or email not available");
    }
    logStep("User authenticated", { userId: user.id });

    // Parse request
    const body = await req.json() as CheckoutRequest;
    const {
      product_key,
      curriculum_id,
      quantity,
      billing_email,
      billing_name,
      billing_company,
      billing_vat_id,
      billing_address,
      buyer_is_licensee = true,
    } = body;

    if (!product_key || !curriculum_id || !quantity || quantity < 1) {
      throw new Error("Missing required fields: product_key, curriculum_id, quantity");
    }

    // Bundle-only hardening: legacy product keys are deactivated.
    // One curriculum = one bundle = one purchase path.
    if (product_key !== 'bundle') {
      logStep("Rejected non-bundle product_key", { product_key });
      throw new Error(`Only 'bundle' is purchasable. Received: ${product_key}`);
    }

    logStep("Request parsed", { product_key, curriculum_id, quantity, buyer_is_licensee });

    // Get product and price from DB
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: product, error: productError } = await adminClient
      .from('store_products')
      .select('id, name, stripe_product_id')
      .eq('product_key', product_key)
      .eq('is_active', true)
      .single();

    if (productError || !product) {
      throw new Error(`Product not found: ${product_key}`);
    }
    logStep("Product found", { productId: product.id, name: product.name });

    // Calculate price based on quantity tier
    const { data: priceData, error: priceError } = await adminClient
      .rpc('calculate_product_price', {
        p_product_id: product.id,
        p_quantity: quantity
      });

    if (priceError || !priceData || priceData.length === 0) {
      throw new Error("Could not calculate price");
    }

    const { unit_price_cents, total_price_cents, tier_name } = priceData[0];
    logStep("Price calculated", { unit_price_cents, total_price_cents, tier_name, quantity });

    // Get curriculum info
    const { data: curriculum, error: curriculumError } = await adminClient
      .from('curricula')
      .select('title')
      .eq('id', curriculum_id)
      .single();

    if (curriculumError || !curriculum) {
      throw new Error(`Curriculum not found: ${curriculum_id}`);
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Determine the billing email: use explicit billing_email if provided, else user.email
    const effectiveBillingEmail = billing_email || user.email;

    // Check for existing Stripe customer by billing email
    const customers = await stripe.customers.list({ email: effectiveBillingEmail, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing customer found", { customerId });
    }

    // Create checkout session
    const sessionOrigin = req.headers.get("origin") || "https://examfitde.lovable.app";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : effectiveBillingEmail,
      customer_creation: customerId ? undefined : 'always',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product: product.stripe_product_id,
            unit_amount: unit_price_cents,
          },
          quantity: quantity,
        },
      ],
      mode: "payment",
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Lizenz: ${product.name} (${quantity}x) - ${curriculum.title}`,
          metadata: {
            user_id: user.id,
            product_id: product.id,
            curriculum_id: curriculum_id,
          },
          footer: 'Vielen Dank für Ihren Kauf! Zugang: 12 Monate ab Kaufdatum.',
        },
      },
      success_url: `${sessionOrigin}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${sessionOrigin}/shop?canceled=true`,
      billing_address_collection: 'required',
      // Store all billing + buyer metadata for webhook processing
      metadata: {
        user_id: user.id,
        product_id: product.id,
        product_key: product_key,
        curriculum_id: curriculum_id,
        quantity: quantity.toString(),
        unit_price_cents: unit_price_cents.toString(),
        tier_name: tier_name,
        buyer_is_licensee: buyer_is_licensee ? 'true' : 'false',
        billing_email: effectiveBillingEmail,
        billing_name: billing_name || '',
        billing_company: billing_company || '',
        billing_vat_id: billing_vat_id || '',
        billing_address: billing_address ? JSON.stringify(billing_address) : '',
      },
      payment_intent_data: {
        metadata: {
          user_id: user.id,
          product_id: product.id,
          curriculum_id: curriculum_id,
          quantity: quantity.toString(),
        },
      },
    });

    logStep("Checkout session created", {
      sessionId: session.id,
      totalAmount: total_price_cents,
      quantity,
      tier_name,
      buyer_is_licensee,
    });

    return new Response(
      JSON.stringify({
        url: session.url,
        session_id: session.id,
        total_price_cents,
        unit_price_cents,
        quantity,
        tier_name,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
