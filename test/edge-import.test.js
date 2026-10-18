import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractFromHtml, isPrivateIp, assertHttpUrl, handler, decodeEntities } = await import('../supabase/functions/import-cifra/index.ts');

test('extrai titulo, artista e o maior bloco <pre>', () => {
  const html = '<html><title>Musica Teste - Artista Y | Cifra Club</title><body><pre>curto</pre><pre><b>Am</b>   G\nlinha &amp; verso inventado\n<b>F</b>   C</pre></body></html>';
  const s = extractFromHtml(html);
  assert.equal(s.title, 'Musica Teste');
  assert.equal(s.artist, 'Artista Y');
  assert.equal(s.body, 'Am   G\nlinha & verso inventado\nF   C');
  assert.equal(extractFromHtml('<html><title>x</title><p>sem cifra</p></html>').body, '');
  assert.equal(decodeEntities('a&nbsp;b &#65; &#x42; &desconhecida;'), 'a b A B &desconhecida;');
});

test('bloqueia enderecos internos e esquemas perigosos', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.9', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '224.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
  for (const u of ['file:///etc/passwd', 'ftp://x.com/a', 'javascript:alert(1)', 'http://localhost:3000/', 'http://api.localhost/', 'http://meta.internal/', 'nao e url']) assert.throws(() => assertHttpUrl(u), u);
  assert.equal(assertHttpUrl('https://exemplo.com/musica').hostname, 'exemplo.com');
});

test('handler: CORS, metodo, login obrigatorio e corpo invalido', async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'SUPABASE_URL' ? 'https://projeto.supabase.co' : undefined) }, resolveDns: async () => [] };
  const pre = await handler(new Request('https://f.test/', { method: 'OPTIONS' }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handler(new Request('https://f.test/', { method: 'GET' }))).status, 405);
  const noAuth = await handler(new Request('https://f.test/', { method: 'POST', body: '{}' }));
  assert.equal(noAuth.status, 401);

  const realFetch = globalThis.fetch;
  try {
    // login invalido
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    const bad = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer x', apikey: 'k' }, body: '{"url":"https://exemplo.com"}' }));
    assert.equal(bad.status, 401);
    // login valido, mas sem link
    globalThis.fetch = async () => new Response('{"id":"u"}', { status: 200 });
    const noUrl = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' }));
    assert.equal(noUrl.status, 400);
    // login valido + endereco interno: recusado antes de qualquer download
    const internal = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{"url":"http://127.0.0.1/x"}' }));
    assert.equal(internal.status, 400);
    assert.match((await internal.json()).error, /nao permitido/i);
  } finally { globalThis.fetch = realFetch; }
});

test('handler: baixa a pagina, extrai a cifra e segue redirecionamento publico', async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'SUPABASE_URL' ? 'https://projeto.supabase.co' : undefined) }, resolveDns: async (_h, t) => (t === 'A' ? ['93.184.216.34'] : []) };
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, init) => {
      const u = String(input?.href ?? input);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return new Response('{"id":"u"}', { status: 200 });
      if (u === 'https://exemplo.com/a') return new Response(null, { status: 301, headers: { location: '/b' } });
      if (u === 'https://exemplo.com/b') return new Response('<title>Teste - Ana</title><pre>G   D\nletra inventada</pre>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      return new Response('x', { status: 404 });
    };
    const ok = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer t', apikey: 'k' }, body: '{"url":"https://exemplo.com/a"}' }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { title: 'Teste', artist: 'Ana', body: 'G   D\nletra inventada' });
    assert.ok(calls.includes('https://exemplo.com/b'));

    // redirecionamento para endereco interno e barrado
    globalThis.fetch = async (input) => {
      const u = String(input?.href ?? input);
      if (u.includes('/auth/v1/user')) return new Response('{}', { status: 200 });
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    };
    const redir = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"url":"https://exemplo.com/a"}' }));
    assert.equal(redir.status, 400);

    // pagina sem cifra
    globalThis.fetch = async (input) => {
      const u = String(input?.href ?? input);
      if (u.includes('/auth/v1/user')) return new Response('{}', { status: 200 });
      return new Response('<p>nada</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const none = await handler(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"url":"https://exemplo.com/c"}' }));
    assert.equal(none.status, 422);
  } finally { globalThis.fetch = realFetch; }
});
