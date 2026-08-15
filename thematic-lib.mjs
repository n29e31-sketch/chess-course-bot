// thematic-lib.mjs — Etiquetado + plan temático (galaxia / listado jerárquico)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Orden de categorías en listado: piezas (a) AL FINAL
export const CATEGORY_LIST_ORDER = ['b', 'c', 'd', 'e', 'f', 'a', '_'];

const CAT_EMOJI = { a: '♟', b: '🤺', c: '✋', d: '🔄', e: '📜', f: '🔍', _: '❓' };
const CAT_NAMES = {
  a: { es: 'Las piezas', en: 'The pieces', ru: 'Фигуры', pt_br: 'As peças' },
  b: { es: 'Ofensiva', en: 'Offense', ru: 'Атака (наступление)', pt_br: 'Ofensiva' },
  c: { es: 'Defensiva', en: 'Defense', ru: 'Защита', pt_br: 'Defensiva' },
  d: { es: 'Fases de la partida', en: 'Game phases', ru: 'Стадии партии', pt_br: 'Fases da partida' },
  e: { es: 'Principios', en: 'Principles', ru: 'Принципы', pt_br: 'Princípios' },
  f: { es: 'Recursos y planes', en: 'Resources & plans', ru: 'Ресурсы и планы', pt_br: 'Recursos e planos' },
  _: { es: 'Sin tema', en: 'No theme', ru: 'Без темы', pt_br: 'Sem tema' },
};

let _ejesCache = null;

export async function loadEjes(jsonPath) {
  if (_ejesCache) return _ejesCache;
  const p = jsonPath || path.join(__dirname, 'ejes_tematicos_ajedrez_4idiomas.json');
  const raw = JSON.parse(await fs.readFile(p, 'utf8'));
  const ejes = [];
  const catOf = {};
  for (const cat of raw.categorias || []) {
    for (const ej of cat.ejes || []) {
      ejes.push({
        eje: ej.eje,
        emoji: ej.emoji,
        nombre: ej.nombre,
        categoria: cat.id,
        palabras_clave: ej.palabras_clave,
      });
      catOf[ej.eje] = cat.id;
    }
  }
  _ejesCache = { ejes, catOf, version: raw.version || '1.3' };
  return _ejesCache;
}

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[{}\[\]!?.,;:()"'«»„“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractComments(pgnChunk) {
  const comments = [];
  const re = /\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(pgnChunk)) !== null) {
    let t = m[1].replace(/\[%[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) comments.push(t);
  }
  return comments;
}

export function detectLang(comments) {
  const text = comments.join(' ');
  if (!text.trim()) return 'es';
  const cyr = (text.match(/[\u0400-\u04FF]/g) || []).length;
  if (cyr > text.length * 0.15) return 'ru';
  const lower = text.toLowerCase();
  const ptHits = (lower.match(/\b(nao|não|peao|peão|lance|jogada|brancas|pretas|roque)\b/g) || []).length;
  const enHits = (lower.match(/\b(the|and|with|from|king|queen|rook|bishop|knight|pawn|attack|defense)\b/g) || []).length;
  const esHits = (lower.match(/\b(el|la|los|las|de|del|una|por|para|rey|dama|torre|alfil|caballo|peon|ataque|defensa)\b/g) || []).length;
  if (ptHits >= enHits && ptHits >= esHits && ptHits > 0) return 'pt_br';
  if (enHits > esHits && enHits > ptHits) return 'en';
  return 'es';
}

function wordBoundaryMatch(haystack, needle) {
  const re = new RegExp(
    '(?:^|[^\\p{L}\\p{N}_])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^\\p{L}\\p{N}_])',
    'u'
  );
  return re.test(haystack);
}

function scoreEje(ejeDef, normText) {
  let score = 0;
  let canonMatched = false;
  const seen = new Set();
  for (const lang of ['es', 'en', 'ru', 'pt_br']) {
    const keys = (ejeDef.palabras_clave && ejeDef.palabras_clave[lang]) || [];
    for (let i = 0; i < keys.length; i++) {
      const key = normalizeText(keys[i]);
      if (!key || seen.has(lang + ':' + key)) continue;
      const short = !key.includes(' ') && key.length <= 4;
      const hit = short ? wordBoundaryMatch(normText, key) : normText.includes(key);
      if (hit) {
        seen.add(lang + ':' + key);
        score += i === 0 ? 3 : i === 1 ? 2 : 1;
        if (i === 0) canonMatched = true;
      }
    }
  }
  return { score, canonMatched };
}

export function tagGame(pgnChunk, ejesData) {
  const comments = extractComments(pgnChunk);
  const norm = normalizeText(comments.join(' '));
  const lang = detectLang(comments);
  if (!norm) return { themes: [], lang, hasComments: false };
  const candidates = [];
  for (const ej of ejesData.ejes) {
    const { score, canonMatched } = scoreEje(ej, norm);
    if (score >= 2) {
      candidates.push({
        eje: ej.eje, score, canonMatched, emoji: ej.emoji,
        nombre: ej.nombre, categoria: ej.categoria,
      });
    }
  }
  // Preferir no-piezas en el ranking de relevancia
  candidates.sort((a, b) => {
    const aPiece = a.categoria === 'a' ? 1 : 0;
    const bPiece = b.categoria === 'a' ? 1 : 0;
    if (aPiece !== bPiece) return aPiece - bPiece; // no-pieza primero
    if (b.score !== a.score) return b.score - a.score;
    if (a.canonMatched !== b.canonMatched) return a.canonMatched ? -1 : 1;
    return a.eje - b.eje;
  });
  const themes = candidates.slice(0, 7).map((c) => ({
    eje: c.eje, score: c.score, emoji: c.emoji,
    nombre: c.nombre, categoria: c.categoria,
  }));
  return { themes, lang, hasComments: comments.length > 0 };
}

/**
 * Elige segmento principal: mayor score entre temas reasignados,
 * pero si hay algún tema no-pieza, ignora ejes de categoría "a" para la elección.
 */
function pickPrimarySegment(themes, reassign) {
  if (!themes.length) return null;
  const nonPiece = themes.filter((t) => t.categoria !== 'a');
  const pool = nonPiece.length ? nonPiece : themes;
  let best = null;
  for (const t of pool) {
    const seg = reassign.get(t.eje);
    if (seg == null) continue;
    if (!best || t.score > best.score) best = { segmentId: seg, score: t.score };
  }
  // fallback: cualquier tema
  if (!best) {
    for (const t of themes) {
      const seg = reassign.get(t.eje);
      if (seg == null) continue;
      if (!best || t.score > best.score) best = { segmentId: seg, score: t.score };
    }
  }
  return best;
}

/** Conexiones intra-grupo: mesh completo si <20; si no, estrella + anillo + algunos cordones */
function subgroupEdges(memberIds) {
  const edges = [];
  const n = memberIds.length;
  if (n < 2) return edges;
  if (n < 20) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) edges.push([memberIds[i], memberIds[j]]);
    return edges;
  }
  const hub = memberIds[0];
  for (let i = 1; i < n; i++) edges.push([hub, memberIds[i]]);
  const peri = memberIds.slice(1);
  for (let i = 0; i < peri.length; i++) {
    edges.push([peri[i], peri[(i + 1) % peri.length]]);
    if (i + 3 < peri.length) edges.push([peri[i], peri[i + 3]]);
  }
  return edges;
}

/** Objetivo de líneas totales según tamaño del PGN: 120–360 (siempre red densa) */
function targetEdgeBudget(numGames) {
  if (numGames <= 8) return Math.max(24, numGames * 5);
  if (numGames <= 20) return Math.max(80, numGames * 6);
  if (numGames <= 40) return 140;
  if (numGames <= 80) return 220;
  if (numGames <= 150) return 300;
  return 360;
}

export function buildThematicPlan(gamesTagged, ejesData) {
  const freq = new Map();
  for (const g of gamesTagged) {
    for (const t of g.themes || []) {
      const cur = freq.get(t.eje) || { count: 0, scoreSum: 0 };
      cur.count++;
      cur.scoreSum += t.score || 0;
      freq.set(t.eje, cur);
    }
  }

  const ranked = [...freq.entries()]
    .map(([eje, v]) => ({ eje, count: v.count, scoreSum: v.scoreSum }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.scoreSum !== a.scoreSum) return b.scoreSum - a.scoreSum;
      return a.eje - b.eje;
    });

  const topN = ranked.slice(0, 12).map((r) => r.eje);
  const topSet = new Set(topN);
  const ejeMeta = new Map(ejesData.ejes.map((e) => [e.eje, e]));

  const reassign = new Map();
  for (const eje of topN) reassign.set(eje, eje);

  for (const r of ranked) {
    if (topSet.has(r.eje)) continue;
    const cat = ejesData.catOf[r.eje];
    let dest = topN.find((te) => ejesData.catOf[te] === cat);
    if (dest == null) {
      let best = null, bestInter = -1;
      for (const te of topN) {
        let inter = 0;
        for (const g of gamesTagged) {
          const ejesG = new Set((g.themes || []).map((t) => t.eje));
          if (ejesG.has(r.eje) && ejesG.has(te)) inter++;
        }
        if (inter > bestInter) { bestInter = inter; best = te; }
      }
      dest = best != null ? best : topN[0];
    }
    if (dest != null) reassign.set(r.eje, dest);
  }

  const segments = topN.map((eje) => {
    const meta = ejeMeta.get(eje);
    return {
      id: eje,
      eje,
      emoji: meta ? meta.emoji : '?',
      nombre: meta ? meta.nombre : { es: 'Eje ' + eje },
      categoria: meta ? meta.categoria : '?',
    };
  });

  let lastSegment = null;
  const assignments = [];
  for (let i = 0; i < gamesTagged.length; i++) {
    const themes = gamesTagged[i].themes || [];
    if (!themes.length) {
      if (lastSegment != null) assignments.push({ segmentId: lastSegment, orphan: true, via: 'prev' });
      else assignments.push({ segmentId: 'sin_tema', orphan: true, via: 'sin_tema' });
      continue;
    }
    const best = pickPrimarySegment(themes, reassign);
    if (best) {
      lastSegment = best.segmentId;
      assignments.push({ segmentId: best.segmentId, orphan: false, via: 'score' });
    } else if (lastSegment != null) {
      assignments.push({ segmentId: lastSegment, orphan: true, via: 'prev' });
    } else {
      assignments.push({ segmentId: 'sin_tema', orphan: true, via: 'sin_tema' });
    }
  }

  if (assignments.some((a) => a.segmentId === 'sin_tema')) {
    segments.push({
      id: 'sin_tema', eje: 0, emoji: '❓',
      nombre: { es: 'Sin tema', en: 'No theme', ru: 'Без темы', pt_br: 'Sem tema' },
      categoria: '_',
    });
  }

  // --- Listado jerárquico precomputado: categoría → ejes → game ids ---
  const tree = [];
  for (const catId of CATEGORY_LIST_ORDER) {
    const segsInCat = segments.filter((s) => s.categoria === catId);
    if (!segsInCat.length) continue;
    const axes = [];
    for (const seg of segsInCat) {
      const gameIds = [];
      assignments.forEach((a, i) => {
        if (String(a.segmentId) === String(seg.id)) gameIds.push(gamesTagged[i].id || ('g' + i));
      });
      if (!gameIds.length) continue;
      axes.push({
        segmentId: seg.id,
        eje: seg.eje,
        emoji: seg.emoji,
        nombre: seg.nombre,
        gameIds,
      });
    }
    axes.sort((a, b) => b.gameIds.length - a.gameIds.length);
    if (!axes.length) continue;
    tree.push({
      categoria: catId,
      nombre: CAT_NAMES[catId] || CAT_NAMES._,
      emoji: CAT_EMOJI[catId] || '•',
      axes,
    });
  }

  // Última partida = sol central
  const centerGameId = gamesTagged.length
    ? (gamesTagged[gamesTagged.length - 1].id || ('g' + (gamesTagged.length - 1)))
    : null;

  // --- Grafo: aristas intra + red cruzada (presupuesto 120–360) ---
  const intraEdges = [];
  const bySeg = new Map();
  assignments.forEach((a, i) => {
    const sid = String(a.segmentId);
    if (!bySeg.has(sid)) bySeg.set(sid, []);
    bySeg.get(sid).push(gamesTagged[i].id || ('g' + i));
  });
  for (const [, ids] of bySeg) {
    for (const [a, b] of subgroupEdges(ids)) intraEdges.push([a, b]);
  }

  // Todos los candidatos cruzados (ejes compartidos, distinto segmento)
  const allCross = [];
  for (let i = 0; i < gamesTagged.length; i++) {
    for (let j = i + 1; j < gamesTagged.length; j++) {
      if (String(assignments[i].segmentId) === String(assignments[j].segmentId)) continue;
      const ea = new Set((gamesTagged[i].themes || []).map((t) => t.eje));
      const shared = (gamesTagged[j].themes || []).filter((t) => ea.has(t.eje)).map((t) => t.eje);
      const score = shared.length || 0;
      // También unir algo sin shared para red continua (score 0.1)
      allCross.push({
        a: gamesTagged[i].id || ('g' + i),
        b: gamesTagged[j].id || ('g' + j),
        shared,
        score: score > 0 ? score : 0.1,
      });
    }
  }
  allCross.sort((x, y) => y.score - x.score);

  // Enlaces estructurales hub↔hub entre polos (siempre hay red entre segmentos)
  const hubLinks = [];
  const segHubs = [];
  for (const [sid, ids] of bySeg) {
    if (ids.length) segHubs.push(ids[0]);
  }
  for (let i = 0; i < segHubs.length; i++) {
    for (let j = i + 1; j < segHubs.length; j++) {
      hubLinks.push({ a: segHubs[i], b: segHubs[j], shared: [], score: 0.5 });
    }
  }
  // Mezclar: primero shared reales, luego hubs, luego resto débil
  const rankedCross = [
    ...allCross.filter((c) => (c.shared || []).length > 0),
    ...hubLinks,
    ...allCross.filter((c) => !(c.shared || []).length),
  ];
  // Deduplicar pares
  const seenE = new Set();
  const uniqueCross = [];
  for (const c of rankedCross) {
    const k = c.a < c.b ? c.a + '|' + c.b : c.b + '|' + c.a;
    if (seenE.has(k)) continue;
    seenE.add(k);
    uniqueCross.push(c);
  }

  const budget = targetEdgeBudget(gamesTagged.length);
  const intraCount = intraEdges.length;
  let crossBudget = Math.max(0, budget - intraCount);
  if (crossBudget < Math.min(40, uniqueCross.length)) {
    crossBudget = Math.min(40, uniqueCross.length);
  }
  if (intraCount + crossBudget > 360) crossBudget = Math.max(0, 360 - intraCount);
  // Forzar mínimo de red si hay varios polos
  if (segHubs.length > 1 && crossBudget < segHubs.length - 1) {
    crossBudget = Math.min(uniqueCross.length, Math.max(crossBudget, segHubs.length * 2));
  }

  let permanentCross = uniqueCross.slice(0, crossBudget);
  const crossCandidates = uniqueCross.filter((c) => (c.shared || []).length > 0);

  // Completar presupuesto: rayos al sol central + pares muestreados (red visible)
  const edgeSet = new Set();
  function ek(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  intraEdges.forEach(([a, b]) => edgeSet.add(ek(a, b)));
  permanentCross.forEach((c) => edgeSet.add(ek(c.a, c.b)));

  if (centerGameId) {
    for (const g of gamesTagged) {
      const id = g.id || '';
      if (!id || id === centerGameId) continue;
      const k = ek(centerGameId, id);
      if (edgeSet.has(k)) continue;
      permanentCross.push({ a: centerGameId, b: id, shared: [], score: 0.3 });
      edgeSet.add(k);
    }
  }
  // Rellenar hasta budget con pares dispersos
  const allIds = gamesTagged.map((g, i) => g.id || ('g' + i));
  let guard = 0;
  const want = Math.min(360, Math.max(budget, Math.min(120, Math.max(allIds.length * 4, Math.min(120, allIds.length * (allIds.length - 1) / 2)))));
  while (intraEdges.length + permanentCross.length < want && guard < allIds.length * allIds.length) {
    guard++;
    const i = guard % allIds.length;
    const j = (guard * 7 + 3) % allIds.length;
    if (i === j) continue;
    const k = ek(allIds[i], allIds[j]);
    if (edgeSet.has(k)) continue;
    permanentCross.push({ a: allIds[i], b: allIds[j], shared: [], score: 0.05 });
    edgeSet.add(k);
  }
  // Cap 360
  if (intraEdges.length + permanentCross.length > 360) {
    permanentCross = permanentCross.slice(0, Math.max(0, 360 - intraEdges.length));
  }

  // Radios de galaxia más abiertos (espacio entre nodos del subgrupo)
  const galaxyRadii = {};
  segments.forEach((seg, si) => {
    const tt = si / Math.max(segments.length - 1, 1);
    galaxyRadii[String(seg.id)] = 110 + tt * 130 + ((si * 41) % 45);
  });
  const clusterSpread = Math.min(72, 36 + Math.floor(gamesTagged.length / 8)); // jitter base

  const langCount = {};
  for (const g of gamesTagged) {
    const L = g.lang || 'es';
    langCount[L] = (langCount[L] || 0) + 1;
  }
  const lang = Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'es';

  return {
    segments,
    assignments,
    reassign: Object.fromEntries(reassign),
    lang,
    ranked,
    listTree: tree,
    graph: {
      intraEdges,
      permanentCross,
      crossCandidates,
      galaxyRadii,
      clusterSpread,
      centerGameId,
      maxCrossOnSelect: 25,
    },
  };
}

export function splitPgnGames(pgnText) {
  const t = String(pgnText || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  const byEvent = t.split(/\n(?=\[Event )/g).map((s) => s.trim()).filter(Boolean);
  if (byEvent.length > 1) return byEvent;
  return t.split(/\n\s*\n(?=\[)/g).map((s) => s.trim()).filter(Boolean);
}

export function extractHeaders(gameText) {
  const h = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(gameText)) !== null) h[m[1]] = m[2];
  return h;
}

export async function processPgnToThematic(pgnText, ejesJsonPath) {
  const ejesData = await loadEjes(ejesJsonPath);
  const chunks = splitPgnGames(pgnText);
  if (!chunks.length) throw new Error('No se encontraron partidas PGN.');

  const games = chunks.map((gameText, i) => {
    const h = extractHeaders(gameText);
    const tagged = tagGame(gameText, ejesData);
    return {
      id: 'g' + i,
      white: h.White || '?',
      black: h.Black || '?',
      event: h.Event || '',
      result: h.Result || '*',
      date: h.Date || '',
      site: h.Site || '',
      round: h.Round || '',
      whiteElo: h.WhiteElo || '',
      blackElo: h.BlackElo || '',
      fen: h.FEN || 'start',
      pgn: gameText,
      themes: tagged.themes,
      lang: tagged.lang,
      hasComments: tagged.hasComments,
    };
  });

  const plan = buildThematicPlan(games, ejesData);
  for (let i = 0; i < games.length; i++) {
    games[i].segmentId = plan.assignments[i].segmentId;
    games[i].orphan = plan.assignments[i].orphan;
  }

  return {
    games,
    thematic: {
      segments: plan.segments,
      lang: plan.lang,
      ranked: plan.ranked.slice(0, 15),
      listTree: plan.listTree,
      graph: plan.graph,
    },
  };
}
