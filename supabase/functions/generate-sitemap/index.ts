// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SITE_URL = "https://examfit.de";

interface SitemapURL {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: Array<{
    loc: string;
    title?: string;
    caption?: string;
  }>;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateSitemapXML(urls: SitemapURL[]): string {
  const urlEntries = urls
    .map((url) => {
      let entry = `  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n`;

      if (url.lastmod) {
        entry += `    <lastmod>${url.lastmod}</lastmod>\n`;
      }
      if (url.changefreq) {
        entry += `    <changefreq>${url.changefreq}</changefreq>\n`;
      }
      if (url.priority !== undefined) {
        entry += `    <priority>${url.priority.toFixed(1)}</priority>\n`;
      }

      // Image sitemap extension
      if (url.images && url.images.length > 0) {
        url.images.forEach((img) => {
          entry += `    <image:image>\n`;
          entry += `      <image:loc>${escapeXml(img.loc)}</image:loc>\n`;
          if (img.title) {
            entry += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
          }
          if (img.caption) {
            entry += `      <image:caption>${escapeXml(img.caption)}</image:caption>\n`;
          }
          entry += `    </image:image>\n`;
        });
      }

      entry += `  </url>`;
      return entry;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlEntries}
</urlset>`;
}

function generateSlug(text: string): string {
  const charMap: Record<string, string> = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    ß: "ss",
    Ä: "ae",
    Ö: "oe",
    Ü: "ue",
  };

  return text
    .toLowerCase()
    .split("")
    .map((char) => charMap[char] || char)
    .join("")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];
    const urls: SitemapURL[] = [];

    // Static pages (highest priority)
    const staticPages = [
      { path: "/", priority: 1.0, changefreq: "daily" },
      { path: "/berufe", priority: 0.9, changefreq: "weekly" },
      { path: "/ihk-pruefungen", priority: 0.9, changefreq: "weekly" },
      { path: "/lernkurse", priority: 0.9, changefreq: "weekly" },
      { path: "/pruefungstrainer", priority: 0.9, changefreq: "weekly" },
      { path: "/bundle", priority: 0.9, changefreq: "weekly" },
      { path: "/shop", priority: 0.8, changefreq: "weekly" },
      { path: "/wissen", priority: 0.8, changefreq: "daily" },
      { path: "/blog", priority: 0.8, changefreq: "daily" },
      { path: "/preise", priority: 0.7, changefreq: "monthly" },
      { path: "/unternehmen", priority: 0.6, changefreq: "monthly" },
      // ExamFit@work routes
      { path: "/work", priority: 0.9, changefreq: "weekly" },
      { path: "/work/corporate", priority: 0.7, changefreq: "monthly" },
    ];

    staticPages.forEach((page) => {
      urls.push({
        loc: `${SITE_URL}${page.path}`,
        lastmod: today,
        changefreq: page.changefreq,
        priority: page.priority,
      });
    });

    // Berufe from database
    const { data: berufe } = await supabase
      .from("berufe")
      .select("id, bezeichnung_kurz, updated_at, ist_aktiv")
      .eq("ist_aktiv", true);

    if (berufe) {
      for (const beruf of berufe) {
        const slug = generateSlug(beruf.bezeichnung_kurz);
        const lastmod = beruf.updated_at?.split("T")[0] || today;

        // Beruf detail page
        urls.push({
          loc: `${SITE_URL}/berufe/${slug}`,
          lastmod,
          changefreq: "weekly",
          priority: 0.8,
        });

        // Product pages for each beruf
        ["lernkurs", "pruefungstrainer", "bundle"].forEach((product) => {
          urls.push({
            loc: `${SITE_URL}/${product}/${slug}`,
            lastmod,
            changefreq: "weekly",
            priority: 0.7,
          });
        });

        // IHK Prüfung page
        urls.push({
          loc: `${SITE_URL}/ihk-pruefungen/${slug}`,
          lastmod,
          changefreq: "weekly",
          priority: 0.7,
        });
      }
    }

    // Published courses
    const { data: courses } = await supabase
      .from("courses")
      .select("id, title, updated_at, thumbnail_url")
      .eq("status", "published");

    if (courses) {
      courses.forEach((course) => {
        const slug = generateSlug(course.title);
        const images: SitemapURL["images"] = [];

        if (course.thumbnail_url) {
          images.push({
            loc: course.thumbnail_url.startsWith("http")
              ? course.thumbnail_url
              : `${SITE_URL}${course.thumbnail_url}`,
            title: `${course.title} - Kursvorschau`,
            caption: `Lernkurs für ${course.title} IHK-Prüfungsvorbereitung`,
          });
        }

        urls.push({
          loc: `${SITE_URL}/kurse/${course.id}`,
          lastmod: course.updated_at?.split("T")[0] || today,
          changefreq: "weekly",
          priority: 0.7,
          images: images.length > 0 ? images : undefined,
        });
      });
    }

    // Store products
    const { data: products } = await supabase
      .from("store_products")
      .select("id, name, updated_at, image_url")
      .eq("is_active", true);

    if (products) {
      products.forEach((product) => {
        const slug = generateSlug(product.name);
        const images: SitemapURL["images"] = [];

        if (product.image_url) {
          images.push({
            loc: product.image_url.startsWith("http")
              ? product.image_url
              : `${SITE_URL}${product.image_url}`,
            title: product.name,
            caption: `${product.name} - ExamFit Produkt`,
          });
        }

        urls.push({
          loc: `${SITE_URL}/shop/${slug}`,
          lastmod: product.updated_at?.split("T")[0] || today,
          changefreq: "weekly",
          priority: 0.6,
          images: images.length > 0 ? images : undefined,
        });
      });
    }

    // Curricula products
    const { data: curriculumProducts } = await supabase
      .from("curriculum_products")
      .select("slug, updated_at, product_id")
      .eq("is_published", true)
      .not("slug", "is", null);

    if (curriculumProducts) {
      curriculumProducts.forEach((cp) => {
        if (cp.slug) {
          urls.push({
            loc: `${SITE_URL}/produkt/${cp.slug}`,
            lastmod: cp.updated_at?.split("T")[0] || today,
            changefreq: "weekly",
            priority: 0.6,
          });
        }
      });
    }

    // Prüfungstraining Hub + Category pages
    const pruefungstrainingPages = [
      { path: "/pruefungstraining", priority: 0.9, changefreq: "weekly" },
      { path: "/pruefungstraining/ausbildung", priority: 0.8, changefreq: "weekly" },
      { path: "/pruefungstraining/fachwirt", priority: 0.8, changefreq: "weekly" },
      { path: "/pruefungstraining/meister", priority: 0.8, changefreq: "weekly" },
      { path: "/pruefungstraining/betriebswirt", priority: 0.8, changefreq: "weekly" },
      { path: "/pruefungstraining/sachkunde", priority: 0.8, changefreq: "weekly" },
      { path: "/pruefungstraining/aevo", priority: 0.8, changefreq: "weekly" },
    ];

    pruefungstrainingPages.forEach((page) => {
      urls.push({
        loc: `${SITE_URL}${page.path}`,
        lastmod: today,
        changefreq: page.changefreq,
        priority: page.priority,
      });
    });

    // Prüfungstraining detail pages from certification_catalog
    const { data: certCatalog } = await supabase
      .from("certification_catalog")
      .select("id, title, slug, updated_at")
      .not("slug", "is", null);

    if (certCatalog) {
      certCatalog.forEach((cert) => {
        if (cert.slug) {
          urls.push({
            loc: `${SITE_URL}/pruefungstraining/${cert.slug}`,
            lastmod: cert.updated_at?.split("T")[0] || today,
            changefreq: "weekly",
            priority: 0.7,
          });
        }
      });
    }

    // Published SEO documents (blog, landing, faq, glossary, cluster)
    const { data: seoDocs } = await supabase
      .from("seo_documents")
      .select("slug, doc_type, updated_at, meta_title, og_image_path")
      .eq("status", "published");

    if (seoDocs) {
      const docTypeUrlMap: Record<string, string> = {
        blog: "/wissen",
        landing: "/pruefungstraining",
        faq: "/faq",
        glossary: "/glossar",
        product: "/produkt",
        cluster: "/wissen",
      };

      seoDocs.forEach((doc) => {
        const basePath = docTypeUrlMap[doc.doc_type] || "/wissen";
        const images: SitemapURL["images"] = [];

        if (doc.og_image_path) {
          images.push({
            loc: doc.og_image_path.startsWith("http")
              ? doc.og_image_path
              : `${SITE_URL}${doc.og_image_path}`,
            title: doc.meta_title || doc.slug,
          });
        }

        urls.push({
          loc: `${SITE_URL}${basePath}/${doc.slug}`,
          lastmod: doc.updated_at?.split("T")[0] || today,
          changefreq: "weekly",
          priority: doc.doc_type === "landing" ? 0.8 : 0.6,
          images: images.length > 0 ? images : undefined,
        });
      });
    }

    // Published blog articles
    const { data: blogArticles } = await supabase
      .from("blog_articles")
      .select("slug, title, updated_at, hero_image_url, hero_image_alt, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(200);

    if (blogArticles) {
      blogArticles.forEach((article) => {
        const images: SitemapURL["images"] = [];

        if (article.hero_image_url) {
          images.push({
            loc: article.hero_image_url.startsWith("http")
              ? article.hero_image_url
              : `${SITE_URL}${article.hero_image_url}`,
            title: article.title,
            caption: article.hero_image_alt || undefined,
          });
        }

        urls.push({
          loc: `${SITE_URL}/blog/${article.slug}`,
          lastmod: article.updated_at?.split("T")[0] || article.published_at?.split("T")[0] || today,
          changefreq: "weekly",
          priority: 0.7,
          images: images.length > 0 ? images : undefined,
        });
      });
    }

    // Generate the XML sitemap
    const sitemapXML = generateSitemapXML(urls);

    // Cache the sitemap
    const cacheHeaders = {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "application/xml; charset=utf-8",
    };

    return new Response(sitemapXML, {
      status: 200,
      headers: { ...corsHeaders, ...cacheHeaders },
    });
  } catch (error) {
    console.error("Sitemap generation error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate sitemap" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
