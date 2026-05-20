// generate-batch.mjs — Generador masivo de cursos HTML desde múltiples PGN
// Procesa todos los archivos .pgn en la misma carpeta que el template
// y genera un HTML por cada PGN usando el nombre del archivo como --out y --name.
//
// USO:
//   node generate-batch.mjs
//   node generate-batch.mjs --template course-template.html
//   node generate-batch.mjs --dir ./mis-pgns --template ./course-template.html
//   node generate-batch.mjs --pgn-dir ./pgns --out-dir ./cursos
//
// OPCIONES:
//   --template  Ruta al archivo course-template.html  (por defecto: course-template.html en el mismo directorio)
//   --dir       Carpeta donde buscar los .pgn          (por defecto: misma carpeta que este script)
//   --pgn-dir   Alias de --dir
//   --out-dir   Carpeta donde guardar los HTML          (por defecto: misma que --dir)
//   --recursive Buscar PGN también en subcarpetas
//   --dry-run   Solo muestra qué archivos se procesarían, sin generar nada
//   -h, --help  Muestra esta ayuda

import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Chess } from 'chess.js';

// ─── Argparse ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    template: null,
    dir: null,
    outDir: null,
    recursive: false,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template')        out.template  = argv[++i];
    else if (a === '--dir' || a === '--pgn-dir') out.dir = argv[++i];
    else if (a === '--out-dir')    out.outDir    = argv[++i];
    else if (a === '--recursive')  out.recursive = true;
    else if (a === '--dry-run')    out.dryRun    = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

// ─── PGN parser (mismo engine que generate-course.mjs) ────────────────────────
const PGN_COLOR_MAP = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };

function parseComment(raw) {
  if (!raw) return { text: '', squares: [], arrows: [] };
  const squares = [];
  const arrows = [];
  const cslRe = /\[%csl\s+([^\]]+)\]/g;
  let m;
  while ((m = cslRe.exec(raw)) !== null)
    m[1].split(',').forEach(tok => {
      tok = tok.trim();
      if (tok.length >= 3)
        squares.push({ sq: tok.slice(1,3).toLowerCase(), color: PGN_COLOR_MAP[tok[0].toUpperCase()] || 'green' });
    });
  const calRe = /\[%cal\s+([^\]]+)\]/g;
  while ((m = calRe.exec(raw)) !== null)
    m[1].split(',').forEach(tok => {
      tok = tok.trim();
      if (tok.length >= 5)
        arrows.push({ from: tok.slice(1,3).toLowerCase(), to: tok.slice(3,5).toLowerCase(),
                      color: PGN_COLOR_MAP[tok[0].toUpperCase()] || 'green' });
    });
  const text = raw
    .replace(/\[%csl\s+[^\]]+\]/g, '').replace(/\[%cal\s+[^\]]+\]/g, '')
    .replace(/\[%[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  return { text, squares, arrows };
}

function splitPgnGames(pgnText) {
  const t = String(pgnText || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  return t.split(/\n\s*\n(?=\[)/g).map(s => s.trim()).filter(Boolean);
}

function moveTextOnly(gameStr) {
  return gameStr.split('\n').filter(l => !l.trim().startsWith('['))
    .join(' ').replace(/\s+/g, ' ').trim();
}

function lexMoveSection(s) {
  const tokens = []; let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  while (true) {
    ws(); if (i >= s.length) break;
    const c = s[i];
    if (c === '{') { let j = s.indexOf('}', i); if (j < 0) break; tokens.push({ type: 'comment', val: s.slice(i+1,j) }); i = j+1; continue; }
    if (c === '(') { tokens.push({ type: 'open' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'close' }); i++; continue; }
    const rest = s.slice(i);
    const mSan = rest.match(/^([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#!?]{0,2}|O-O-O[+#!?]{0,2}|O-O[+#!?]{0,2})\b/);
    if (mSan) { tokens.push({ type: 'san', val: mSan[1] }); i += mSan[0].length; continue; }
    if (/^\d+\./.test(rest)) { const mN = rest.match(/^\d+\.(?:\.{1,3})?\s*/); if (mN) { tokens.push({ type: 'movenum' }); i += mN[0].length; continue; } }
    if (/^\$\d+/.test(rest)) { const mNag = rest.match(/^\$\d+/); tokens.push({ type: 'nag' }); i += mNag[0].length; continue; }
    const mRes = rest.match(/^(\*|1-0|0-1|1\/2-1\/2)\b/);
    if (mRes) { tokens.push({ type: 'result', val: mRes[1] }); i += mRes[0].length; continue; }
    i++;
  }
  return tokens;
}

function findMatchingClose(tokens, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    if (tokens[k].type === 'open') depth++;
    else if (tokens[k].type === 'close') { depth--; if (depth === 0) return k; }
  }
  return -1;
}

function buildVariationNodes(tokens, from, toEx, fen) {
  // Skip positions with invalid FEN (e.g. diagram positions without kings)
  let chess; try { chess = new Chess(fen); } catch { return []; }
  const nodes = []; let i = from; let branchFen = fen;
  while (i < toEx) {
    const t = tokens[i];
    if (t.type === 'movenum' || t.type === 'nag') { i++; continue; }
    if (t.type === 'result') { i++; continue; }
    if (t.type === 'comment') { const pc = parseComment(t.val); if (pc.text || pc.squares.length || pc.arrows.length) nodes.push({ key:'C', val:{text:pc.text,squares:pc.squares,arrows:pc.arrows} }); i++; continue; }
    if (t.type === 'open') { const clo = findMatchingClose(tokens, i); if (clo < 0) break; const inner = buildVariationNodes(tokens, i+1, clo, branchFen); if (inner.length) nodes.push({ key:'V', val:inner }); i = clo+1; continue; }
    if (t.type === 'close') break;
    if (t.type === 'san') {
      let mergedText=''; const mergedSquares=[]; const mergedArrows=[]; let ni = i+1;
      while (ni < toEx && tokens[ni].type === 'comment') { const pc = parseComment(tokens[ni].val); if (pc.text) mergedText = mergedText ? mergedText+' '+pc.text : pc.text; mergedSquares.push(...pc.squares); mergedArrows.push(...pc.arrows); ni++; }
      branchFen = chess.fen();
      let moveObj = null; try { moveObj = chess.move(t.val, {sloppy:true}); } catch {}
      if (moveObj) { nodes.push({key:'S',val:moveObj.san}); if (mergedText||mergedSquares.length||mergedArrows.length) nodes.push({key:'C',val:{text:mergedText,squares:mergedSquares,arrows:mergedArrows}}); }
      i = ni; continue;
    }
    i++;
  }
  return nodes;
}

function recordFromSan(chess, san, rawComment, moveNum, firstMoveFlag) {
  let moveObj = null;
  try { moveObj = chess.move(san, {sloppy:true}); } catch { return null; }
  if (!moveObj) return null;
  const col = moveObj.color === 'b' ? 'b' : 'w';
  const moveKey = `${moveNum}${col}`;
  const parsed = parseComment(rawComment);
  const draws = [
    ...parsed.squares.map(({sq,color}) => ({object:'circle',color,start:sq,move:moveKey})),
    ...parsed.arrows.map(({from,to,color}) => ({object:'arrow',color,start:from,end:to,move:moveKey}))
  ];
  const hasPgnMarks = /\[%cal\b|\[%csl\b/.test(rawComment||'');
  const rec = {move:moveNum, col, san:moveObj.san, showN:true};
  if (hasPgnMarks) rec.hasPgnMarks = true;
  if (parsed.text) rec.comment = parsed.text;
  if (draws.length) rec.draws = draws;
  if (firstMoveFlag.value) { rec.isKey = true; firstMoveFlag.value = false; }
  const nextMn = moveNum + (col === 'b' ? 1 : 0);
  return {rec, nextMn};
}

function parseSingleGame(moveTextJoined, initialFen) {
  const tokens = lexMoveSection(moveTextJoined.replace(/\s+/g,' ').trim());
  let chess; try { chess = new Chess(initialFen); } catch (e) { throw e; }
  let i = 0; const preamble = [];
  let mainLineFenBeforeLastSan = chess.fen();
  while (i < tokens.length && tokens[i].type === 'comment') { const pc = parseComment(tokens[i].val); if (pc.text) preamble.push(pc.text); i++; }
  const data = []; let moveNum = 1; const firstMoveFlag = {value:true};
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'movenum' || t.type === 'nag') { i++; continue; }
    if (t.type === 'result') { i++; break; }
    if (t.type === 'open') {
      const clo = findMatchingClose(tokens, i); if (clo < 0) { i++; continue; }
      const varNodes = buildVariationNodes(tokens, i+1, clo, mainLineFenBeforeLastSan);
      const parent = data[data.length-1];
      if (parent && varNodes.length) { if (!parent.pgnBranches) parent.pgnBranches=[]; parent.pgnBranches.push({startFen:mainLineFenBeforeLastSan,nodes:varNodes}); }
      i = clo+1; continue;
    }
    if (t.type === 'comment') {
      const pc = parseComment(t.val);
      if (data.length) { const last=data[data.length-1]; if (pc.text) last.comment=(last.comment?last.comment+'\n\n':'')+pc.text; if (pc.squares.length||pc.arrows.length) { const mk=`${last.move}${last.col}`; const extra=[...pc.squares.map(({sq,color})=>({object:'circle',color,start:sq,move:mk})),...pc.arrows.map(({from,to,color})=>({object:'arrow',color,start:from,end:to,move:mk}))]; if(!last.draws)last.draws=[]; last.draws.push(...extra); last.hasPgnMarks=true; } }
      else { if (pc.text) preamble.push(pc.text); }
      i++; continue;
    }
    if (t.type === 'san') {
      mainLineFenBeforeLastSan = chess.fen();
      let rawComment = ''; let ni = i+1;
      while (ni < tokens.length && tokens[ni].type === 'comment') { rawComment = rawComment ? rawComment+' '+tokens[ni].val : tokens[ni].val; ni++; }
      const r = recordFromSan(chess, t.val, rawComment, moveNum, firstMoveFlag);
      i = ni; if (!r) continue;
      data.push(r.rec); moveNum = r.nextMn; continue;
    }
    i++;
  }
  return {data, preamble: preamble.filter(Boolean).join('\n\n')};
}


// ─── Title deduplication helper ───────────────────────────────────────────────
// When [Event] is very repetitive (>50% of games share the same value),
// fall back to [Site] as the display title, which is usually more descriptive.
function resolveTitles(allHeaders, fallbackPrefix) {
  const eventCount = {};
  for (const h of allHeaders) {
    const ev = h.Event || '';
    if (ev) eventCount[ev] = (eventCount[ev] || 0) + 1;
  }
  const total = allHeaders.length;
  const topEvent = Object.entries(eventCount).sort((a, b) => b[1] - a[1])[0];
  const eventIsRepetitive = topEvent && topEvent[1] / total > 0.5;

  return allHeaders.map((h, gi) => {
    if (h.ChapterName) return h.ChapterName;
    const ev = h.Event || '';
    const site = (h.Site || '').trim();
    if (eventIsRepetitive && site && site !== '?' && site !== ev) return site;
    if (ev) return ev;
    if (h.White && h.Black) return `${h.White} vs ${h.Black}`;
    return `${fallbackPrefix} ${gi + 1}`;
  });
}

function courseFromPgn(pgnText, courseNameFallback) {
  const games = splitPgnGames(pgnText);
  if (!games.length) throw new Error('No se encontraron partidas PGN.');
  const variations = [];

  // First pass: collect all headers to detect repetitive [Event] values
  const allHeaders = games.map(gameText => {
    const h = {};
    const hRe = /\[(\w+)\s+"([^"]*)"\]/g; let hm;
    while ((hm = hRe.exec(gameText)) !== null) h[hm[1]] = hm[2];
    return h;
  });
  const resolvedTitles = resolveTitles(allHeaders, 'Partida');

  for (let gi = 0; gi < games.length; gi++) {
    const gameText = games[gi];
    const headers = allHeaders[gi];
    const initialFen = headers.FEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const headerResult = headers.Result || '*';
    const title = resolvedTitles[gi];
    const mtx = moveTextOnly(gameText);
    let parsed;
    try {
      parsed = parseSingleGame(mtx, initialFen);
    } catch (e) {
      console.warn(`  ⚠  Partida "${title}" omitida — FEN inválido: ${e.message}`);
      continue;
    }
    const {data, preamble} = parsed;
    if (!data.length && !preamble) { console.warn(`  ⚠  Partida "${title}" sin jugadas — omitida.`); continue; }
    const game = {title, result: headerResult, color:'white', initial: initialFen, data};
    if (preamble) game.openingComment = preamble;
    variations.push({oid: String(gi+1), title, result: headerResult, game});
  }
  if (!variations.length) throw new Error('No se pudo parsear ninguna partida.');
  return {
    name: courseNameFallback || variations[0]?.title || 'Course',
    chapters: [{lid:0, title:'PGN Games', variations}]
  };
}

// ─── File discovery ───────────────────────────────────────────────────────────
async function findPgnFiles(dir, recursive) {
  const results = [];
  async function walk(currentDir) {
    let entries;
    try { entries = await fs.readdir(currentDir, {withFileTypes: true}); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isDirectory() && recursive) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pgn')) results.push(full);
    }
  }
  await walk(dir);
  return results.sort();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(`
generate-batch.mjs — Generador masivo de cursos HTML desde múltiples PGN
==========================================================================

USO:
  node generate-batch.mjs [opciones]

OPCIONES:
  --template <ruta>   Plantilla HTML base (por defecto: course-template.html junto a este script)
  --dir <carpeta>     Carpeta donde buscar los .pgn (por defecto: carpeta de este script)
  --pgn-dir <carpeta> Alias de --dir
  --out-dir <carpeta> Carpeta de salida para los HTML (por defecto: misma que --dir)
  --recursive         Buscar PGN también en subcarpetas
  --dry-run           Solo muestra qué archivos se procesarían
  -h, --help          Muestra esta ayuda

EJEMPLOS:
  # Procesa todos los .pgn en la carpeta actual:
  node generate-batch.mjs

  # Especificar carpeta de PGN y de salida:
  node generate-batch.mjs --dir ./pgns --out-dir ./cursos

  # Buscar recursivamente en subcarpetas:
  node generate-batch.mjs --dir ./pgns --recursive

  # Solo ver qué procesaría (sin generar archivos):
  node generate-batch.mjs --dry-run

RESULTADO:
  Por cada archivo "Mi Apertura.pgn" genera "Mi Apertura.html"
  con el nombre del curso igual al nombre del archivo (sin extensión).
`);
    process.exit(0);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));

  // Resolve template path
  const templatePath = path.resolve(process.cwd(), args.template || path.join(scriptDir, 'course-template.html'));
  try { await fs.access(templatePath); }
  catch { console.error(`✗ No se encontró la plantilla: ${templatePath}\n  Usa --template para especificar la ruta.`); process.exit(1); }

  // Resolve search dir
  const searchDir = path.resolve(process.cwd(), args.dir || scriptDir);
  try { await fs.access(searchDir); }
  catch { console.error(`✗ No existe la carpeta de búsqueda: ${searchDir}`); process.exit(1); }

  // Resolve output dir
  const outDir = args.outDir ? path.resolve(process.cwd(), args.outDir) : searchDir;
  if (args.outDir) {
    try { await fs.mkdir(outDir, {recursive: true}); }
    catch (e) { console.error(`✗ No se pudo crear la carpeta de salida: ${outDir}\n  ${e.message}`); process.exit(1); }
  }

  // Find PGN files (exclude template itself if it has .pgn suffix — unlikely)
  const pgnFiles = await findPgnFiles(searchDir, args.recursive);

  if (!pgnFiles.length) {
    console.log(`⚠  No se encontraron archivos .pgn en: ${searchDir}`);
    if (!args.recursive) console.log('   (Prueba con --recursive para buscar en subcarpetas)');
    process.exit(0);
  }

  console.log(`\n📂 Carpeta PGN  : ${searchDir}`);
  console.log(`📄 Template     : ${templatePath}`);
  console.log(`💾 Salida       : ${outDir}`);
  console.log(`📋 PGN hallados : ${pgnFiles.length}\n`);

  if (args.dryRun) {
    console.log('🔍 Modo DRY-RUN — archivos que se generarían:\n');
    for (const pgn of pgnFiles) {
      const base = path.basename(pgn, path.extname(pgn));
      const outFile = path.join(outDir, base + '.html');
      console.log(`  ${path.relative(process.cwd(), pgn)}  →  ${path.relative(process.cwd(), outFile)}`);
    }
    console.log(`\n  Total: ${pgnFiles.length} cursos HTML`);
    process.exit(0);
  }

  // Read template once
  let templateHtml;
  try { templateHtml = await fs.readFile(templatePath, 'utf8'); }
  catch (e) { console.error(`✗ Error leyendo template: ${e.message}`); process.exit(1); }

  const re = /const COURSE =[\s\S]*?\n\/\/ Build lid/gm;
  if (!re.test(templateHtml)) {
    console.error('✗ La plantilla no contiene el bloque "const COURSE = ..." esperado.');
    console.error('  Asegúrate de usar course-template.html como plantilla.');
    process.exit(1);
  }

  // Process each PGN
  let ok = 0, errors = 0;
  for (const pgnPath of pgnFiles) {
    const base = path.basename(pgnPath, path.extname(pgnPath));
    const outPath = path.join(outDir, base + '.html');
    const relPgn = path.relative(process.cwd(), pgnPath);
    const relOut = path.relative(process.cwd(), outPath);

    process.stdout.write(`  ⏳ ${relPgn} … `);
    try {
      const pgnText = await fs.readFile(pgnPath, 'utf8');
      const course = courseFromPgn(pgnText, base);

      // Replace COURSE data in template (reset regex state each iteration)
      const reLocal = /const COURSE =[\s\S]*?\n\/\/ Build lid/gm;
      const html = templateHtml.replace(reLocal, `const COURSE = ${JSON.stringify(course)}\n// Build lid`);

      await fs.writeFile(outPath, html, 'utf8');
      const nGames = course.chapters[0]?.variations?.length ?? 0;
      console.log(`✓  →  ${relOut}  (${nGames} partida${nGames !== 1 ? 's' : ''})`);
      ok++;
    } catch (e) {
      console.log(`✗  ERROR: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ Generados: ${ok}   ❌ Errores: ${errors}   Total: ${pgnFiles.length}`);
  if (errors > 0) process.exit(1);
}

main().catch(err => { console.error('✗ Error fatal:', err?.message || err); process.exit(1); });
