// Acordes desenhados: gera a digitacao por busca (sem tabela fixa) e desenha o diagrama em SVG.
import { parseChord } from './chords.js';

const NOTE_IDX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Cordas da mais grave para a mais aguda, em semitons (0 = C). */
export const INSTRUMENTS = {
  violao: { label: 'Violão', strings: [4, 9, 2, 7, 11, 4] }, // E A D G B E
  cavaco: { label: 'Cavaquinho', strings: [2, 7, 11, 2] }, // D G B D
  ukulele: { label: 'Ukulele', strings: [7, 0, 4, 9] }, // G C E A
};

/** Intervalos do acorde (semitons a partir da raiz) e quais sao indispensaveis. */
export function chordTones(suffix) {
  const s = suffix.replace(/[()]/g, '');
  let third = /^m(?!aj)|^min|^dim/.test(s) ? 3 : 4;
  let fifth = /dim|b5/.test(s) ? 6 : /aug|\+|#5/.test(s) ? 8 : 7;
  const tones = new Set([0]);
  const must = new Set([0]);
  if (/sus2/.test(s)) { tones.add(2); must.add(2); } else if (/sus4?(?!\d)|sus4/.test(s)) { tones.add(5); must.add(5); } else { tones.add(third); must.add(third); }
  tones.add(fifth);
  if (/maj7|M7|Δ/.test(s)) { tones.add(11); must.add(11); }
  else if (/dim7/.test(s)) { tones.add(9); must.add(9); }
  else if (/7|9|11|13/.test(s)) { tones.add(10); must.add(10); }
  if (/6/.test(s) && !/13/.test(s)) { tones.add(9); must.add(9); }
  if (/9|add9/.test(s)) { tones.add(2); must.add(2); }
  if (/11|add11/.test(s)) { tones.add(5); must.add(5); }
  if (/13/.test(s)) { tones.add(9); must.add(9); }
  if (must.size >= 3 && !/b5|#5|aug|\+|dim/.test(s)) must.delete(fifth); // quinta pode ser omitida em acordes de 4+ notas
  if (/b9/.test(s)) { tones.add(1); }
  return { tones, must };
}

const cache = new Map();

/**
 * Melhor digitacao para o acorde. Retorna { frets: [-1|0..n por corda], base } ou null.
 * -1 = corda abafada; 0 = solta. `base` e a primeira casa mostrada no diagrama (1 = bem no inicio).
 */
export function chordShape(name, instrument = 'violao') {
  const key = `${instrument}:${name}`;
  if (cache.has(key)) return cache.get(key);
  const c = parseChord(name);
  const inst = INSTRUMENTS[instrument];
  let result = null;
  if (c && inst && c.root in NOTE_IDX) {
    const root = NOTE_IDX[c.root];
    const bass = c.bass && c.bass in NOTE_IDX ? NOTE_IDX[c.bass] : root;
    const { tones, must } = chordTones(c.suffix);
    const allowed = new Set([...tones].map((t) => (root + t) % 12));
    if (bass !== root) allowed.add(bass);
    const required = new Set([...must].map((t) => (root + t) % 12));
    result = search(inst.strings, allowed, required, bass, root);
  }
  cache.set(key, result);
  return result;
}

function search(strings, allowed, required, bass, root) {
  const n = strings.length;
  let best = null;
  for (let base = 0; base <= 9; base++) {
    const hi = base + 3; // janela de 4 casas
    const opts = strings.map((open) => {
      const o = [{ f: -1 }];
      if (base <= 1 && allowed.has(open % 12)) o.push({ f: 0 }); // corda solta so conta no inicio do braco
      for (let f = Math.max(base, 1); f <= hi; f++) if (allowed.has((open + f) % 12)) o.push({ f });
      return o;
    });
    const cur = new Array(n).fill(-1);
    const walk = (i) => {
      if (i === n) { evaluate(cur); return; }
      for (const o of opts[i]) { cur[i] = o.f; walk(i + 1); }
    };
    const evaluate = (frets) => {
      const played = frets.map((f, i) => (f >= 0 ? (strings[i] + f) % 12 : null));
      const notes = played.filter((x) => x !== null);
      if (notes.length < Math.min(n, 3) || notes.length < n - 2) return;
      if (![...required].every((t) => notes.includes(t))) return;
      const lowest = played.findIndex((x) => x !== null);
      if (played[lowest] !== bass) return; // o baixo tem que ser a raiz (ou o baixo da barra)
      // cordas abafadas so podem ficar nas pontas mais graves
      const firstPlayed = lowest;
      for (let i = firstPlayed; i < n; i++) if (frets[i] === -1) return;
      const fretted = frets.filter((f) => f > 0);
      const min = fretted.length ? Math.min(...fretted) : 0;
      const max = fretted.length ? Math.max(...fretted) : 0;
      if (max - min > 3) return;
      // custo: prefere cordas soltas, posicao baixa, poucos dedos e poucas cordas abafadas
      const muted = frets.filter((f) => f === -1).length;
      const open = frets.filter((f) => f === 0).length;
      const fingers = fretted.length;
      const barre = fretted.filter((f) => f === min).length > 1 ? 1 : 0;
      const cost = muted * 3 + fingers * 2 + (max - min) * 1.5 + min * 1.2 - open * 1.5 + barre * 4 + (fingers > 4 ? 20 : 0);
      if (!best || cost < best.cost) best = { cost, frets: [...frets] };
    };
    walk(0);
  }
  if (!best) return null;
  const fretted = best.frets.filter((f) => f > 0);
  const min = fretted.length ? Math.min(...fretted) : 1;
  const max = fretted.length ? Math.max(...fretted) : 1;
  const base = max <= 4 ? 1 : min;
  return { frets: best.frets, base };
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/** Desenha o diagrama. `left` espelha para canhotos. */
export function chordSvg(name, shape, { left = false } = {}) {
  const n = shape.frets.length;
  const W = 70, H = 90, x0 = 14, x1 = W - 12, y0 = 26, y1 = H - 8, rows = 4;
  const sx = (i) => x0 + ((left ? n - 1 - i : i) * (x1 - x0)) / (n - 1);
  const sy = (r) => y0 + (r * (y1 - y0)) / rows;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: 70, height: 90, role: 'img', 'aria-label': `Acorde ${name}` });
  svg.append(el('text', { x: W / 2, y: 11, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'currentColor' }, name));
  for (let r = 0; r <= rows; r++) svg.append(el('line', { x1: x0, x2: x1, y1: sy(r), y2: sy(r), stroke: 'currentColor', 'stroke-width': r === 0 && shape.base === 1 ? 3 : 1, opacity: 0.8 }));
  for (let i = 0; i < n; i++) svg.append(el('line', { x1: sx(i), x2: sx(i), y1: y0, y2: y1, stroke: 'currentColor', 'stroke-width': 1, opacity: 0.8 }));
  if (shape.base > 1) svg.append(el('text', { x: 1, y: sy(0) + 12, 'font-size': 9, fill: 'currentColor' }, String(shape.base)));
  shape.frets.forEach((f, i) => {
    if (f === -1) svg.append(el('text', { x: sx(i), y: y0 - 4, 'text-anchor': 'middle', 'font-size': 9, fill: 'currentColor' }, '×'));
    else if (f === 0) svg.append(el('circle', { cx: sx(i), cy: y0 - 7, r: 3, fill: 'none', stroke: 'currentColor' }));
    else svg.append(el('circle', { cx: sx(i), cy: sy(f - shape.base) + (y1 - y0) / rows / 2, r: 4.2, fill: 'currentColor' }));
  });
  return svg;
}
