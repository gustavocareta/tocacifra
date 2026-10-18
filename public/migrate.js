/**
 * Importa um arquivo de backup (.json) com musicas e repertorios para a conta logada.
 * Formato: { songs: [{ ref, title, artist, style, tone, capo, body }], setlists: [{ title, style, items: [ref | { label }] }] }
 * Musicas que ja existem (mesmo titulo e artista) sao puladas e reaproveitadas nos repertorios.
 */
const norm = (s) => String(s ?? '').trim().toLowerCase();
const keyOf = (s) => `${norm(s.title)}|${norm(s.artist)}`;

export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('O arquivo nao e um backup valido (JSON).'); }
  if (!d || !Array.isArray(d.songs) || !Array.isArray(d.setlists)) throw new Error('O arquivo nao tem musicas e repertorios no formato esperado.');
  return d;
}

/**
 * @param {object} data  resultado de parseBackup
 * @param {{ songs: any[], setlists: any[] }} existing  o que ja existe na conta
 * @param {{ putSong: Function, putSetlist: Function }} api
 * @param {(msg: string, done: number, total: number) => void} [onProgress]
 */
export async function importBackup(data, existing, api, onProgress) {
  const have = new Map(existing.songs.map((s) => [keyOf(s), s.id]));
  const haveSets = new Set(existing.setlists.map((l) => norm(l.title)));
  const total = data.songs.length + data.setlists.length;
  const refToId = new Map();
  const res = { songsAdded: 0, songsSkipped: 0, setsAdded: 0, setsSkipped: 0, failed: [] };
  let done = 0;

  for (const s of data.songs) {
    onProgress?.(`Musica: ${s.title}`, done++, total);
    const k = keyOf(s);
    if (have.has(k)) { refToId.set(s.ref, have.get(k)); res.songsSkipped++; continue; }
    try {
      const r = await api.putSong(null, { title: s.title, artist: s.artist, style: s.style, tone: s.tone, capo: s.capo, body: s.body });
      refToId.set(s.ref, r.id); have.set(k, r.id); res.songsAdded++;
    } catch (e) { res.failed.push(`${s.title}: ${e.message}`); }
  }

  for (const l of data.setlists) {
    onProgress?.(`Repertorio: ${l.title}`, done++, total);
    if (haveSets.has(norm(l.title))) { res.setsSkipped++; continue; }
    const items = [];
    for (const it of l.items) {
      if (it && typeof it === 'object') { if (it.label) items.push({ label: it.label }); continue; }
      if (refToId.has(it)) items.push({ songId: refToId.get(it) });
    }
    try { await api.putSetlist(null, { title: l.title, style: l.style ?? '', items }); res.setsAdded++; haveSets.add(norm(l.title)); }
    catch (e) { res.failed.push(`Repertorio ${l.title}: ${e.message}`); }
  }
  onProgress?.('Concluido', total, total);
  return res;
}
