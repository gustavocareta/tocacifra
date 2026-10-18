// Filtros da biblioteca (artista, estilo, tom, busca). Logica pura, sem DOM.

/** Minusculas e sem acento: "Zé Ramalho" casa com "ze ramalho". */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

/** Texto da cifra sem os marcadores {refrao}/{voz2}, para busca na letra. */
const lyrics = (body) => String(body ?? '').replace(/^\s*\{\/?(refrao|voz2)\}\s*$/gim, ' ');

/** Valores distintos de um campo (agrupando variacoes de maiusculas/acentos), com contagem, em ordem alfabetica. */
function facet(songs, field) {
  const map = new Map();
  for (const s of songs) {
    const name = String(s[field] ?? '').trim();
    if (!name) continue;
    const key = norm(name);
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { key, name, count: 1 });
  }
  return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
}

export const facets = (songs) => ({ artists: facet(songs, 'artist'), styles: facet(songs, 'style'), tones: facet(songs, 'tone') });

/**
 * Filtra musicas. `artist`, `style` e `tone` sao chaves (norm) vindas de `facets`; vazio = todos.
 * `term` busca no titulo, no artista e na letra, sem acento.
 */
export function filterSongs(songs, { term = '', artist = '', style = '', tone = '' } = {}) {
  const t = norm(term);
  return songs.filter((s) =>
    (!artist || norm(s.artist) === artist) &&
    (!style || norm(s.style) === style) &&
    (!tone || norm(s.tone) === tone) &&
    (!t || norm(`${s.title} ${s.artist} ${lyrics(s.body)}`).includes(t)));
}
