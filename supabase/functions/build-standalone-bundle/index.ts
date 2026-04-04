/**
 * build-standalone-bundle
 *
 * Takes a completed standalone snapshot and packages it into a
 * self-contained ZIP bundle with an offline player shell.
 *
 * Input: { package_id, version_tag, snapshot_artifact_id? }
 * Output: ZIP uploaded to storage, artifact record updated.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "standalone-bundles";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { package_id, version_tag } = body;

    if (!package_id || !version_tag) {
      return json({ error: "Missing required: package_id, version_tag" }, 400);
    }

    console.log(`[bundle] Starting bundle for package=${package_id} version=${version_tag}`);

    // ── 1. Locate snapshot artifact ──
    const { data: snapshotArtifact, error: snapErr } = await sb
      .from("standalone_artifact_versions")
      .select("id, storage_path, checksum_sha256, metadata, build_status")
      .eq("package_id", package_id)
      .eq("artifact_kind", "snapshot")
      .eq("version_tag", version_tag)
      .eq("build_status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapErr || !snapshotArtifact) {
      return json({ error: "No completed snapshot found for this package/version" }, 404);
    }

    // ── 2. Download snapshot from storage ──
    const { data: snapshotFile, error: dlErr } = await sb.storage
      .from(BUCKET)
      .download(snapshotArtifact.storage_path);

    if (dlErr || !snapshotFile) {
      return json({ error: `Snapshot download failed: ${dlErr?.message || "not found"}` }, 500);
    }

    const snapshotText = await snapshotFile.text();
    let snapshot: any;
    try {
      snapshot = JSON.parse(snapshotText);
    } catch {
      return json({ error: "Snapshot JSON is not parseable" }, 422);
    }

    // ── FAIL-CLOSED: validate snapshot ──
    if (!snapshot.lessons || snapshot.lessons.length === 0) {
      return json({ error: "Snapshot contains zero lessons — cannot build bundle" }, 422);
    }
    if (!snapshot.meta || !snapshot.course) {
      return json({ error: "Snapshot missing meta or course data" }, 422);
    }

    console.log(`[bundle] Snapshot loaded: ${snapshot.lessons.length} lessons, ${snapshot.course.modules?.length || 0} modules`);

    // ── 3. Create bundle artifact record ──
    const { data: bundleArtifact } = await sb
      .from("standalone_artifact_versions")
      .upsert({
        package_id,
        course_id: snapshot.meta.course_id,
        curriculum_id: snapshot.meta.curriculum_id || null,
        artifact_kind: "bundle",
        version_tag,
        build_status: "processing",
        source_step: "build_standalone_bundle",
      }, { onConflict: "package_id,artifact_kind,version_tag" })
      .select("id")
      .single();

    const artifactId = bundleArtifact?.id;

    // ── 4. Collect warnings ──
    const warnings: string[] = [];
    const snapshotMeta = snapshot.meta as any;
    const contentProvenance: Record<string, number> = {};
    for (const l of snapshot.lessons) {
      const s = l.source_status || "unknown";
      contentProvenance[s] = (contentProvenance[s] || 0) + 1;
    }
    if ((contentProvenance["draft"] || 0) > 0) {
      warnings.push(`${contentProvenance["draft"]}_lessons_from_draft`);
    }
    if (!snapshot.handbook?.chapters?.length) {
      warnings.push("handbook_empty");
    }
    if (!snapshot.minichecks?.length) {
      warnings.push("no_minichecks");
    }

    // ── 5. Build manifest ──
    const manifest = {
      schema_version: "1.0.0",
      artifact_type: "standalone_bundle",
      version_tag,
      course_id: snapshot.meta.course_id,
      package_id,
      title: snapshot.meta.course_title || snapshot.course.title || "ExamFit Kurs",
      generated_at: new Date().toISOString(),
      entrypoint: "index.html",
      snapshot_path: "snapshot.json",
      player: {
        name: "examfit-standalone-player",
        version: "1.0.0",
      },
      stats: {
        modules: snapshot.course.modules?.length || 0,
        lessons: snapshot.lessons.length,
        minicheck_groups: snapshot.minichecks?.length || 0,
        handbook_chapters: snapshot.handbook?.chapters?.length || 0,
        warnings,
      },
      content_provenance: contentProvenance,
      snapshot_checksum: snapshotArtifact.checksum_sha256,
    };

    // ── 6. Build ZIP ──
    const zip = new JSZip();

    // Manifest
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // Snapshot data
    zip.file("snapshot.json", snapshotText);

    // Player shell
    zip.file("index.html", PLAYER_HTML);
    const appDir = zip.folder("assets/app")!;
    appDir.file("player.js", PLAYER_JS);
    appDir.file("player.css", PLAYER_CSS);

    // Checksums
    const checksumEntries: Record<string, string> = {};
    const filesToHash: Array<{ path: string; content: string }> = [
      { path: "manifest.json", content: JSON.stringify(manifest, null, 2) },
      { path: "snapshot.json", content: snapshotText },
      { path: "index.html", content: PLAYER_HTML },
      { path: "assets/app/player.js", content: PLAYER_JS },
      { path: "assets/app/player.css", content: PLAYER_CSS },
    ];

    for (const f of filesToHash) {
      const hash = await sha256(f.content);
      checksumEntries[f.path] = hash;
    }
    zip.file("checksums.json", JSON.stringify(checksumEntries, null, 2));

    // ── 7. Generate ZIP bytes ──
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipChecksum = await sha256Bytes(zipBytes);

    console.log(`[bundle] ZIP built: ${zipBytes.length} bytes, sha256=${zipChecksum.slice(0, 12)}...`);

    // ── 8. Upload ZIP ──
    const storagePath = `bundles/${package_id}/${version_tag}/bundle.zip`;
    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, zipBytes, {
        contentType: "application/zip",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[bundle] Upload error:", uploadErr);
      await markFailed(sb, artifactId, `Upload failed: ${uploadErr.message}`);
      return json({ error: "ZIP upload failed", detail: uploadErr.message }, 500);
    }

    // ── 9. Generate signed URL ──
    const { data: signed } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600);

    // ── 10. Update artifact ──
    await sb
      .from("standalone_artifact_versions")
      .update({
        build_status: "completed",
        storage_bucket: BUCKET,
        storage_path: storagePath,
        mime_type: "application/zip",
        checksum_sha256: zipChecksum,
        size_bytes: zipBytes.length,
        metadata: {
          ...manifest.stats,
          content_provenance: contentProvenance,
          readiness: determineReadiness(snapshot, warnings),
          snapshot_artifact_id: snapshotArtifact.id,
          file_count: Object.keys(checksumEntries).length,
        },
      })
      .eq("id", artifactId);

    console.log(`[bundle] ✅ Bundle completed: ${storagePath} (${zipBytes.length} bytes)`);

    return json({
      ok: true,
      artifact_id: artifactId,
      storage_path: storagePath,
      download_url: signed?.signedUrl || null,
      checksum: zipChecksum,
      size_bytes: zipBytes.length,
      stats: manifest.stats,
      content_provenance: contentProvenance,
      warnings,
    });
  } catch (err: any) {
    console.error("[bundle] Error:", err);
    return json({ error: err.message }, 500);
  }
});

// ── Helpers ──

function determineReadiness(snapshot: any, warnings: string[]): string {
  const lessons = snapshot.lessons || [];
  if (lessons.length === 0) return "blocked";
  const allApproved = lessons.every((l: any) => l.source_status === "approved");
  if (allApproved && warnings.length === 0) return "playable_verified";
  if (warnings.length === 0) return "playable";
  return "playable_with_gaps";
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return sha256Bytes(bytes);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function markFailed(sb: any, artifactId: string | undefined, reason: string) {
  if (!artifactId) return;
  await sb
    .from("standalone_artifact_versions")
    .update({
      build_status: "failed",
      metadata: { error: reason, failed_at: new Date().toISOString() },
    })
    .eq("id", artifactId);
}

// ═══════════════════════════════════════════════════
// INLINE PLAYER SHELL (v1.0.0)
// ═══════════════════════════════════════════════════

const PLAYER_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ExamFit Standalone</title>
  <link rel="stylesheet" href="assets/app/player.css">
</head>
<body>
  <div id="app">
    <nav id="sidebar">
      <div class="sidebar-header">
        <h1 id="course-title">ExamFit</h1>
        <button id="toggle-sidebar" aria-label="Menu">☰</button>
      </div>
      <div id="module-nav"></div>
      <div class="sidebar-footer">
        <div id="progress-bar"><div id="progress-fill"></div></div>
        <span id="progress-text">0%</span>
      </div>
    </nav>
    <main id="content">
      <div id="lesson-header">
        <span id="lesson-breadcrumb"></span>
        <h2 id="lesson-title"></h2>
      </div>
      <article id="lesson-body"></article>
      <div id="minicheck-container"></div>
      <div id="lesson-nav">
        <button id="prev-btn" class="nav-btn">← Zurück</button>
        <button id="next-btn" class="nav-btn">Weiter →</button>
      </div>
    </main>
  </div>
  <script src="assets/app/player.js"><\/script>
</body>
</html>`;

const PLAYER_CSS = `/* ExamFit Standalone Player v1.0.0 */
:root {
  --ef-primary: #2563eb;
  --ef-primary-light: #dbeafe;
  --ef-bg: #f8fafc;
  --ef-surface: #ffffff;
  --ef-text: #1e293b;
  --ef-text-secondary: #64748b;
  --ef-border: #e2e8f0;
  --ef-success: #22c55e;
  --ef-error: #ef4444;
  --ef-sidebar-w: 280px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--ef-bg); color: var(--ef-text); line-height: 1.6; }
#app { display: flex; min-height: 100vh; }
/* Sidebar */
#sidebar { width: var(--ef-sidebar-w); background: var(--ef-surface); border-right: 1px solid var(--ef-border); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; overflow-y: auto; z-index: 10; transition: transform .2s; }
.sidebar-header { padding: 1rem; border-bottom: 1px solid var(--ef-border); display: flex; align-items: center; gap: .5rem; }
.sidebar-header h1 { font-size: 1.1rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#toggle-sidebar { display: none; background: none; border: none; font-size: 1.4rem; cursor: pointer; }
#module-nav { flex: 1; overflow-y: auto; padding: .5rem 0; }
.mod-group { margin-bottom: .25rem; }
.mod-title { padding: .5rem 1rem; font-size: .8rem; font-weight: 600; color: var(--ef-text-secondary); text-transform: uppercase; letter-spacing: .04em; }
.lesson-link { display: block; padding: .4rem 1rem .4rem 1.5rem; font-size: .9rem; color: var(--ef-text); text-decoration: none; cursor: pointer; border-left: 3px solid transparent; transition: background .15s; }
.lesson-link:hover { background: var(--ef-primary-light); }
.lesson-link.active { border-left-color: var(--ef-primary); background: var(--ef-primary-light); font-weight: 500; }
.lesson-link.completed::before { content: '✓ '; color: var(--ef-success); }
.sidebar-footer { padding: .75rem 1rem; border-top: 1px solid var(--ef-border); }
#progress-bar { height: 6px; background: var(--ef-border); border-radius: 3px; overflow: hidden; margin-bottom: .25rem; }
#progress-fill { height: 100%; background: var(--ef-primary); width: 0; transition: width .3s; }
#progress-text { font-size: .75rem; color: var(--ef-text-secondary); }
/* Main content */
#content { flex: 1; margin-left: var(--ef-sidebar-w); padding: 2rem 2.5rem; max-width: 52rem; }
#lesson-header { margin-bottom: 1.5rem; }
#lesson-breadcrumb { font-size: .8rem; color: var(--ef-text-secondary); }
#lesson-title { font-size: 1.5rem; margin-top: .25rem; }
#lesson-body { font-size: 1rem; }
#lesson-body h1,#lesson-body h2,#lesson-body h3 { margin: 1.25em 0 .5em; }
#lesson-body p { margin: .75em 0; }
#lesson-body ul,#lesson-body ol { margin: .75em 0; padding-left: 1.5em; }
#lesson-body img { max-width: 100%; border-radius: 6px; margin: 1rem 0; }
#lesson-body table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
#lesson-body th,#lesson-body td { border: 1px solid var(--ef-border); padding: .5rem .75rem; text-align: left; }
#lesson-body th { background: var(--ef-bg); font-weight: 600; }
/* Minicheck */
#minicheck-container { margin-top: 2rem; border-top: 1px solid var(--ef-border); padding-top: 1.5rem; }
.mc-question { margin-bottom: 1.5rem; }
.mc-prompt { font-weight: 600; margin-bottom: .5rem; }
.mc-option { display: block; padding: .5rem .75rem; margin: .25rem 0; border: 1px solid var(--ef-border); border-radius: 6px; cursor: pointer; transition: border-color .15s; }
.mc-option:hover { border-color: var(--ef-primary); }
.mc-option.selected { border-color: var(--ef-primary); background: var(--ef-primary-light); }
.mc-option.correct { border-color: var(--ef-success); background: #dcfce7; }
.mc-option.wrong { border-color: var(--ef-error); background: #fef2f2; }
.mc-explanation { margin-top: .5rem; padding: .5rem .75rem; background: var(--ef-bg); border-radius: 6px; font-size: .9rem; display: none; }
.mc-explanation.show { display: block; }
/* Navigation */
#lesson-nav { display: flex; justify-content: space-between; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--ef-border); }
.nav-btn { padding: .5rem 1.25rem; border: 1px solid var(--ef-border); border-radius: 6px; background: var(--ef-surface); cursor: pointer; font-size: .95rem; transition: background .15s; }
.nav-btn:hover { background: var(--ef-primary-light); }
.nav-btn:disabled { opacity: .4; cursor: default; }
/* Responsive */
@media (max-width: 768px) {
  #sidebar { transform: translateX(-100%); }
  #sidebar.open { transform: translateX(0); }
  #toggle-sidebar { display: block; }
  #content { margin-left: 0; padding: 1rem; }
  .sidebar-header h1 { font-size: 1rem; }
}
`;

const PLAYER_JS = `/* ExamFit Standalone Player v1.0.0 */
(function() {
  'use strict';

  const STORAGE_KEY = 'ef_standalone_progress';
  let snapshot = null;
  let flatLessons = [];
  let currentIdx = 0;
  let progress = {};

  // ── Init ──
  async function init() {
    try {
      const res = await fetch('snapshot.json');
      snapshot = await res.json();
    } catch (e) {
      document.getElementById('lesson-body').innerHTML =
        '<p style="color:red">Fehler: snapshot.json konnte nicht geladen werden.</p>';
      return;
    }

    progress = loadProgress();
    document.getElementById('course-title').textContent = snapshot.meta.course_title || 'ExamFit';
    document.title = snapshot.meta.course_title || 'ExamFit Standalone';

    buildNav();
    navigateTo(0);

    document.getElementById('prev-btn').addEventListener('click', () => navigateTo(currentIdx - 1));
    document.getElementById('next-btn').addEventListener('click', () => {
      markCompleted(flatLessons[currentIdx].id);
      navigateTo(currentIdx + 1);
    });
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  // ── Navigation ──
  function buildNav() {
    const nav = document.getElementById('module-nav');
    nav.innerHTML = '';
    flatLessons = [];

    const modules = snapshot.course.modules || [];
    for (const mod of modules) {
      const group = document.createElement('div');
      group.className = 'mod-group';
      const title = document.createElement('div');
      title.className = 'mod-title';
      title.textContent = mod.title;
      group.appendChild(title);

      const modLessons = (snapshot.lessons || [])
        .filter(l => l.module_id === mod.id)
        .sort((a, b) => a.sort_order - b.sort_order);

      for (const lesson of modLessons) {
        const idx = flatLessons.length;
        flatLessons.push(lesson);
        const link = document.createElement('a');
        link.className = 'lesson-link' + (progress[lesson.id] ? ' completed' : '');
        link.textContent = lesson.title;
        link.dataset.idx = idx;
        link.addEventListener('click', () => navigateTo(idx));
        group.appendChild(link);
      }
      nav.appendChild(group);
    }
  }

  function navigateTo(idx) {
    if (idx < 0 || idx >= flatLessons.length) return;
    currentIdx = idx;
    const lesson = flatLessons[idx];

    // Update active
    document.querySelectorAll('.lesson-link').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });

    // Breadcrumb
    const mod = (snapshot.course.modules || []).find(m => m.id === lesson.module_id);
    document.getElementById('lesson-breadcrumb').textContent = mod ? mod.title : '';
    document.getElementById('lesson-title').textContent = lesson.title;

    // Content
    renderContent(lesson);
    renderMinichecks(lesson.id);

    // Nav buttons
    document.getElementById('prev-btn').disabled = idx === 0;
    document.getElementById('next-btn').disabled = idx === flatLessons.length - 1;

    updateProgress();

    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }

  function renderContent(lesson) {
    const body = document.getElementById('lesson-body');
    const blocks = lesson.content_blocks || [];
    if (blocks.length === 0) {
      body.innerHTML = '<p style="color:#94a3b8"><em>Kein Inhalt vorhanden.</em></p>';
      return;
    }
    let html = '';
    for (const block of blocks) {
      if (block.type === 'rich_text' || block.type === 'text') {
        html += block.html || block.content || '';
      } else if (block.type === 'image') {
        html += '<img src="' + (block.url || block.src || '') + '" alt="' + (block.alt || '') + '">';
      } else if (block.type === 'video') {
        html += '<p>[Video: ' + (block.url || 'nicht verfügbar') + ']</p>';
      } else {
        html += '<div>' + (block.html || block.content || JSON.stringify(block)) + '</div>';
      }
    }
    body.innerHTML = html;
  }

  // ── Minichecks ──
  function renderMinichecks(lessonId) {
    const container = document.getElementById('minicheck-container');
    const group = (snapshot.minichecks || []).find(g => g.lesson_id === lessonId);
    if (!group || !group.questions.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<h3>Wissenscheck</h3>';
    for (const q of group.questions) {
      const div = document.createElement('div');
      div.className = 'mc-question';
      div.innerHTML = '<div class="mc-prompt">' + q.prompt + '</div>';

      const options = Array.isArray(q.options) ? q.options : [];
      const explanation = document.createElement('div');
      explanation.className = 'mc-explanation';
      explanation.textContent = q.explanation || '';

      for (const opt of options) {
        const optEl = document.createElement('div');
        optEl.className = 'mc-option';
        optEl.textContent = typeof opt === 'string' ? opt : (opt.text || opt.label || JSON.stringify(opt));
        optEl.addEventListener('click', function() {
          if (div.dataset.answered) return;
          div.dataset.answered = 'true';
          const optValue = typeof opt === 'string' ? opt : (opt.text || opt.label);
          const correct = optValue === q.correct_answer;
          optEl.classList.add(correct ? 'correct' : 'wrong');
          // Highlight correct
          div.querySelectorAll('.mc-option').forEach(el => {
            const elVal = el.textContent;
            if (elVal === q.correct_answer) el.classList.add('correct');
          });
          explanation.classList.add('show');
        });
        div.appendChild(optEl);
      }
      div.appendChild(explanation);
      container.appendChild(div);
    }
  }

  // ── Progress ──
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch {}
  }
  function markCompleted(lessonId) {
    if (!progress[lessonId]) {
      progress[lessonId] = new Date().toISOString();
      saveProgress();
      const link = document.querySelector('.lesson-link[data-idx="' + currentIdx + '"]');
      if (link) link.classList.add('completed');
    }
  }
  function updateProgress() {
    const total = flatLessons.length;
    const done = flatLessons.filter(l => progress[l.id]).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = done + '/' + total + ' (' + pct + '%)';
  }

  // ── Start ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
