/** Atualizacao do aplicativo Android: compara a versao instalada com a do APK mais recente publicado no GitHub. */
export const RELEASE_API = 'https://api.github.com/repos/gustavocareta/tocacifra/releases/tags/android-latest';
export const APK_URL = 'https://github.com/gustavocareta/tocacifra/releases/download/android-latest/TocaCifra.apk';

/** Le o identificador da versao ("[build:<sha>]") nas notas da release. */
export function shaFromNotes(notes) {
  const m = /\[build:([0-9a-f]{7,40})\]/i.exec(String(notes ?? ''));
  return m ? m[1].toLowerCase() : null;
}

export const shortSha = (s) => (s && s !== 'dev' ? String(s).slice(0, 7) : 'dev');

/** @returns {{ state: 'current'|'available'|'unknown', local: string|null, remote: string|null }} */
export function compareVersions(local, remote) {
  if (!local || local === 'dev' || !remote) return { state: 'unknown', local: local ?? null, remote: remote ?? null };
  return { state: local.toLowerCase() === remote.toLowerCase() ? 'current' : 'available', local, remote };
}

export async function localVersion(fetchFn = fetch) {
  try {
    const r = await fetchFn('version.json', { cache: 'no-store' });
    return (await r.json()).sha ?? null;
  } catch { return null; }
}

export async function checkForUpdate(fetchFn = fetch) {
  const local = await localVersion(fetchFn);
  const r = await fetchFn(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('Nao foi possivel consultar a ultima versao.');
  const rel = await r.json();
  return compareVersions(local, shaFromNotes(rel.body));
}
