// Edge Function "import-cifra": baixa UMA pagina de cifra indicada pelo usuario logado e devolve titulo, artista e texto.
// Uso pessoal, uma musica por vez (sem rastreamento). O app normaliza o texto e detecta o tom no navegador.
// Publicar no Supabase: Edge Functions > Deploy a new function > Via Editor (nome: import-cifra), colar este arquivo
// e DESLIGAR "Verify JWT" (a funcao confere o login sozinha, o que funciona com as chaves novas do Supabase).

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}

/** Maior bloco <pre> da pagina (onde as cifras costumam ficar) e o <title> como "Musica - Artista". */
export function extractFromHtml(html: string): { title: string; artist: string; body: string } {
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => stripTags(m[1]));
  const body = (pres.sort((a, b) => b.length - a.length)[0] ?? '').trim();
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const parts = decodeEntities(titleTag).replace(/\s*[-|]\s*(cifra\s*club|cifras?|letras?).*$/i, '').split(/\s+[-–]\s+/);
  return { title: (parts[0] ?? '').trim(), artist: (parts[1] ?? '').trim(), body };
}

export function isPrivateIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Link invalido.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use um link http ou https.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('Endereco nao permitido.');
  return url;
}

// deno-lint-ignore no-explicit-any
declare const Deno: any;

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('Endereco nao permitido.');
    return;
  }
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  const all = [...a, ...aaaa];
  if (!all.length || all.some((ip: string) => isPrivateIp(ip))) throw new Error('Endereco nao permitido.');
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Pagina muito grande.'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return new TextDecoder('utf-8').decode(all);
}

async function fetchPage(raw: string): Promise<{ html: string; type: string }> {
  let url = assertHttpUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'TocaCifra/1.0 (importacao pessoal, uma pagina por vez)', accept: 'text/html,text/plain' },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = assertHttpUrl(new URL(loc, url).href); continue; }
    if (!res.ok) throw new Error(`O site respondeu ${res.status}.`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain/.test(type)) throw new Error('O link nao e uma pagina de texto.');
    return { html: await readLimited(res), type };
  }
  throw new Error('Redirecionamentos demais.');
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Metodo nao permitido.' });

  // so quem esta logado pode usar (confere o token no servico de login do projeto)
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!token || !supabaseUrl) return json(401, { error: 'Faca login para importar.' });
  try {
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey } });
    if (!who.ok) return json(401, { error: 'Sessao expirada. Entre novamente.' });
  } catch {
    return json(502, { error: 'Nao foi possivel confirmar o login agora.' });
  }

  let url = '';
  try { url = String((await req.json())?.url ?? '').trim(); } catch { /* corpo invalido */ }
  if (!url) return json(400, { error: 'Envie o link da cifra.' });

  try {
    const { html, type } = await fetchPage(url);
    const song = /text\/plain/.test(type) ? { title: '', artist: '', body: html.trim() } : extractFromHtml(html);
    if (!song.body) return json(422, { error: 'Nao encontrei uma cifra nessa pagina. Copie o texto da cifra e cole manualmente.' });
    return json(200, song);
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'Nao foi possivel importar.' });
  }
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(handler);
