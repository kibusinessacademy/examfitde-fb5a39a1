import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface BerufProfile {
  bibbId: string;
  bezeichnung: string;
  zustaendigkeit: string;
  ausbildungsdauerMonate: number;
  profilUrl: string;
  dqrNiveau?: number;
  taetigkeitsprofil?: string;
  einsatzgebiete?: string[];
  verordnungUrl?: string;
  verordnungDatum?: string;
  verordnungTitel?: string;
  rahmenlehrplanUrl?: string;
  zeugniserlaeuterungUrls?: { de?: string; en?: string; fr?: string };
}

interface SeedingJob {
  action: 'list_berufe' | 'scrape_beruf' | 'scrape_all' | 'status' | 'enrich_missing' | 'scrape_kmk' | 'import_curriculum_for_beruf' | 'import_curricula_batch';
  bibbId?: string;
  berufId?: string;
  offset?: number;
  limit?: number;
}

// Known DQR levels by profession type (fallback mapping)
const DQR_MAPPINGS: Record<string, number> = {
  'IH': 4,   // Industrie- und Handelskammer
  'Hw': 4,   // Handwerk
  'ÖD': 4,   // Öffentlicher Dienst
  'Fr': 4,   // Freie Berufe
  'Lw': 4,   // Landwirtschaft
  'HwEx': 4, // Handwerk (früher)
};

// KMK Rahmenlehrplan URL patterns
const KMK_BASE_URL = 'https://www.kmk.org/fileadmin/Dateien/pdf/Bildung/BerufsbildendeSchulen/rlp/';

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  // Require admin role to run BIBB seeding (expensive external API calls)
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: SeedingJob = await req.json();
    const { action } = body;

    console.log(`[User: ${auth.user?.id}] BIBB seeding action: ${action}`);

    if (action === 'status') {
      // Extended status with missing data counts
      const { data: berufeData, count: berufeCount } = await supabase
        .from('berufe')
        .select('id, dqr_niveau, rahmenlehrplan_url', { count: 'exact' });
      
      const { count: dokumenteCount } = await supabase
        .from('beruf_dokumente')
        .select('id', { count: 'exact' });

      const missingDqr = berufeData?.filter(b => !b.dqr_niveau).length || 0;
      const missingRlp = berufeData?.filter(b => !b.rahmenlehrplan_url).length || 0;

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            berufe: berufeCount || 0,
            dokumente: dokumenteCount || 0,
            missingDqr,
            missingRlp,
            completeness: {
              dqr: berufeCount ? Math.round(((berufeCount - missingDqr) / berufeCount) * 100) : 0,
              rahmenlehrplan: berufeCount ? Math.round(((berufeCount - missingRlp) / berufeCount) * 100) : 0,
            }
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'enrich_missing') {
      // Find all berufe missing DQR or Rahmenlehrplan
      const { data: berufeToEnrich, error: fetchError } = await supabase
        .from('berufe')
        .select('id, bibb_id, bezeichnung_kurz, zustaendigkeit, dqr_niveau, rahmenlehrplan_url, bibb_profil_url')
        .or('dqr_niveau.is.null,rahmenlehrplan_url.is.null')
        .limit(body.limit || 50);

      if (fetchError) {
        return new Response(
          JSON.stringify({ success: false, error: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const results: Array<{ bibbId: string; status: string; updates: Record<string, any> }> = [];

      for (const beruf of berufeToEnrich || []) {
        const updates: Record<string, any> = {};
        let status = 'no_changes';

        // 1. Try to set DQR niveau if missing
        if (!beruf.dqr_niveau) {
          // First try scraping the profile for DQR info
          try {
            const dqrFromProfile = await scrapeDqrFromProfile(
              beruf.bibb_profil_url || `https://www.bibb.de/dienst/berufesuche/de/index_berufesuche.php/profile/apprenticeship/${beruf.bibb_id}`,
              FIRECRAWL_API_KEY
            );
            
            if (dqrFromProfile) {
              updates.dqr_niveau = dqrFromProfile;
            } else {
              // Fallback to mapping based on Zuständigkeit
              updates.dqr_niveau = DQR_MAPPINGS[beruf.zustaendigkeit] || 4;
            }
            status = 'enriched';
          } catch (err) {
            console.error(`DQR scrape error for ${beruf.bibb_id}:`, err);
            // Use fallback
            updates.dqr_niveau = DQR_MAPPINGS[beruf.zustaendigkeit] || 4;
            status = 'fallback_used';
          }
        }

        // 2. Try to find Rahmenlehrplan if missing
        if (!beruf.rahmenlehrplan_url) {
          try {
            const rlpUrl = await findRahmenlehrplanUrl(
              beruf.bezeichnung_kurz,
              beruf.bibb_profil_url || `https://www.bibb.de/dienst/berufesuche/de/index_berufesuche.php/profile/apprenticeship/${beruf.bibb_id}`,
              FIRECRAWL_API_KEY
            );
            
            if (rlpUrl) {
              updates.rahmenlehrplan_url = rlpUrl;
              status = 'enriched';

              // Also add as document
              await supabase
                .from('beruf_dokumente')
                .upsert({
                  beruf_id: beruf.id,
                  dokument_typ: 'rahmenlehrplan',
                  titel: 'KMK-Rahmenlehrplan',
                  url: rlpUrl,
                }, {
                  onConflict: 'beruf_id,dokument_typ,url',
                  ignoreDuplicates: true,
                });
            }
          } catch (err) {
            console.error(`RLP scrape error for ${beruf.bibb_id}:`, err);
          }
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          
          const { error: updateError } = await supabase
            .from('berufe')
            .update(updates)
            .eq('id', beruf.id);

          if (updateError) {
            console.error(`Update error for ${beruf.bibb_id}:`, updateError);
            status = 'update_failed';
          }
        }

        results.push({
          bibbId: beruf.bibb_id,
          status,
          updates,
        });

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      return new Response(
        JSON.stringify({
          success: true,
          processed: results.length,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'scrape_kmk') {
      // Scrape KMK page to get all available Rahmenlehrplan links
      const kmkUrl = 'https://www.kmk.org/themen/berufliche-schulen/duale-berufsausbildung/downloadbereich-rahmenlehrplaene.html';
      
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: kmkUrl,
          formats: ['markdown', 'links'],
          onlyMainContent: true,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: data.error || 'Firecrawl error' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const links = data.data?.links || [];
      const rlpLinks = links.filter((link: string) => 
        link.includes('.pdf') && 
        (link.includes('rlp') || link.includes('Rahmenlehrplan') || link.includes('RLP'))
      );

      // Parse profession names from links
      const rlpMap: Record<string, string> = {};
      for (const link of rlpLinks) {
        // Extract profession name from URL
        const match = link.match(/\/([^\/]+)\.pdf$/i);
        if (match) {
          const filename = match[1];
          // Clean up filename to get profession name
          const cleanName = filename
            .replace(/rlp|RLP|Rahmenlehrplan/gi, '')
            .replace(/_/g, ' ')
            .replace(/-/g, ' ')
            .trim();
          
          if (cleanName.length > 3) {
            rlpMap[cleanName.toLowerCase()] = link;
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          totalLinks: rlpLinks.length,
          rlpMap,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─────────── Import curriculum for a single beruf ───────────
    if (action === 'import_curriculum_for_beruf') {
      const berufId = body.berufId;
      if (!berufId) {
        return new Response(JSON.stringify({ success: false, error: 'berufId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: beruf } = await supabase.from('berufe').select('id, bezeichnung_kurz, rahmenlehrplan_url').eq('id', berufId).single();
      if (!beruf) return new Response(JSON.stringify({ success: false, error: 'Beruf not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (!beruf.rahmenlehrplan_url) return new Response(JSON.stringify({ success: false, error: 'No rahmenlehrplan_url for this Beruf' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Beruf-first dedup: check if ANY active (non-archived) curriculum exists for this beruf
      const { data: existing } = await supabase.from('curricula').select('id, status').eq('beruf_id', berufId).not('status', 'eq', 'archived').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (existing) return new Response(JSON.stringify({ success: true, message: `Already has ${existing.status} curriculum for this Beruf`, curriculumId: existing.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Create curriculum
      const { data: curr, error: cErr } = await supabase.from('curricula').insert({
        title: `Rahmenlehrplan ${beruf.bezeichnung_kurz}`,
        beruf_id: beruf.id,
        status: 'draft',
        import_source: 'bibb_auto',
        created_by: auth.user?.id,
      }).select('id').single();

      if (cErr || !curr) return new Response(JSON.stringify({ success: false, error: cErr?.message || 'Failed to create curriculum' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Call curriculum-import edge function (use internal shared secret, not service-role bearer)
      const internalSecret = Deno.env.get('EDGE_INTERNAL_SHARED_SECRET') || '';
      const importRes = await fetch(`${supabaseUrl}/functions/v1/curriculum-import`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          'x-job-runner-key': internalSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'import', curriculumId: curr.id, sourceUrl: beruf.rahmenlehrplan_url }),
      });

      const importData = await importRes.json();
      return new Response(JSON.stringify({ success: importData.success, berufId: beruf.id, curriculumId: curr.id, counts: importData.counts, error: importData.error }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─────────── Batch import curricula for all berufe ───────────
    if (action === 'import_curricula_batch') {
      const internalSecret = Deno.env.get('EDGE_INTERNAL_SHARED_SECRET') || '';
      const importRes = await fetch(`${supabaseUrl}/functions/v1/curriculum-import`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          'x-job-runner-key': internalSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'batch', limit: body.limit || 10 }),
      });

      const importData = await importRes.json();
      return new Response(JSON.stringify(importData), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'list_berufe') {
      // Scrape the BIBB legal_basis page to get all profession links
      const listUrl = 'https://www.bibb.de/de/berufeinfo.php/legal_basis/';
      
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: listUrl,
          formats: ['markdown', 'links'],
          onlyMainContent: true,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: data.error || 'Firecrawl error' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract profession links from the scraped content
      const links = data.data?.links || [];
      const berufLinks = links.filter((link: string) => 
        link.includes('/profile/apprenticeship/')
      );

      // Parse links to extract BIBB IDs and names
      const berufe = berufLinks.map((link: string) => {
        const match = link.match(/\/apprenticeship\/([^\/\?#]+)/);
        return {
          bibbId: match ? match[1] : null,
          profilUrl: link,
        };
      }).filter((b: any) => b.bibbId);

      return new Response(
        JSON.stringify({
          success: true,
          count: berufe.length,
          berufe: berufe.slice(body.offset || 0, (body.offset || 0) + (body.limit || 50)),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'scrape_beruf') {
      const { bibbId } = body;
      if (!bibbId) {
        return new Response(
          JSON.stringify({ success: false, error: 'bibbId required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const profilUrl = `https://www.bibb.de/dienst/berufesuche/de/index_berufesuche.php/profile/apprenticeship/${bibbId}`;
      
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: profilUrl,
          formats: ['markdown', 'links', 'html'],
          onlyMainContent: true,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: data.error || 'Firecrawl error' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = data.data?.markdown || '';
      const links = data.data?.links || [];
      const html = data.data?.html || '';

      // Parse profession data from markdown
      const profile = parseBerufProfile(markdown, links, html, bibbId, profilUrl);

      // Upsert into berufe table
      const { data: beruf, error: berufError } = await supabase
        .from('berufe')
        .upsert({
          bibb_id: profile.bibbId,
          bezeichnung_kurz: profile.bezeichnung,
          zustaendigkeit: profile.zustaendigkeit,
          ausbildungsdauer_monate: profile.ausbildungsdauerMonate,
          bibb_profil_url: profile.profilUrl,
          dqr_niveau: profile.dqrNiveau,
          taetigkeitsprofil: profile.taetigkeitsprofil,
          einsatzgebiete: profile.einsatzgebiete,
          verordnung_pdf_url: profile.verordnungUrl,
          verordnung_datum: profile.verordnungDatum,
          verordnung_titel: profile.verordnungTitel,
          rahmenlehrplan_url: profile.rahmenlehrplanUrl,
        }, {
          onConflict: 'bibb_id',
        })
        .select()
        .single();

      if (berufError) {
        console.error('Beruf upsert error:', berufError);
        return new Response(
          JSON.stringify({ success: false, error: berufError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Insert documents
      const dokumente = [];
      
      if (profile.verordnungUrl) {
        dokumente.push({
          beruf_id: beruf.id,
          dokument_typ: 'ausbildungsverordnung',
          titel: profile.verordnungTitel || 'Ausbildungsverordnung',
          url: profile.verordnungUrl,
          gueltig_ab: profile.verordnungDatum,
        });
      }

      if (profile.rahmenlehrplanUrl) {
        dokumente.push({
          beruf_id: beruf.id,
          dokument_typ: 'rahmenlehrplan',
          titel: 'KMK-Rahmenlehrplan',
          url: profile.rahmenlehrplanUrl,
        });
      }

      if (profile.zeugniserlaeuterungUrls?.de) {
        dokumente.push({
          beruf_id: beruf.id,
          dokument_typ: 'zeugniserlaeuterung',
          titel: 'Zeugniserläuterung',
          url: profile.zeugniserlaeuterungUrls.de,
          sprache: 'de',
        });
      }

      if (profile.zeugniserlaeuterungUrls?.en) {
        dokumente.push({
          beruf_id: beruf.id,
          dokument_typ: 'zeugniserlaeuterung',
          titel: 'Certificate Supplement',
          url: profile.zeugniserlaeuterungUrls.en,
          sprache: 'en',
        });
      }

      if (profile.zeugniserlaeuterungUrls?.fr) {
        dokumente.push({
          beruf_id: beruf.id,
          dokument_typ: 'zeugniserlaeuterung',
          titel: 'Supplément au certificat',
          url: profile.zeugniserlaeuterungUrls.fr,
          sprache: 'fr',
        });
      }

      if (dokumente.length > 0) {
        // Delete existing documents for this beruf first
        await supabase
          .from('beruf_dokumente')
          .delete()
          .eq('beruf_id', beruf.id);

        const { error: dokError } = await supabase
          .from('beruf_dokumente')
          .insert(dokumente);

        if (dokError) {
          console.error('Dokumente insert error:', dokError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          beruf: beruf,
          dokumenteCount: dokumente.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'scrape_all') {
      // First get the list of all professions
      const listUrl = 'https://www.bibb.de/de/berufeinfo.php/legal_basis/';
      
      const listResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: listUrl,
          formats: ['links'],
          onlyMainContent: true,
        }),
      });

      const listData = await listResponse.json();
      
      if (!listResponse.ok) {
        return new Response(
          JSON.stringify({ success: false, error: listData.error || 'Firecrawl error' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const links = listData.data?.links || [];
      const berufLinks = links.filter((link: string) => 
        link.includes('/profile/apprenticeship/')
      );

      // Extract unique BIBB IDs
      const bibbIds = [...new Set(berufLinks.map((link: string) => {
        const match = link.match(/\/apprenticeship\/([^\/\?#]+)/);
        return match ? match[1] : null;
      }).filter(Boolean))];

      // Check which ones we already have
      const { data: existingBerufe } = await supabase
        .from('berufe')
        .select('bibb_id');

      const existingIds = new Set(existingBerufe?.map(b => b.bibb_id) || []);
      const newIds = bibbIds.filter(id => !existingIds.has(id));

      return new Response(
        JSON.stringify({
          success: true,
          totalFound: bibbIds.length,
          alreadyImported: existingIds.size,
          pendingImport: newIds.length,
          bibbIds: newIds,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper: Scrape DQR niveau from BIBB profile page
async function scrapeDqrFromProfile(profilUrl: string, apiKey: string): Promise<number | null> {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: profilUrl,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const markdown = data.data?.markdown || '';

  // Look for DQR mentions
  const dqrPatterns = [
    /DQR[:\s-]*Niveau[:\s]*(\d)/i,
    /DQR[:\s]*(\d)/i,
    /Qualifikationsniveau[:\s]*(\d)/i,
    /Niveau[:\s]*(\d)[:\s]*\(DQR\)/i,
    /Level[:\s]*(\d)/i,
  ];

  for (const pattern of dqrPatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const niveau = parseInt(match[1], 10);
      if (niveau >= 1 && niveau <= 8) {
        return niveau;
      }
    }
  }

  return null;
}

// Helper: Find Rahmenlehrplan URL by scraping BIBB profile or searching KMK
async function findRahmenlehrplanUrl(
  berufName: string, 
  profilUrl: string, 
  apiKey: string
): Promise<string | null> {
  // First try to find in BIBB profile
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: profilUrl,
      formats: ['links'],
      onlyMainContent: true,
    }),
  });

  if (response.ok) {
    const data = await response.json();
    const links = data.data?.links || [];
    
    // Look for KMK or Rahmenlehrplan links
    for (const link of links) {
      if (
        (link.includes('kmk.org') && link.includes('.pdf')) ||
        (link.includes('rahmenlehrplan') && link.includes('.pdf')) ||
        (link.includes('RLP') && link.includes('.pdf'))
      ) {
        return link;
      }
    }
  }

  // Try direct KMK search
  const cleanName = berufName
    .replace(/\(m\/w\/d\)/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  
  const possibleUrls = [
    `${KMK_BASE_URL}${cleanName}.pdf`,
    `${KMK_BASE_URL}rlp_${cleanName}.pdf`,
  ];

  // We can't easily verify URLs without making requests, so just return null
  // The actual URL might need manual verification
  return null;
}

function parseBerufProfile(
  markdown: string, 
  links: string[], 
  html: string,
  bibbId: string,
  profilUrl: string
): BerufProfile {
  // Extract title
  const titleMatch = markdown.match(/^#\s*([^\n]+)/m);
  let bezeichnung = titleMatch ? titleMatch[1].replace(/\(Ausbildung\)/g, '').trim() : bibbId;
  
  // Clean up the title - remove male/female variants
  bezeichnung = bezeichnung.split('/')[0].trim();

  // Extract Zuständigkeitsbereich and Duration from table
  let zustaendigkeit = 'IH';
  let ausbildungsdauerMonate = 36;
  let dqrNiveau: number | undefined;

  const tableMatch = markdown.match(/\|\s*Zuständigkeitsbereich\s*\|\s*Ausbildungsdauer\s*\|[\s\S]*?\|\s*(\w+)\s*\|\s*(\d+)\s*Monate\s*\|/i);
  if (tableMatch) {
    zustaendigkeit = tableMatch[1];
    ausbildungsdauerMonate = parseInt(tableMatch[2], 10);
  } else {
    // Alternative parsing
    const zuMatch = markdown.match(/Zuständigkeitsbereich[:\s]+(\w+)/i);
    if (zuMatch) zustaendigkeit = zuMatch[1];
    
    const dauerMatch = markdown.match(/(\d+)\s*Monate/);
    if (dauerMatch) ausbildungsdauerMonate = parseInt(dauerMatch[1], 10);
  }

  // Extract DQR Niveau
  const dqrPatterns = [
    /DQR[:\s-]*Niveau[:\s]*(\d)/i,
    /DQR[:\s]*(\d)/i,
    /Qualifikationsniveau[:\s]*(\d)/i,
  ];

  for (const pattern of dqrPatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const niveau = parseInt(match[1], 10);
      if (niveau >= 1 && niveau <= 8) {
        dqrNiveau = niveau;
        break;
      }
    }
  }

  // Fallback DQR based on Zuständigkeit if not found
  if (!dqrNiveau) {
    dqrNiveau = DQR_MAPPINGS[zustaendigkeit] || 4;
  }

  // Extract Tätigkeitsprofil
  const taetigkeitMatch = markdown.match(/Berufliche Tätigkeitsfelder[\s\S]*?([^#]+?)(?=###|$)/i);
  const taetigkeitsprofil = taetigkeitMatch ? taetigkeitMatch[1].trim().substring(0, 500) : undefined;

  // Extract Einsatzgebiete
  const einsatzgebiete: string[] = [];
  const einsatzMatch = markdown.match(/Einsatzgebiete[\s\S]*?(?:###|$)/i);
  if (einsatzMatch) {
    const lines = einsatzMatch[0].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('Einsatzgebiete')) {
        einsatzgebiete.push(trimmed);
      }
    }
  }

  // Find document URLs
  let verordnungUrl: string | undefined;
  let verordnungTitel: string | undefined;
  let verordnungDatum: string | undefined;
  let rahmenlehrplanUrl: string | undefined;
  const zeugniserlaeuterungUrls: { de?: string; en?: string; fr?: string } = {};

  for (const link of links) {
    if (link.includes('/regulation/') && link.endsWith('.pdf') && !link.includes('zeugniserlaeuterung')) {
      if (!verordnungUrl) {
        verordnungUrl = link;
        // Try to extract title and date from markdown
        const voMatch = markdown.match(/Verordnung[^\n]+vom\s+(\d{2}\.\d{2}\.\d{4})/i);
        if (voMatch) {
          verordnungDatum = voMatch[1].split('.').reverse().join('-');
        }
      }
    }
    
    // Enhanced Rahmenlehrplan detection
    if (
      (link.includes('kmk.org') && link.includes('.pdf')) ||
      (link.toLowerCase().includes('rahmenlehrplan') && link.includes('.pdf')) ||
      (link.includes('/rlp/') && link.includes('.pdf'))
    ) {
      if (!rahmenlehrplanUrl) {
        rahmenlehrplanUrl = link;
      }
    }

    if (link.includes('certificate_supplement')) {
      if (link.includes('/de/') || link.includes('_d.pdf')) {
        zeugniserlaeuterungUrls.de = link;
      } else if (link.includes('/en/') || link.includes('_e.pdf')) {
        zeugniserlaeuterungUrls.en = link;
      } else if (link.includes('/fr/') || link.includes('_f.pdf')) {
        zeugniserlaeuterungUrls.fr = link;
      }
    }
  }

  // Extract Verordnungstitel
  const voTitelMatch = markdown.match(/\[([^\]]+Verordnung[^\]]+)\]/i);
  if (voTitelMatch) {
    verordnungTitel = voTitelMatch[1];
  }

  return {
    bibbId,
    bezeichnung,
    zustaendigkeit,
    ausbildungsdauerMonate,
    profilUrl,
    dqrNiveau,
    taetigkeitsprofil,
    einsatzgebiete: einsatzgebiete.length > 0 ? einsatzgebiete : undefined,
    verordnungUrl,
    verordnungDatum,
    verordnungTitel,
    rahmenlehrplanUrl,
    zeugniserlaeuterungUrls: Object.keys(zeugniserlaeuterungUrls).length > 0 ? zeugniserlaeuterungUrls : undefined,
  };
}
