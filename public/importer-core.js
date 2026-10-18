// Importacao de cifras: partes puras (sem rede), usadas pelo servidor Node e pelo navegador.
import { guessKey, normalizeBody, tidyCifra } from './chords.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

export function stripTags(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}

/** Texto colado pelo usuario: normaliza a cifra e detecta o tom. */
export function importFromText(text, hint = {}) {
  const body = tidyCifra(normalizeBody(text));
  return { title: hint.title ?? '', artist: hint.artist ?? '', tone: guessKey(body), body };
}

/** Extrai a cifra de uma pagina HTML: usa o maior bloco <pre> e o <title> como "Musica - Artista". */
export function importFromHtml(html) {
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => stripTags(m[1]));
  const body = tidyCifra(normalizeBody(pres.sort((a, b) => b.length - a.length)[0] ?? ''));
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const parts = decodeEntities(titleTag).replace(/\s*[-|]\s*(cifra\s*club|cifras?|letras?).*$/i, '').split(/\s+[-–]\s+/);
  return { title: (parts[0] ?? '').trim(), artist: (parts[1] ?? '').trim(), tone: guessKey(body), body };
}
