import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
};

interface CheckoutRequest {
  product_key: 'learning_course' | 'exam_trainer' | 'bundle';
  curriculum_id: string;
  quantity: number;
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Parse request
    const { product_key, curriculum_id, quantity } = await req.json() as CheckoutRequest;
    
    if (!product_key || !curriculum_id || !quantity || quantity < 1) {
      throw new Error("Missing required fields: product_key, curriculum_id, quantity");
    }
    logStep("Request parsed", { product_key, curriculum_id, quantity });

    // Get product and price from DB
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

    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing customer found", { customerId });
    }

    // Create checkout session with calculated price and automatic invoicing
    const sessionOrigin = req.headers.get("origin") || "https://examfitde.lovable.app";
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
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
      // Enable automatic invoice creation for B2B compliance
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
      // Collect billing address for invoices
      billing_address_collection: 'required',
      metadata: {
        user_id: user.id,
        product_id: product.id,
        product_key: product_key,
        curriculum_id: curriculum_id,
        quantity: quantity.toString(),
        unit_price_cents: unit_price_cents.toString(),
        tier_name: tier_name,
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
      tier_name 
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