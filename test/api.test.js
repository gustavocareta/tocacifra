process.env.DB_PATH = ':memory:';
process.env.SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { buildApp } = await import('../server/index.ts');
const { importFromHtml, importFromText } = await import('../server/importer.ts');

let app;
let auth;
before(async () => {
  app = buildApp();
  await app.ready();
});
after(() => app.close());

const call = (method, url, payload, token = auth) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

test('cadastro, login e rejeicoes', async () => {
  let r = await call('POST', '/api/register', { nick: 'Ana', email: 'ana@example.com', password: '123456' }, null);
  assert.equal(r.statusCode, 201);
  auth = r.json().token;
  r = await call('POST', '/api/register', { nick: 'Ana', email: 'ana@example.com', password: '123456' }, null);
  assert.equal(r.statusCode, 400);
  r = await call('POST', '/api/login', { email: 'ana@example.com', password: 'errada' }, null);
  assert.equal(r.statusCode, 401);
  r = await call('POST', '/api/login', { email: 'ana@example.com', password: '123456' }, null);
  assert.equal(r.statusCode, 200);
  r = await call('GET', '/api/songs', undefined, null);
  assert.equal(r.statusCode, 401);
});

test('musicas: CRUD e isolamento entre usuarios', async () => {
  let r = await call('POST', '/api/songs', { title: 'Minha musica', artist: 'Eu', tone: 'G', body: 'G  D\nletra' });
  assert.equal(r.statusCode, 201);
  const song = r.json();
  r = await call('PUT', `/api/songs/${song.id}`, { ...song, title: 'Renomeada' });
  assert.equal(r.json().title, 'Renomeada');

  const other = (await call('POST', '/api/register', { nick: 'Bia', email: 'bia@example.com', password: '123456' }, null)).json().token;
  r = await call('GET', `/api/songs/${song.id}`, undefined, other);
  assert.equal(r.statusCode, 404);
  r = await call('DELETE', `/api/songs/${song.id}`, undefined, other);
  assert.equal(r.statusCode, 404);
});

test('repertorio com momentos, ordem e sync', async () => {
  const a = (await call('POST', '/api/songs', { title: 'A', body: '' })).json();
  const b = (await call('POST', '/api/songs', { title: 'B', body: '' })).json();
  let r = await call('POST', '/api/setlists', { title: 'Show', items: [{ songId: b.id }, { label: 'Intervalo' }, { songId: a.id }] });
  assert.equal(r.statusCode, 201);
  const set = r.json();
  assert.deepEqual(set.items, [{ songId: b.id, label: null }, { songId: null, label: 'Intervalo' }, { songId: a.id, label: null }]);

  r = await call('POST', '/api/setlists', { title: 'Invalido', items: [{ songId: 99999 }] });
  assert.equal(r.statusCode, 400);

  r = await call('GET', '/api/sync');
  const sync = r.json();
  assert.ok(sync.songs.length >= 3 && sync.setlists.length === 1 && sync.at > 0);
});

test('importacao por texto e por HTML', async () => {
  const r = await call('POST', '/api/import', { text: 'Am   G\numa linha\n\n\n\nF   C\noutra' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().tone, 'Am');
  assert.equal(r.json().body.includes('\n\n\n'), false);

  const html = '<html><title>Exemplo - Artista X - Cifra Club</title><pre><b>C</b>   G\numa &amp; outra</pre></html>';
  const s = importFromHtml(html);
  assert.equal(s.title, 'Exemplo');
  assert.equal(s.artist, 'Artista X');
  assert.equal(s.tone, 'C');
  assert.ok(s.body.includes('uma & outra') && !s.body.includes('<b>'));
  assert.equal(importFromText('G\nx').tone, 'G');
});

test('audio por musica: envia, baixa, isola e remove', async () => {
  const song = (await call('POST', '/api/songs', { title: 'Com audio', body: '' })).json();
  const bytes = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 1, 2, 3, 4, 5]);
  const put = (type, token = auth) => app.inject({ method: 'PUT', url: `/api/songs/${song.id}/audio`, payload: bytes, headers: { authorization: `Bearer ${token}`, 'content-type': type, 'x-filename': encodeURIComponent('base.mp3') } });

  let r = await put('audio/mpeg');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().audioName, 'base.mp3');
  r = await call('GET', `/api/songs/${song.id}/audio`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'audio/mpeg');
  assert.deepEqual(r.rawPayload, bytes);

  const other = (await call('POST', '/api/register', { nick: 'Cris', email: 'cris@example.com', password: '123456' }, null)).json().token;
  assert.equal((await call('GET', `/api/songs/${song.id}/audio`, undefined, other)).statusCode, 404);
  assert.equal((await put('audio/mpeg', other)).statusCode, 404);
  assert.ok((await put('audio/x-evil')).statusCode >= 400);

  r = await call('DELETE', `/api/songs/${song.id}/audio`);
  assert.equal(r.statusCode, 204);
  assert.equal((await call('GET', `/api/songs/${song.id}/audio`)).statusCode, 404);
});

test('limite de tentativas de login (por e-mail), inclusive com a senha certa', async () => {
  await call('POST', '/api/register', { nick: 'Dani', email: 'dani@example.com', password: 'certa123' }, null);
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    const r = await call('POST', '/api/login', { email: 'dani@example.com', password: 'errada' + i }, null);
    blocked = r.statusCode === 429;
  }
  assert.ok(blocked, 'deveria bloquear apos varias falhas');
  const ok = await call('POST', '/api/login', { email: 'dani@example.com', password: 'certa123' }, null);
  assert.equal(ok.statusCode, 429);
});

test('config.js: o servidor proprio usa o backend node', async () => {
  const r = await call('GET', '/config.js', undefined, null);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /javascript/);
  assert.match(r.body, /backend: 'node'/);
  assert.ok(!/supabase/i.test(r.body));
});

test('importacao por URL bloqueia enderecos internos', async () => {
  for (const url of ['http://127.0.0.1/x', 'http://localhost:3000/', 'http://169.254.169.254/', 'file:///etc/passwd']) {
    const r = await call('POST', '/api/import', { url });
    assert.equal(r.statusCode, 400, url);
  }
});
