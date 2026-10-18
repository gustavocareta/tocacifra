import dns from 'node:dns/promises';
import net from 'node:net';
import { importFromHtml, importFromText } from '../public/importer-core.js';

export { importFromHtml, importFromText };

export interface ImportedSong {
  title: string;
  artist: string;
  tone: string;
  body: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use um link http ou https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Endereco nao permitido.');
  return url;
}

/** Baixa UMA pagina indicada pelo usuario (sem rastreamento em massa) e extrai a cifra. */
export async function importFromUrl(raw: string): Promise<ImportedSong> {
  let url = await assertPublicHttpUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'TocaCifra/0.1 (importacao pessoal)', accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicHttpUrl(new URL(res.headers.get('location')!, url).href);
      continue;
    }
    if (!res.ok) throw new Error(`O site respondeu ${res.status}.`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain/.test(type)) throw new Error('O link nao e uma pagina de texto.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Pagina muito grande.');
    const html = buf.toString('utf8');
    const song = /text\/plain/.test(type) ? importFromText(html) : importFromHtml(html);
    if (!song.body) throw new Error('Nao encontrei uma cifra nessa pagina. Cole o texto manualmente.');
    return song;
  }
  throw new Error('Redirecionamentos demais.');
}
