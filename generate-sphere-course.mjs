// generate-sphere-course.mjs — PGN → HTML grafo esférico + constelación temática
// USO:
//   node generate-sphere-course.mjs --pgn mi.pgn --out "Curso.html" --name "Curso"
//
// Genera HTML con:
//   - Grafo PGN (orden de partidas)
//   - Constelación estratégica (top 12 ejes)  [atajo: K]
//   - Botón 101 Chess Tips (?)
//   - Sin botón de cargar PGN

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { processPgnToThematic } from './thematic-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { template: null, pgn: null, out: null, name: null, ejes: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template') out.template = argv[++i];
    else if (a === '--pgn') out.pgn = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--ejes') out.ejes = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

/** SVG brújula minimalista (stroke currentColor) */
const ICON_COMPASS = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="9"/><polygon points="12 7 14.5 14.5 12 13 9.5 14.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>`;

/** SVG interrogación (101 tips) */
const ICON_TIPS = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.5 1-1.5 2.2"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/></svg>`;

function injectLockedCourse(html, games, thematic, courseTitle) {
  let out = html;

  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(courseTitle)}</title>`);
  out = out.replace(
    /(<div class="graph-title" id="graph-title"[^>]*>)[\s\S]*?(<\/div>)/,
    `$1${escapeHtml(courseTitle)}$2`
  );
  out = out.replace(/(id="graph-title"[^>]*title=")[^"]*(")/, `$1${escapeAttr(courseTitle)}$2`);
  out = out.replace(
    /(<div class="mobile-title" id="mobile-title">)[\s\S]*?(<\/div>)/,
    `$1${escapeHtml(courseTitle)}$2`
  );

  // Sustituir botón import PGN por: 101 tips (?) + Constelación (brújula)
  const newBtns = `
          <button class="icon-btn sm" id="btn-tips-mode" title="101 Chess Tips" aria-label="101 Chess Tips">
            ${ICON_TIPS}
          </button>
          <button class="icon-btn sm" id="btn-constellation" title="Constelación estratégica" aria-label="Constelación estratégica">
            ${ICON_COMPASS}
          </button>
`;
  out = out.replace(
    /\s*<button class="icon-btn sm" id="btn-import-pgn"[\s\S]*?<\/button>\s*/g,
    newBtns
  );

  out = out.replace(
    /const PGN_IMPORT_ENABLED\s*=\s*true\s*;/,
    'const PGN_IMPORT_ENABLED = false;'
  );
  out = out.replace(
    /fileInput\.addEventListener\('change',\s*\(e\)=>\{/,
    "if (fileInput) fileInput.addEventListener('change', (e)=>{"
  );
  out = out.replace(
    /e\.preventDefault\(\);\s*click\('btn-import-pgn'\);\s*break;/,
    "e.preventDefault(); if (typeof toggleConstellation==='function') toggleConstellation(); break;"
  );
  // Atajo K = constelación (además de reutilizar u)
  out = out.replace(
    /case 'u': case 'U':\s*e\.preventDefault\(\); if \(typeof toggleConstellation==='function'\) toggleConstellation\(\); break;/,
    `case 'u': case 'U':
      e.preventDefault(); if (typeof toggleConstellation==='function') toggleConstellation(); break;
    case 'k': case 'K':
      e.preventDefault(); if (typeof toggleConstellation==='function') toggleConstellation(); break;`
  );
  // Si el replace de u no coincidió (orden distinto), añadir case K cerca de case m
  if (!/case 'k': case 'K':/.test(out)) {
    out = out.replace(
      /case 'm': case 'M':/,
      `case 'k': case 'K':
      e.preventDefault(); if (typeof toggleConstellation==='function') toggleConstellation(); break;
    case 'm': case 'M':`
    );
  }

  // Desactivar "respiración" de nodos PGN: fuerza breathe=1 cuando no es centro
  // (parche en el loop de animación)
  out = out.replace(
    /const breathe = 1 \+ Math\.sin\(now\*0\.0011 \+ ph\) \* 0\.045;/,
    `const breathe = (appState && (appState.graphView==='pgn' || appState.graphView==='thematic')) ? 1 : (1 + Math.sin(now*0.0011 + ph) * 0.045);`
  );

  const payloadGames = JSON.stringify(games);
  const payloadThematic = JSON.stringify(thematic);
  const titleJson = JSON.stringify(courseTitle);

  // Runtime de constelación + arranque
  const bootBlock = `
// === Curso PGN + Constelación (generate-sphere-course.mjs) ===
window.PRELOADED_PGN_TITLE = ${titleJson};
window.PRELOADED_PGN_GAMES = ${payloadGames};
window.PRELOADED_THEMATIC = ${payloadThematic};

// Vista del grafo: 'pgn' | 'thematic' | 'tips'
if (typeof appState !== 'undefined') {
  appState.graphView = 'pgn';
  appState.contentMode = 'pgn'; // 'pgn' | 'tips'  (tablero/comentarios)
}

function _axisLabel(seg, lang) {
  if (!seg || !seg.nombre) return '';
  return seg.nombre[lang] || seg.nombre.es || seg.nombre.en || '';
}

function _valoracionEmoji() {
  return Math.random() < 0.5 ? '⚖️' : '🤔';
}

function _segmentEmoji(seg) {
  if (!seg) return '❓';
  if (seg.eje === 27 || (seg.nombre && (seg.nombre.es || '').indexOf('Valoraci') === 0))
    return _valoracionEmoji();
  return seg.emoji || '❓';
}

/** Listado jerárquico: Categoría → Eje → Partidas (carpetas colapsables) */
function renderThematicListView() {
  const listView = document.getElementById('list-view');
  if (!listView) return;
  const th = window.PRELOADED_THEMATIC;
  const games = appState.games || [];
  const lang = (th && th.lang) || 'es';
  const tree = (th && th.listTree) || [];
  if (!tree.length) {
    listView.innerHTML = '<div class="list-empty">Sin datos temáticos</div>';
    return;
  }

  function lab(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.es || obj.en || '';
  }
  function esc(s){ return escapeHtml(String(s||'')); }
  function gameById(id){ return games.find(g => g.id === id); }
  function passesFilter(g){
    // Los chips ya no ocultan partidas del listado; solo controlan líneas verdes del grafo
    return !!g;
  }

  let html = '';
  tree.forEach((cat, ci) => {
    const catLabel = lab(cat.nombre);
    // Contar partidas visibles bajo filtro
    const catGameCount = cat.axes.reduce((n,a)=> n + a.gameIds.filter(gid => passesFilter(gameById(gid))).length, 0);
    if (!catGameCount) return;
    html += '<div class="list-folder" data-folder="cat-'+ci+'">';
    html += '<div class="list-folder-head" data-toggle="cat-'+ci+'">' +
      '<span class="list-folder-chevron">▶</span> ' +
      '<span class="list-folder-title">'+(cat.emoji?cat.emoji+' ':'')+esc(catLabel)+'</span>' +
      '<span class="list-folder-count">'+catGameCount+'</span></div>';
    html += '<div class="list-folder-body" data-body="cat-'+ci+'" hidden>';
    cat.axes.forEach((ax, ai) => {
      const visibleIds = ax.gameIds.filter(gid => passesFilter(gameById(gid)));
      if (!visibleIds.length) return;
      let em = ax.emoji || '•';
      if (ax.eje === 27) em = (Math.random() < 0.5 ? '⚖️' : '🤔');
      const axLabel = lab(ax.nombre);
      const key = 'cat-'+ci+'-ax-'+ai;
      html += '<div class="list-folder nested">';
      html += '<div class="list-folder-head sub" data-toggle="'+key+'">' +
        '<span class="list-folder-chevron">▶</span> ' +
        '<span title="'+esc(axLabel)+'">'+em+' '+esc(axLabel)+'</span>' +
        '<span class="list-folder-count">'+visibleIds.length+'</span></div>';
      html += '<div class="list-folder-body" data-body="'+key+'" hidden>';
      visibleIds.forEach(gid => {
        const g = gameById(gid);
        if (!g) return;
        const idx = games.indexOf(g);
        const title = (g.white||'?')+' vs '+(g.black||'?');
        const cur = currentGame === g ? ' current' : '';
        const vis = g._visited ? ' visited' : '';
        html += '<div class="list-item'+cur+vis+'" data-kind="game" data-idx="'+idx+'">' +
          '<span class="n">'+(idx+1)+'</span><span class="t">'+esc(title)+'</span></div>';
      });
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  listView.innerHTML = html;

  listView.querySelectorAll('[data-toggle]').forEach(head => {
    head.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = head.getAttribute('data-toggle');
      const body = listView.querySelector('[data-body="'+key+'"]');
      const chev = head.querySelector('.list-folder-chevron');
      if (!body) return;
      const open = body.hasAttribute('hidden');
      if (open) { body.removeAttribute('hidden'); if (chev) chev.textContent = '▼'; }
      else { body.setAttribute('hidden', ''); if (chev) chev.textContent = '▶'; }
    });
  });
  listView.querySelectorAll('.list-item[data-kind="game"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(el.getAttribute('data-idx'), 10);
      if (!isNaN(i) && appState.games[i]) openGame(appState.games[i]);
    });
  });
}

const _origRenderListView = typeof renderListView === 'function' ? renderListView : null;
function renderListViewPatched() {
  if (appState && appState.graphView === 'thematic' && appState.contentMode === 'pgn') {
    renderThematicListView();
    return;
  }
  if (_origRenderListView) _origRenderListView();
}
try { renderListView = renderListViewPatched; } catch(e) {}

function applyConstellationButtonState() {
  const btn = document.getElementById('btn-constellation');
  if (!btn) return;
  if (appState.graphView === 'thematic') {
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
  }
  const btnTips = document.getElementById('btn-tips-mode');
  if (btnTips) {
    if (appState.contentMode === 'tips') {
      btnTips.style.borderColor = 'var(--accent)';
      btnTips.style.color = 'var(--accent)';
    } else {
      btnTips.style.borderColor = '';
      btnTips.style.color = '';
    }
  }
}

function toggleConstellation() {
  if (appState.contentMode === 'tips') {
    exitTipsMode();
  }
  // Reset filtro de ejes (se reactivará al openGame)
  if (appState.axisFilter) appState.axisFilter.clear();
  appState._axisFilterGameId = null;

  if (appState.graphView === 'thematic') {
    appState.graphView = 'pgn';
    appState.mode = 'pgn';
    try {
      Graph.setMode('pgn', appState.games, { animate: true });
    } catch(e) { console.error(e); }
    try { setGraphTitle(window.PRELOADED_PGN_TITLE || 'Partidas cargadas'); } catch(e) {}
    // Esperar colapso+explosión antes de fijar partida
    setTimeout(function(){
      try {
        if (currentGame && typeof openGame === 'function') openGame(currentGame);
        else if (appState.games && appState.games[0]) openGame(appState.games[0]);
      } catch(e) {}
    }, 9000);
    toast('Grafo de partidas');
  } else {
    appState.graphView = 'thematic';
    appState.mode = 'pgn';
    try {
      Graph.setMode('thematic', { games: appState.games, thematic: window.PRELOADED_THEMATIC }, { animate: true });
    } catch(e) { console.error(e); }
    setTimeout(function(){
      try {
        if (currentGame && typeof openGame === 'function') openGame(currentGame);
        else if (appState.games && appState.games[0]) openGame(appState.games[0]);
      } catch(e) {}
    }, 11000);
    toast('Constelación estratégica');
  }
  applyConstellationButtonState();
  if (!sphereActive && typeof renderListView === 'function') renderListView();
}

function enterTipsMode() {
  appState.contentMode = 'tips';
  appState.graphView = 'tips';
  appState.mode = 'course'; // listado usa modo course → 101 tips
  if (appState.axisFilter) appState.axisFilter.clear();
  try { Graph.setMode('course'); } catch(e) {}
  try { setGraphTitle('101 Chess Tips'); } catch(e) {}
  try {
    if (typeof TIPS !== 'undefined' && TIPS.length && typeof openTip === 'function')
      openTip(TIPS[0]);
  } catch(e) {}
  try { if (!sphereActive && typeof renderListView === 'function') renderListView(); } catch(e) {}
  applyConstellationButtonState();
  toast('101 Chess Tips');
}

function exitTipsMode() {
  appState.contentMode = 'pgn';
  appState.graphView = 'pgn';
  appState.mode = 'pgn';
  try { Graph.setMode('pgn', appState.games); } catch(e) {}
  try { setGraphTitle(window.PRELOADED_PGN_TITLE || 'Partidas cargadas'); } catch(e) {}
  try {
    if (appState.games && appState.games[0] && typeof openGame === 'function')
      openGame(appState.games[0]);
  } catch(e) {}
  try { if (!sphereActive && typeof renderListView === 'function') renderListView(); } catch(e) {}
  applyConstellationButtonState();
}

function toggleTipsMode() {
  if (appState.contentMode === 'tips') exitTipsMode();
  else enterTipsMode();
}

// Extender Graph con modo temático (si Three.js está disponible)
(function extendGraphThematic(){
  if (typeof Graph === 'undefined' || !Graph) return;
  const _setMode = Graph.setMode ? Graph.setMode.bind(Graph) : null;

  Graph.setThematicMode = function(games, thematic) {
    if (!thematic || !thematic.segments) {
      if (_setMode) _setMode('pgn', games);
      return;
    }
    // Reutilizar setMode pgn visualmente no basta: reconstruimos como course clusters
    // Llamamos a un builder interno si existe; si no, pgn plano
    try {
      if (typeof Graph._buildThematic === 'function') {
        Graph._buildThematic(games, thematic);
      } else if (_setMode) {
        _setMode('pgn', games);
      }
    } catch(e) {
      console.error('setThematicMode', e);
      if (_setMode) _setMode('pgn', games);
    }
  };
})();

try{ initBoard(); } catch(err){ console.error('Error iniciando tablero:', err); }

if (Array.isArray(window.PRELOADED_PGN_GAMES) && window.PRELOADED_PGN_GAMES.length){
  const games = window.PRELOADED_PGN_GAMES.map((g, i) => {
    const startFenTag = (g.fen && g.fen !== 'start') ? g.fen : '';
    const built = (typeof buildGameMoves === 'function')
      ? buildGameMoves(g.pgn, startFenTag)
      : { fen: g.fen || 'start', moves: [], introComment: '', data: [] };
    return {
      id: g.id || ('g'+i),
      white: g.white || '?', black: g.black || '?',
      event: g.event || '', result: g.result || '*',
      date: g.date || '', site: g.site || '', round: g.round || '',
      whiteElo: g.whiteElo || '', blackElo: g.blackElo || '',
      startFen: startFenTag || 'start',
      fen: built.fen || g.fen || 'start',
      moves: built.moves || [],
      introComment: built.introComment || '',
      data: built.data || null,
      themes: g.themes || [],
      segmentId: g.segmentId,
      orphan: !!g.orphan,
      lang: g.lang || 'es'
    };
  });
  setGraphTitle(window.PRELOADED_PGN_TITLE || 'Partidas cargadas');
  appState.mode = 'pgn';
  appState.games = games;
  appState.graphView = 'pgn';
  appState.contentMode = 'pgn';
  try{ Graph.setMode('pgn', games); } catch(err){ console.error('Error iniciando esfera:', err); }
  try{ if (!sphereActive && typeof renderListView === 'function') renderListView(); }catch(e){}
  try{ if (games[0] && typeof openGame === 'function') openGame(games[0]); }catch(e){ console.warn('openGame', e); }

  // Wire botones
  const btnC = document.getElementById('btn-constellation');
  if (btnC) btnC.addEventListener('click', toggleConstellation);
  const btnT = document.getElementById('btn-tips-mode');
  if (btnT) btnT.addEventListener('click', toggleTipsMode);
  applyConstellationButtonState();
} else {
  try{ Graph.setMode('course'); } catch(err){ console.error('Error iniciando esfera:', err); }
  try{
    if (typeof TIPS !== 'undefined' && TIPS.length && typeof openTip === 'function') openTip(TIPS[0]);
  }catch(err){ console.warn('openTip#1', err); }
}

if (!HAS_THREE){ sphereActive = false; }
applySphereIcon();
onResize();
window.addEventListener('resize', onResize);

})();
`;

  // Localizar el bloque de arranque de forma tolerante a parches (setupAppVh, etc.)
  const bootStartRe = /try\{\s*initBoard\(\);\s*\}\s*catch\s*\(\s*err\s*\)\s*\{/;
  const bootStart = out.search(bootStartRe);
  if (bootStart < 0) {
    throw new Error('No se encontró el bloque de arranque en la plantilla (101-chess-tips-v13.html).');
  }
  // Cerrar en el })(); final del IIFE principal (el último antes de </script> cercano)
  const after = out.slice(bootStart);
  const closeRe = /\}\)\(\);\s*(?=<\/script>)/;
  const closeM = closeRe.exec(after);
  if (!closeM) {
    throw new Error('No se encontró el cierre })(); del arranque en la plantilla.');
  }
  const bootEnd = bootStart + closeM.index + closeM[0].length;
  out = out.slice(0, bootStart) + bootBlock + '\n' + out.slice(bootEnd);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.pgn) {
    console.log(`
generate-sphere-course.mjs — PGN → HTML (grafo + constelación temática)

USO:
  node generate-sphere-course.mjs --pgn mi.pgn --out "Curso.html" --name "Curso"

OPCIONES:
  --template  101-chess-tips-v13.html
  --pgn       archivo PGN (requerido)
  --out       HTML salida
  --name      título
  --ejes      ejes_tematicos_ajedrez_4idiomas.json
  -h, --help

Atajos en el HTML generado:
  K  → Constelación estratégica (alterna grafo PGN / ejes temáticos)
`);
    process.exit(args.help ? 0 : 1);
  }

  const templatePath = path.resolve(process.cwd(), args.template || path.join(__dirname, '101-chess-tips-v13.html'));
  const pgnPath = path.resolve(process.cwd(), args.pgn);
  const ejesPath = args.ejes ? path.resolve(process.cwd(), args.ejes) : path.join(__dirname, 'ejes_tematicos_ajedrez_4idiomas.json');

  let templateHtml;
  try { templateHtml = await fs.readFile(templatePath, 'utf8'); }
  catch { console.error('✗ Plantilla no encontrada: ' + templatePath); process.exit(1); }

  let pgnText;
  try { pgnText = await fs.readFile(pgnPath, 'utf8'); }
  catch { console.error('✗ PGN no legible: ' + pgnPath); process.exit(1); }

  const courseTitle = args.name || path.basename(args.pgn, path.extname(args.pgn));
  console.log('⏳ Etiquetando partidas…');
  const t0 = Date.now();
  const { games, thematic } = await processPgnToThematic(pgnText, ejesPath);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const lang = thematic.lang || 'es';
  const html = injectLockedCourse(templateHtml, games, thematic, courseTitle);
  const outPath = path.resolve(process.cwd(), args.out || courseTitle + '.html');
  await fs.writeFile(outPath, html, 'utf8');
  console.log('✓ ' + outPath + ' · ' + games.length + ' partidas · ' + thematic.segments.length + ' segmentos · lang=' + lang + ' · ' + elapsed + 's');

  // Stats para batch (stdout JSON interno)
  if (process.argv.includes('--json-stats')) {
    console.log('__STATS__' + JSON.stringify({
      ok: true, games: games.length, segments: thematic.segments.length,
      lang, ms: Date.now() - t0, out: outPath
    }));
  }
}

main().catch((err) => {
  console.error('✗ Error:', err && err.message ? err.message : err);
  if (process.argv.includes('--json-stats')) {
    console.log('__STATS__' + JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  }
  process.exit(1);
});
