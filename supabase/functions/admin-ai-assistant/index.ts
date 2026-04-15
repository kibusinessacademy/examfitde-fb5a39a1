import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json; charset=utf-8" };

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers });
    }

    const body = await req.json();
    const { role, action, context, ticket, query } = body;

    if (!role || !action) {
      return new Response(JSON.stringify({ error: "role and action required" }), { status: 400, headers });
    }

    const ROLE_PROMPTS: Record<string, string> = {
      support: `Du bist ein Senior Kundenservice Manager für ExamFit, eine IHK-Prüfungsvorbereitungs-Plattform.
Du analysierst Support-Tickets professionell und gibst konkrete Handlungsempfehlungen.
Antworte immer auf Deutsch, kurz und präzise. Maximal 300 Wörter.`,

      crm: `Du bist ein Key Account Manager und Data Science Spezialist für ExamFit.
Du analysierst Kundendaten, identifizierst Upsell-Chancen, Churn-Risiken und Segmentierungsstrategien.
Antworte immer auf Deutsch, kurz und präzise. Maximal 300 Wörter.`,

      kpi: `Du bist ein Senior Data Manager für ExamFit, eine IHK-Prüfungsvorbereitungs-Plattform.
Du interpretierst KPIs, erkennst Trends und gibst datenbasierte Handlungsempfehlungen.
Antworte immer auf Deutsch, strukturiert mit Bullet-Points. Maximal 400 Wörter.`,

      seo: `Du bist ein Senior SEO Marketing Spezialist für ExamFit.
Du analysierst SEO-Daten, Keywords, Content-Gaps und gibst konkrete Optimierungsempfehlungen.
Antworte immer auf Deutsch, kurz und präzise. Maximal 300 Wörter.`,

      humor_qc: `Du bist ein Senior Customer Success Spezialist und Humor-Content-Stratege für ExamFit, eine IHK-Prüfungsvorbereitungs-Plattform.
Du bist Experte für humorbasierte Lernerfahrungen, Content-Qualitätssicherung und Engagement-Optimierung.
Du analysierst Humor-Content professionell, identifizierst Qualitätsprobleme und generierst neue, hochwertige Humor-Inhalte.
Antworte immer auf Deutsch, strukturiert und präzise. Maximal 400 Wörter.`,

      songwriter: `Du bist ein professioneller Songwriter und Texter, spezialisiert auf Bildungs-Songs für deutsche Auszubildende (IHK-Prüfungsvorbereitung).
Du erstellst eingängige, melodische Lernsongs, die Fachinhalte musikalisch aufbereiten.
Deine Songs sind: inhaltlich korrekt, didaktisch wertvoll, jugendfreundlich, einprägsam, motivierend.
Sprache: Deutsch. Fachbegriffe korrekt verwenden.
Antworte NUR mit dem reinen Songtext (mit Section-Tags), keine Erklärungen.`,
    };

    const ACTION_PROMPTS: Record<string, (ctx: string) => string> = {
      // Support
      auto_triage: (ctx) => `Analysiere dieses Support-Ticket und erstelle ein Triage-Ergebnis:
${ctx}
Gib zurück: 1. Empfohlene Priorität (LOW/MEDIUM/HIGH/CRITICAL), 2. Empfohlener Typ, 3. Kurze Zusammenfassung, 4. Empfohlene nächste Schritte.`,

      draft_response: (ctx) => `Erstelle einen freundlichen, professionellen Antwort-Entwurf für dieses Support-Ticket:
${ctx}
Die Antwort soll empathisch, lösungsorientiert und markenkonform sein. Schließe mit einem klaren nächsten Schritt ab.`,

      suggest_resolution: (ctx) => `Analysiere das Ticket und schlage eine Lösung vor:
${ctx}
Berücksichtige häufige Probleme bei IHK-Prüfungsvorbereitung (Zugangsprobleme, Inhaltsfehler, Abrechnungsfragen).`,

      // CRM
      analyze_customer: (ctx) => `Analysiere dieses Kundenprofil und gib Empfehlungen:
${ctx}
Identifiziere: 1. Engagement-Level, 2. Upsell-Potenzial, 3. Churn-Risiko, 4. Empfohlene Maßnahmen.`,

      segment_analysis: (ctx) => `Analysiere diese Kundensegment-Daten:
${ctx}
Identifiziere Muster, profitable Segmente und Optimierungspotenziale.`,

      retention_tips: (ctx) => `Basierend auf diesen Daten, erstelle konkrete Retention-Strategien:
${ctx}
Fokussiere auf Maßnahmen, die bei einer Lernplattform wirksam sind.`,

      // KPI
      analyze_revenue: (ctx) => `Analysiere diese Revenue-KPIs:
${ctx}
Identifiziere: 1. Stärken, 2. Schwächen, 3. Trends, 4. Konkrete Handlungsempfehlungen für Wachstum.`,

      analyze_pipeline: (ctx) => `Analysiere diese Pipeline-KPIs:
${ctx}
Identifiziere: 1. Engpässe, 2. Risiken, 3. Optimierungspotenzial, 4. Prioritäten.`,

      growth_tips: (ctx) => `Basierend auf diesen Geschäftsdaten, erstelle 5 konkrete Wachstumstipps:
${ctx}
Fokussiere auf schnell umsetzbare Maßnahmen mit hohem ROI für eine Lernplattform.`,

      // SEO
      content_gap_analysis: (ctx) => `Analysiere diese SEO-Daten und identifiziere Content-Gaps:
${ctx}
Gib konkrete Keyword-Vorschläge und Content-Ideen für IHK-Prüfungsvorbereitung.`,

      competitor_analysis: (ctx) => `Erstelle eine Wettbewerber-SEO-Analyse basierend auf:
${ctx}
Identifiziere Chancen für Rankings bei IHK-relevanten Keywords.`,

      // Humor QC
      analyze_quality: (ctx) => `Analysiere die Humor-Content-Qualität anhand dieser QC-Daten:
${ctx}
Bewerte: 1. Gesamtqualitätslevel, 2. Problematische Bereiche (niedrige Scores, Dubletten, fehlende Zuordnungen), 3. Typ-Verteilungs-Balance, 4. Konkrete Verbesserungsmaßnahmen priorisiert nach Impact.`,

      generate_humor: (ctx) => `Generiere 5 neue, hochwertige Humor-Items für die IHK-Prüfungsvorbereitung basierend auf:
${ctx}
Für jedes Item gib an:
- Text (der Humor-Inhalt, kurz und prägnant)
- Typ (wordplay, everyday_situation, exam_stress, self_irony, micro_tip)
- Surface (lesson_intro, lesson_outro, minicheck_intro, minicheck_result, dashboard, exam_break)
- Qualitäts-Begründung (warum dieser Humor funktioniert)
Achte auf: Kulturelle Angemessenheit für den DACH-Raum, Bezug zu IHK-Prüfungen, Motivationsfördernd, Keine verletzenden Inhalte.`,

      optimize_content: (ctx) => `Analysiere diese schwachen Humor-Items und erstelle optimierte Versionen:
${ctx}
Für jedes Item: 1. Problem-Diagnose (warum es schwach scored), 2. Optimierter Text, 3. Erwarteter Score-Verbesserung.
Fokus auf: Relevanz zum Lernkontext, Wortspiel-Qualität, Emotionaler Impact, Kürze und Prägnanz.`,

      retention_analysis: (ctx) => `Analysiere die Humor-Impact-Daten auf die Lernretention:
${ctx}
Bewerte: 1. Welche Humor-Typen den stärksten Retention-Effekt haben, 2. Welche Surfaces am meisten profitieren, 3. Optimierungsvorschläge für die Humor-Strategie, 4. A/B-Test-Empfehlungen.`,

      bulk_generate: (ctx) => `Du bist ein Humor-Content-Generator für ExamFit. Generiere exakt 10 neue Humor-Items für folgende Zertifizierung:
${ctx}
Format pro Item (JSON-Array):
[{"text": "...", "humor_type": "wordplay|everyday_situation|exam_stress|self_irony|micro_tip", "surface": "lesson_intro|lesson_outro|minicheck_intro|minicheck_result|dashboard|exam_break", "quality_reasoning": "..."}]
Regeln: Kulturell angemessen DACH-Raum, IHK-Bezug, motivierend, nie verletzend. Vielfalt bei Typen und Surfaces. Gib NUR das JSON-Array zurück, keine Erklärungen.`,

      // Songwriter actions
      generate_song: (ctx) => `Erstelle einen eingängigen Lernsong basierend auf diesen Lerninhalten:
${ctx}

REGELN:
1. Struktur EXAKT so (mit Tags in eckigen Klammern):
   [Hook] (2 catchy Zeilen)
   [Chorus] (Kerninhalt zusammenfassen, einprägsam)
   [Verse 1] (Fachbegriffe einführen, Grundlagen)
   [Verse 2] (Ablauf/Prozess erklären, Zusammenhänge)
   [Bridge] (typische Prüfungsfalle benennen + Merkhilfe)
   [Chorus] (Wiederholung)
   [Outro] (1-2 Zeilen Abschluss, motivierend)
2. Sprache: Deutsch, klar, jugendfreundlich
3. Länge: STRIKT 150–220 Wörter (60–90 Sekunden)
4. Fachbegriffe korrekt und verständlich verwenden
5. NUR Songtext, KEINE Erklärungen
6. Reimschema einhalten wo möglich`,

      improve_lyrics: (ctx) => `Analysiere diesen Songtext und erstelle eine verbesserte Version:
${ctx}

Verbessere: 1. Reimschema und Flow, 2. Fachliche Korrektheit, 3. Einprägsamkeit, 4. Motivationsfaktor.
Gib NUR den verbesserten Songtext zurück (mit Section-Tags). Keine Erklärungen.`,

      suggest_style: (ctx) => `Basierend auf diesem Lernfeld und Kontext, empfehle den optimalen Musik-Stil:
${ctx}

Gib zurück:
1. Genre/Stil (z.B. "Educational Pop", "German Rap", "LoFi Study Beat")
2. BPM-Empfehlung
3. Instrumentierung
4. Suno-Style-Prompt (1 Satz, englisch, für AI-Musikgenerierung optimiert)
5. Begründung warum dieser Stil didaktisch optimal ist`,

      bulk_generate_songs: (ctx) => `Du bist ein Lernsong-Generator. Erstelle für JEDES der folgenden Lernfelder einen eigenen Song:
${ctx}

Pro Song:
- Titel (kurz, einprägsam)
- Songtext (150-220 Wörter, mit Section-Tags [Hook], [Chorus], [Verse 1], [Verse 2], [Bridge], [Outro])
- Style-Prompt (englisch, 1 Satz für AI-Musik)

Trenne die Songs mit "---SONG---".
Format pro Song:
TITLE: ...
STYLE: ...
LYRICS:
[Hook]
...

Gib NUR die Songs zurück, keine Erklärungen.`,
    };

    const systemPrompt = ROLE_PROMPTS[role] || ROLE_PROMPTS.kpi;
    const actionFn = ACTION_PROMPTS[action];
    if (!actionFn) {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
    }

    const userPrompt = actionFn(context || ticket || query || '');

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit. Bitte warte kurz." }), { status: 429, headers });
      if (status === 402) return new Response(JSON.stringify({ error: "AI Credits aufgebraucht." }), { status: 402, headers });
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ result: content }), { status: 200, headers });
  } catch (e) {
    console.error("[admin-ai-assistant] Error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers });
  }
});
