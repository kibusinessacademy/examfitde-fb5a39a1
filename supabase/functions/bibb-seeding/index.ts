import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BerufProfile {
  bibbId: string;
  bezeichnung: string;
  zustaendigkeit: string;
  ausbildungsdauerMonate: number;
  profilUrl: string;
  taetigkeitsprofil?: string;
  einsatzgebiete?: string[];
  verordnungUrl?: string;
  verordnungDatum?: string;
  verordnungTitel?: string;
  rahmenlehrplanUrl?: string;
  zeugniserlaeuterungUrls?: { de?: string; en?: string; fr?: string };
}

interface SeedingJob {
  action: 'list_berufe' | 'scrape_beruf' | 'scrape_all' | 'status';
  bibbId?: string;
  offset?: number;
  limit?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    if (action === 'status') {
      const { data: berufeCount } = await supabase
        .from('berufe')
        .select('id', { count: 'exact' });
      
      const { data: dokumenteCount } = await supabase
        .from('beruf_dokumente')
        .select('id', { count: 'exact' });

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            berufe: berufeCount?.length || 0,
            dokumente: dokumenteCount?.length || 0,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    
    if (link.includes('kmk.org') && link.includes('Rahmenlehrplan')) {
      rahmenlehrplanUrl = link;
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
    taetigkeitsprofil,
    einsatzgebiete: einsatzgebiete.length > 0 ? einsatzgebiete : undefined,
    verordnungUrl,
    verordnungDatum,
    verordnungTitel,
    rahmenlehrplanUrl,
    zeugniserlaeuterungUrls: Object.keys(zeugniserlaeuterungUrls).length > 0 ? zeugniserlaeuterungUrls : undefined,
  };
}
