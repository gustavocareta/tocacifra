// Logica de cifras compartilhada entre navegador e servidor (ES module, sem dependencias).
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_IDX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const CHORD_RE = /^([A-G][#b]?)((?:m(?!aj)|M|maj|min|dim|aug|sus|add|°|º|\+|-|\d|#|b|\(|\))*)(?:\/([A-G][#b]?))?$/;

export const KEYS = SHARP.flatMap((n) => [n, n + 'm']);

export function parseChord(token) {
  const m = CHORD_RE.exec(token);
  return m ? { root: m[1], suffix: m[2], bass: m[3] ?? null } : null;
}

export function isChord(token) {
  return CHORD_RE.test(token);
}

/** Linha de acordes: mais da metade dos termos sao acordes (ex.: "(Intro) G G/B C"). */
export function isChordLine(line) {
  // ignora parenteses e marcas de repeticao/compasso: "( D4 D )", "(2x)", "|" nao contam como texto
  const tokens = line.trim().split(/\s+/).map((t) => t.replace(/^[([]+|[)\]]+$/g, '')).filter((t) => t && !/^(\d+x|x\d+|[|\-–—/.:]+)$/i.test(t));
  if (!tokens.length) return false;
  const chords = tokens.filter(isChord).length;
  return chords > 0 && chords / tokens.length > 0.5;
}

function shift(note, steps, flat) {
  const idx = NOTE_IDX[note];
  if (idx === undefined) return note;
  return (flat ? FLAT : SHARP)[(((idx + steps) % 12) + 12) % 12];
}

export function transposeChord(token, steps) {
  const c = parseChord(token);
  if (!c) return token;
  const flat = c.root.includes('b') || (c.bass?.includes('b') ?? false);
  return shift(c.root, steps, flat) + c.suffix + (c.bass ? '/' + shift(c.bass, steps, flat) : '');
}

function transposeLine(line, steps) {
  let out = '';
  for (const m of line.matchAll(/\S+/g)) {
    // mantem o alinhamento original: preenche ate a coluna em que o termo comecava
    if (m.index > 0) out += ' '.repeat(Math.max(1, m.index - out.length));
    out += transposeChord(m[0], steps);
  }
  return out;
}

export function transposeBody(body, steps) {
  if (!steps) return body;
  return body.split('\n').map((l) => (isChordLine(l) ? transposeLine(l, steps) : l)).join('\n');
}

/** Primeiro acorde da cifra, usado como tom provavel. */
export function guessKey(body) {
  for (const line of body.split('\n')) {
    if (!isChordLine(line)) continue;
    const first = line.trim().split(/\s+/).find(isChord);
    const c = first && parseChord(first);
    if (c) return c.root + (/^m(?!aj)/.test(c.suffix) ? 'm' : '');
  }
  return '';
}

/** Distancia em semitons entre dois tons (ex.: G -> A = 2). */
export function stepsBetween(from, to) {
  const a = NOTE_IDX[from.replace(/m$/, '')];
  const b = NOTE_IDX[to.replace(/m$/, '')];
  return a === undefined || b === undefined ? 0 : (((b - a) % 12) + 12) % 12;
}

export function normalizeBody(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Titulo de parte ("[Refrao]", "Intro:"): nao e letra cantada, nao se cola na cifra de cima. */
export const isHeadingLine = (text) => /^\s*\[[^\]]*\]\s*$/.test(text) || /:\s*$/.test(text);

/** Indice da letra que pertence a linha de acordes `i` (pulando linhas em branco), ou -1 se nao houver. */
export function lyricFor(lines, i) {
  let k = i + 1;
  while (k < lines.length && !lines[k].text.trim()) k++;
  const l = lines[k];
  return l && !l.chord && !isHeadingLine(l.text) ? k : -1;
}

/**
 * Arruma a cifra: tira as linhas em branco entre os acordes e a letra deles, para que nunca
 * fiquem separados (inclusive em paginas diferentes). Nao mexe em mais nada.
 */
export function tidyCifra(body) {
  const lines = body.split('\n').map((text) => ({ text, chord: isChordLine(text) }));
  const drop = new Set();
  lines.forEach((l, i) => {
    if (!l.chord) return;
    const k = lyricFor(lines, i);
    if (k > i + 1) for (let j = i + 1; j < k; j++) drop.add(j);
  });
  return lines.filter((_, i) => !drop.has(i)).map((l) => l.text).join('\n');
}

/** Classifica cada linha para a renderizacao. */
export function classifyLines(body) {
  return body.split('\n').map((text) => ({ text, chord: isChordLine(text) }));
}

/* ---- secoes (refrao, 2a voz): trechos entre linhas {refrao} ... {/refrao} ---- */
export const SECTIONS = { refrao: 'Refrão', voz2: '2ª Voz' };
const SECTION_RE = /^\s*\{(\/)?(refrao|voz2)\}\s*$/i;

/** Linhas para exibir: marcadores somem e cada linha carrega a secao em que esta (ou null). */
export function parseLines(body) {
  let section = null;
  const out = [];
  for (const text of body.split('\n')) {
    const m = SECTION_RE.exec(text);
    if (m) {
      const type = m[2].toLowerCase();
      if (!m[1]) section = type;
      else if (section === type) section = null;
      continue;
    }
    out.push({ text, chord: isChordLine(text), section });
  }
  return out;
}

/**
 * Quebra um par cifra/letra em varias linhas de no maximo `width` caracteres, sempre em inicio de palavra
 * e sem partir um acorde ao meio; cada acorde continua sobre a mesma silaba (a coluna e recalculada).
 * `lyric` pode ser '' (linha so de acordes: quebra entre acordes). Devolve [{ chord, lyric }].
 */
export function wrapPair(chord, lyric, width) {
  const w = Math.max(8, Math.floor(width) || 0);
  const primary = lyric.trim() ? lyric : chord;
  const inChord = (b) => { for (const m of chord.matchAll(/\S+/g)) if (m.index < b && b < m.index + m[0].length) return true; return false; };
  const wordStart = (b) => b > 0 && b < primary.length && primary[b] !== ' ' && primary[b - 1] === ' ';
  const out = [];
  let start = 0;
  const total = Math.max(chord.length, lyric.length);
  while (start < total) {
    if (total - start <= w) { out.push({ chord: chord.slice(start).trimEnd(), lyric: lyric.slice(start).trimEnd() }); break; }
    let b = -1;
    for (let k = start + w; k > start; k--) if (wordStart(k) && !inChord(k)) { b = k; break; }
    if (b < 0) { // palavra/acorde maior que a linha: corta no limite sem partir acorde
      b = start + w;
      while (b > start + 1 && inChord(b)) b--;
      if (b <= start) b = start + w;
    }
    out.push({ chord: chord.slice(start, b).trimEnd(), lyric: lyric.slice(start, b).trimEnd() });
    start = b;
  }
  return out.length ? out : [{ chord, lyric }];
}

/** Marca (ou desmarca, se ja marcado) as linhas startLine..endLine (0-based) como secao `type`. */
export function toggleSection(body, startLine, endLine, type) {
  const lines = body.split('\n');
  const a = Math.max(0, Math.min(startLine, lines.length - 1));
  const b = Math.max(a, Math.min(endLine, lines.length - 1));
  const open = `{${type}}`, close = `{/${type}}`;
  if (lines[a - 1]?.trim().toLowerCase() === open && lines[b + 1]?.trim().toLowerCase() === close) {
    lines.splice(b + 1, 1);
    lines.splice(a - 1, 1);
  } else {
    lines.splice(b + 1, 0, close);
    lines.splice(a, 0, open);
  }
  return lines.join('\n');
}

/** Remove os marcadores (para exportar/copiar o texto limpo). */
export function stripSections(body) {
  return body.split('\n').filter((l) => !SECTION_RE.test(l)).join('\n');
}
