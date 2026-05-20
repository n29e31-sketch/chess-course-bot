// generate-course.mjs — v3.0
// Generates chess course HTML from PGN with main line + nested variations (), comments {}, [%cal]/[%csl].
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Chess } from 'chess.js';

function parseArgs(argv) {
  const out = { template: 'course-template.html', pgn: null, out: null, name: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template') out.template = argv[++i];
    else if (a === '--pgn') out.pgn = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

const PGN_COLOR_MAP = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };

function parseComment(raw) {
  if (!raw) return { text: '', squares: [], arrows: [] };
  const squares = [];
  const arrows = [];

  const cslRe = /\[%csl\s+([^\]]+)\]/g;
  let m;
  while ((m = cslRe.exec(raw)) !== null) {
    m[1].split(',').forEach(tok => {
      tok = tok.trim();
      if (tok.length >= 3) {
        squares.push({ sq: tok.slice(1, 3).toLowerCase(), color: PGN_COLOR_MAP[tok[0].toUpperCase()] || 'green' });
      }
    });
  }

  const calRe = /\[%cal\s+([^\]]+)\]/g;
  while ((m = calRe.exec(raw)) !== null) {
    m[1].split(',').forEach(tok => {
      tok = tok.trim();
      if (tok.length >= 5) {
        arrows.push({
          from: tok.slice(1, 3).toLowerCase(),
          to: tok.slice(3, 5).toLowerCase(),
          color: PGN_COLOR_MAP[tok[0].toUpperCase()] || 'green'
        });
      }
    });
  }

  const text = raw
    .replace(/\[%csl\s+[^\]]+\]/g, '')
    .replace(/\[%cal\s+[^\]]+\]/g, '')
    .replace(/\[%[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { text, squares, arrows };
}

function splitPgnGames(pgnText) {
  const t = String(pgnText || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  const parts = t.split(/\n\s*\n(?=\[)/g);
  return parts.map(s => s.trim()).filter(Boolean);
}

/** Move-text only (strip tag pairs) */
function moveTextOnly(gameStr) {
  return gameStr
    .split('\n')
    .filter(l => !l.trim().startsWith('['))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lex PGN move text into tokens (comments braces are single tokens preserving [%cal] inside).
 */
function lexMoveSection(s) {
  const tokens = [];
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  while (true) {
    ws();
    if (i >= s.length) break;
    const c = s[i];
    if (c === '{') {
      let j = s.indexOf('}', i);
      if (j < 0) break;
      tokens.push({ type: 'comment', val: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'open' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'close' });
      i++;
      continue;
    }

    const rest = s.slice(i);
    const mSan = rest.match(/^([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#!?]{0,2}|O-O-O[+#!?]{0,2}|O-O[+#!?]{0,2})\b/);
    if (mSan) {
      tokens.push({ type: 'san', val: mSan[1] });
      i += mSan[0].length;
      continue;
    }
    if (/^\d+\./.test(rest)) {
      const mNum = rest.match(/^\d+\.(?:\.{1,3})?\s*/);
      if (mNum) {
        tokens.push({ type: 'movenum' });
        i += mNum[0].length;
        continue;
      }
    }
    if (/^\$\d+/.test(rest)) {
      const mNag = rest.match(/^\$\d+/);
      tokens.push({ type: 'nag' });
      i += mNag[0].length;
      continue;
    }
    const mRes = rest.match(/^(\*|1-0|0-1|1\/2-1\/2)\b/);
    if (mRes) {
      tokens.push({ type: 'result', val: mRes[1] });
      i += mRes[0].length;
      continue;
    }
    i++;
  }
  return tokens;
}

function findMatchingClose(tokens, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    if (tokens[k].type === 'open') depth++;
    else if (tokens[k].type === 'close') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Builds Chessable-compatible node list for renderNodes(): { key, val } using S/C/V nodes.
 * C nodes now carry { text, squares, arrows } so the HTML renderer can display color marks.
 */
function buildVariationNodes(tokens, from, toEx, fen) {
  // Skip positions with invalid FEN (e.g. diagram positions without kings)
  let chess; try { chess = new Chess(fen); } catch { return []; }
  const nodes = [];
  let i = from;
  // branchFen: FEN *before* the last SAN played — used as start for sibling variations (alternatives).
  // Starts equal to fen (no move played yet); updated just before each chess.move() call.
  let branchFen = fen;

  while (i < toEx) {
    const t = tokens[i];
    if (t.type === 'movenum' || t.type === 'nag') {
      i++;
      continue;
    }
    if (t.type === 'result') {
      i++;
      continue;
    }
    if (t.type === 'comment') {
      // Standalone comment (not after a SAN). Preserve text + color marks.
      const pc = parseComment(t.val);
      if (pc.text || pc.squares.length || pc.arrows.length) {
        nodes.push({ key: 'C', val: { text: pc.text, squares: pc.squares, arrows: pc.arrows } });
      }
      i++;
      continue;
    }
    if (t.type === 'open') {
      const clo = findMatchingClose(tokens, i);
      if (clo < 0) break;
      // A parenthesised group is an ALTERNATIVE to the last move played,
      // so it must start from branchFen (position before that move), not chess.fen().
      const inner = buildVariationNodes(tokens, i + 1, clo, branchFen);
      if (inner.length) nodes.push({ key: 'V', val: inner });
      i = clo + 1;
      continue;
    }
    if (t.type === 'close') break;

    if (t.type === 'san') {
      // Consume ALL immediately following comment tokens and merge their content.
      let mergedText = '';
      const mergedSquares = [];
      const mergedArrows = [];
      let ni = i + 1;
      while (ni < toEx && tokens[ni].type === 'comment') {
        const pc = parseComment(tokens[ni].val);
        if (pc.text) mergedText = mergedText ? mergedText + ' ' + pc.text : pc.text;
        mergedSquares.push(...pc.squares);
        mergedArrows.push(...pc.arrows);
        ni++;
      }
      // Save FEN *before* this move so nested variations can branch from here
      branchFen = chess.fen();
      let moveObj = null;
      try {
        moveObj = chess.move(t.val, { sloppy: true });
      } catch {
        moveObj = null;
      }
      if (moveObj) {
        nodes.push({ key: 'S', val: moveObj.san });
        // Emit C node even if text is empty but there are color marks
        if (mergedText || mergedSquares.length || mergedArrows.length) {
          nodes.push({ key: 'C', val: { text: mergedText, squares: mergedSquares, arrows: mergedArrows } });
        }
      }
      i = ni;
      continue;
    }
    i++;
  }
  return nodes;
}

function recordFromSan(chess, san, rawComment, moveNum, firstMoveFlag) {
  let moveObj = null;
  try {
    moveObj = chess.move(san, { sloppy: true });
  } catch {
    return null;
  }
  if (!moveObj) return null;

  const col = moveObj.color === 'b' ? 'b' : 'w';
  const moveKey = `${moveNum}${col}`;
  const parsed = parseComment(rawComment);
  const draws = [
    ...parsed.squares.map(({ sq, color }) => ({ object: 'circle', color, start: sq, move: moveKey })),
    ...parsed.arrows.map(({ from, to, color }) => ({ object: 'arrow', color, start: from, end: to, move: moveKey }))
  ];
  const hasPgnMarks = /\[%cal\b|\[%csl\b/.test(rawComment || '');

  const rec = { move: moveNum, col, san: moveObj.san, showN: true };
  if (hasPgnMarks) rec.hasPgnMarks = true;
  if (parsed.text) rec.comment = parsed.text;
  if (draws.length) rec.draws = draws;
  if (firstMoveFlag.value) {
    rec.isKey = true;
    firstMoveFlag.value = false;
  }
  const nextMn = moveNum + (col === 'b' ? 1 : 0);
  return { rec, nextMn };
}

/**
 * Parses one game string into structured main-line data[] and optional preamble / result.
 */
function parseSingleGame(moveTextJoined, initialFen) {
  const tokens = lexMoveSection(moveTextJoined.replace(/\s+/g, ' ').trim());
  let chess; try { chess = new Chess(initialFen); } catch (e) { throw e; }
  let i = 0;
  const preamble = [];
  /** Fen antes de la última jugada de la línea principal (punto de ramificación PGN habitual). */
  let mainLineFenBeforeLastSan = chess.fen();

  while (i < tokens.length && tokens[i].type === 'comment') {
    const pc = parseComment(tokens[i].val);
    if (pc.text) preamble.push(pc.text);
    // Note: color marks in preamble comments (before first move) are intentionally ignored
    // as there is no board position to attach them to.
    i++;
  }

  const data = [];
  let moveNum = 1;
  const firstMoveFlag = { value: true };

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'movenum' || t.type === 'nag') {
      i++;
      continue;
    }
    if (t.type === 'result') {
      i++;
      break;
    }

    if (t.type === 'open') {
      const clo = findMatchingClose(tokens, i);
      if (clo < 0) {
        i++;
        continue;
      }
      const branchFen = mainLineFenBeforeLastSan;
      const varNodes = buildVariationNodes(tokens, i + 1, clo, branchFen);

      const parent = data[data.length - 1];
      if (parent && varNodes.length) {
        if (!parent.pgnBranches) parent.pgnBranches = [];
        parent.pgnBranches.push({ startFen: branchFen, nodes: varNodes });
      }
      i = clo + 1;
      continue;
    }

    if (t.type === 'comment') {
      // Standalone comment at top-level (between moves, not immediately after a SAN).
      // Preserve text AND color marks by merging into the preceding move's draws/comment.
      const pc = parseComment(t.val);
      if (data.length) {
        const last = data[data.length - 1];
        if (pc.text) last.comment = (last.comment ? last.comment + '\n\n' : '') + pc.text;
        // Merge any color marks into the move's draws array
        if (pc.squares.length || pc.arrows.length) {
          const moveKey = `${last.move}${last.col}`;
          const extra = [
            ...pc.squares.map(({ sq, color }) => ({ object: 'circle', color, start: sq, move: moveKey })),
            ...pc.arrows.map(({ from, to, color }) => ({ object: 'arrow', color, start: from, end: to, move: moveKey }))
          ];
          if (!last.draws) last.draws = [];
          last.draws.push(...extra);
          last.hasPgnMarks = true;
        }
      } else {
        if (pc.text) preamble.push(pc.text);
      }
      i++;
      continue;
    }

    if (t.type === 'san') {
      mainLineFenBeforeLastSan = chess.fen();
      // Consume ALL immediately following comment tokens (PGN often splits text and %cal into separate {})
      let rawComment = '';
      let ni = i + 1;
      while (ni < tokens.length && tokens[ni].type === 'comment') {
        rawComment = rawComment ? rawComment + ' ' + tokens[ni].val : tokens[ni].val;
        ni++;
      }
      const r = recordFromSan(chess, t.val, rawComment, moveNum, firstMoveFlag);
      i = ni;
      if (!r) continue;
      data.push(r.rec);
      moveNum = r.nextMn;
      continue;
    }

    i++;
  }

  return { data, preamble: preamble.filter(Boolean).join('\n\n') };
}


// ─── Title deduplication helper ───────────────────────────────────────────────
// When [Event] is very repetitive (>50% of games share the same value),
// fall back to [Site] as the display title, which is usually more descriptive.
function resolveTitles(allHeaders, fallbackPrefix) {
  // Count Event frequency
  const eventCount = {};
  for (const h of allHeaders) {
    const ev = h.Event || '';
    if (ev) eventCount[ev] = (eventCount[ev] || 0) + 1;
  }
  const total = allHeaders.length;
  // Find the most common Event value
  const topEvent = Object.entries(eventCount).sort((a, b) => b[1] - a[1])[0];
  const eventIsRepetitive = topEvent && topEvent[1] / total > 0.5;

  return allHeaders.map((h, gi) => {
    if (h.ChapterName) return h.ChapterName;
    const ev = h.Event || '';
    const site = (h.Site || '').trim();
    // If Event is repetitive and Site provides a real alternative, prefer Site
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
    const hRe = /\[(\w+)\s+"([^"]*)"\]/g;
    let hm;
    while ((hm = hRe.exec(gameText)) !== null) h[hm[1]] = hm[2];
    return h;
  });
  const resolvedTitles = resolveTitles(allHeaders, 'Game');

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
    const { data, preamble } = parsed;

    if (!data.length && !preamble) {
      console.warn(`Advertencia: partida "${title}" sin jugadas válidas — se omite.`);
      continue;
    }

    const game = {
      title,
      result: headerResult,
      color: 'white',
      initial: initialFen,
      data,
      white: headers.White || null,
      black: headers.Black || null,
      date: headers.Date || null
    };
    if (preamble) game.openingComment = preamble;

    variations.push({
      oid: String(gi + 1),
      title,
      result: headerResult,
      white: headers.White || null,
      black: headers.Black || null,
      date: headers.Date || null,
      game
    });
  }

  if (!variations.length) throw new Error('No se pudo parsear ninguna partida del PGN.');

  return {
    name: courseNameFallback || variations[0]?.title || 'Course',
    chapters: [{ lid: 0, title: 'PGN Games', variations }]
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.pgn) {
    console.log([
      'Uso:',
      '  node generate-course.mjs --pgn mi.pgn --out "Mi Curso.html" --name "Mi Curso"',
      '',
      'Opciones:',
      '  --template "course-template.html"   Plantilla base (por defecto)',
      '  --pgn      archivo.pgn        Archivo PGN (requerido)',
      '  --out      archivo.html       HTML de salida',
      '  --name     "Nombre"           Nombre del curso',
      ''
    ].join('\n'));
    process.exit(args.help ? 0 : 1);
  }

  const pgnPath = path.resolve(process.cwd(), args.pgn);
  const templatePath = path.resolve(process.cwd(), args.template);
  const pgnText = await fs.readFile(pgnPath, 'utf8');
  const course = courseFromPgn(pgnText, args.name || path.basename(args.pgn, path.extname(args.pgn)));

  let html = await fs.readFile(templatePath, 'utf8');
  const re = /const COURSE =[\s\S]*?\n\/\/ Build lid/gm;
  if (!re.test(html)) throw new Error('No encontré el bloque "const COURSE = ..." en la plantilla.');
  html = html.replace(re, `const COURSE = ${JSON.stringify(course)}\n// Build lid`);

  const outPath = path.resolve(process.cwd(), args.out || `${course.name}.html`);
  await fs.writeFile(outPath, html, 'utf8');
  console.log(`✓ Generado: ${outPath}  (${course.chapters[0].variations.length} partidas)`);
}

main().catch(err => { console.error('✗ Error:', err?.message || err); process.exit(1); });
