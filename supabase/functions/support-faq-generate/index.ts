import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handleCorsPreflightRequest(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY");

    if (!deepseekApiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find resolved tickets without FAQ entries
    const { data: resolvedTickets } = await adminClient
      .from("support_tickets")
      .select("id, subject, description, category, ticket_type, resolution_notes, context_course_id")
      .eq("status", "resolved")
      .not("resolution_notes", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(10);

    if (!resolvedTickets || resolvedTickets.length === 0) {
      return new Response(JSON.stringify({ message: "No resolved tickets to process", generated: 0 }), {
        headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    // Check which already have FAQ
    const existingFaqTickets = new Set<string>();
    const { data: existingFaq } = await adminClient
      .from("support_faq")
      .select("source_ticket_id")
      .not("source_ticket_id", "is", null);
    existingFaq?.forEach(f => existingFaqTickets.add(f.source_ticket_id!));

    const newTickets = resolvedTickets.filter(t => !existingFaqTickets.has(t.id));
    if (newTickets.length === 0) {
      return new Response(JSON.stringify({ message: "All resolved tickets already have FAQ entries", generated: 0 }), {
        headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
      });
    }

    let generated = 0;

    for (const ticket of newTickets.slice(0, 5)) {
      const prompt = `Erstelle aus diesem gelösten Support-Ticket einen FAQ-Eintrag.

Ticket-Typ: ${ticket.ticket_type || ticket.category}
Betreff: ${ticket.subject}
Beschreibung: ${ticket.description}
Lösung: ${ticket.resolution_notes}

Erstelle:
1. Eine klare, kurze Frage (wie ein Azubi sie stellen würde)
2. Eine prüfungsnahe Antwort (max 3-5 Sätze, mit konkreter Handlungsempfehlung)

Antworte im Format:
FRAGE: [Frage]
ANTWORT: [Antwort]`;

      const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
      if (!DEEPSEEK_API_KEY) continue;

      const aiResponse = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "Du bist ein IHK-Prüfungsexperte. Erstelle FAQ-Einträge die Azubis sofort helfen." },
            { role: "user", content: prompt },
          ],
          max_tokens: 300,
        }),
      });

      if (!aiResponse.ok) continue;

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "";

      const questionMatch = content.match(/FRAGE:\s*(.+?)(?:\n|ANTWORT:)/s);
      const answerMatch = content.match(/ANTWORT:\s*(.+)/s);

      if (questionMatch && answerMatch) {
        await adminClient.from("support_faq").insert({
          question: questionMatch[1].trim(),
          answer: answerMatch[1].trim(),
          ticket_type: ticket.ticket_type || ticket.category || "general",
          course_id: ticket.context_course_id,
          source_ticket_id: ticket.id,
          is_published: false, // Needs admin approval
        });
        generated++;
      }
    }

    // Also classify tickets for feedback loop
    for (const ticket of newTickets.slice(0, 5)) {
      const classifications = [];
      const lower = (ticket.description || "").toLowerCase();

      if (["verstehe nicht", "unklar", "erklär", "was bedeutet"].some(w => lower.includes(w))) {
        classifications.push("understanding_gap");
      }
      if (["fehler", "bug", "geht nicht", "funktioniert nicht", "laden"].some(w => lower.includes(w))) {
        classifications.push("technical_problem");
      }
      if (["didaktik", "lernmaterial", "lektion", "inhalt"].some(w => lower.includes(w))) {
        classifications.push("didactic_problem");
      }
      if (classifications.length === 0) classifications.push("unclear_question");

      for (const cls of classifications) {
        await adminClient.from("support_feedback_loop").insert({
          ticket_id: ticket.id,
          classification: cls,
          affected_course_id: ticket.context_course_id,
          improvement_type: cls === "understanding_gap" ? "better_explanation" :
                           cls === "didactic_problem" ? "new_minicheck" :
                           cls === "technical_problem" ? "fix_content" : null,
        });
      }
    }

    return new Response(JSON.stringify({ generated, processed: newTickets.length }), {
      headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("support-faq-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" }
    });
  }
});
