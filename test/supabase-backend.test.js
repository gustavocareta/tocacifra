import { test } from 'node:test';
import assert from 'node:assert/strict';

// o modulo usa location (so para o redirectTo): define um valor de teste
globalThis.location = { origin: 'https://exemplo.github.io', pathname: '/tocacifra/' };
const { createSupabaseBackend, isNetworkError, translateError } = await import('../public/backend-supabase.js');
const { OfflineError } = await import('../public/errors.js');

/* ---------- cliente de mentira (sem rede) ---------- */
function fakeClient({ results = {}, session = { user: { id: 'u-1', email: 'a@b.c', user_metadata: { nick: 'Ana' } } } } = {}) {
  const calls = [];
  const builder = (key) => {
    const b = {
      insert: (v) => { calls.push([key, 'insert', v]); return b; },
      update: (v) => { calls.push([key, 'update', v]); return b; },
      delete: () => { calls.push([key, 'delete']); return b; },
      select: () => b, single: () => b,
      eq: (c, v) => { calls.push([key, 'eq', c, v]); return b; },
      then: (res, rej) => {
        const r = results[key];
        return (r instanceof Error ? Promise.reject(r) : Promise.resolve(r ?? { data: null, error: null })).then(res, rej);
      },
    };
    return b;
  };
  const storage = {
    from: (bucket) => ({
      upload: async (path, file, opts) => { calls.push(['storage', 'upload', bucket, path, opts]); return results.upload ?? { error: null }; },
      remove: async (paths) => { calls.push(['storage', 'remove', bucket, paths]); return { error: null }; },
      download: async (path) => { calls.push(['storage', 'download', bucket, path]); return results.download ?? { data: new Blob(['x']), error: null }; },
    }),
  };
  const auth = {
    onAuthStateChange: (fn) => { auth.emit = fn; return { data: { subscription: {} } }; },
    getSession: async () => ({ data: { session }, error: null }),
    signUp: async (a) => { calls.push(['auth', 'signUp', a]); return results.signUp ?? { data: { session: { }, user: { email: a.email, user_metadata: a.options.data } }, error: null }; },
    signInWithPassword: async (a) => { calls.push(['auth', 'signIn', a.email]); return results.signIn ?? { data: { user: { email: a.email, user_metadata: { nick: 'Ana' } } }, error: null }; },
    signOut: async (o) => { calls.push(['auth', 'signOut', o]); return { error: null }; },
    resetPasswordForEmail: async (e, o) => { calls.push(['auth', 'reset', e, o]); return { error: null }; },
    updateUser: async (u) => { calls.push(['auth', 'update', Object.keys(u)]); return { error: null }; },
  };
  return {
    calls, auth, storage,
    from: (t) => builder(`from.${t}`),
    rpc: (fn, args) => { calls.push(['rpc', fn, args]); return builder(`rpc.${fn}`); },
  };
}
const make = (opts) => { const client = fakeClient(opts); return createSupabaseBackend({ siteUrl: '' }, { client }).then((b) => ({ b, client })); };

const row = { id: 7, title: 'Musica', artist: 'Ana', tone: 'G', capo: 0, style: 'Rock', body: 'G  D', audio_name: null, updated_at: '2026-10-17T10:00:00Z' };

/* ---------- ajudantes puros ---------- */
test('isNetworkError reconhece falhas de rede e nao confunde erro de negocio', () => {
  assert.equal(isNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkError({ name: 'AuthRetryableFetchError', message: 'x' }), true);
  assert.equal(isNetworkError({ message: 'TypeError: Failed to fetch' }), true);
  assert.equal(isNetworkError({ message: 'Load failed' }), true); // Safari
  assert.equal(isNetworkError({ message: 'Invalid login credentials' }), false);
  assert.equal(isNetworkError(null), false);
});

test('translateError traduz os erros comuns', () => {
  assert.equal(translateError({ message: 'Invalid login credentials' }), 'E-mail ou senha incorretos.');
  assert.equal(translateError({ message: 'User already registered' }), 'Este e-mail ja esta cadastrado.');
  assert.equal(translateError({ message: 'Signups not allowed for this instance' }), 'Novos cadastros estao desativados neste site.');
  assert.match(translateError({ message: 'Email not confirmed' }), /Confirme o seu e-mail/);
  assert.match(translateError({ message: 'x', code: 'over_email_send_rate_limit' }), /Muitas tentativas/);
  assert.match(translateError({ message: 'Password should be at least 6 characters' }), /pelo menos 6/);
  assert.match(translateError({ message: 'x', code: '23514' }), /Dados invalidos/);
  assert.match(translateError({ message: 'x', code: '42501' }), /Sem permissao/);
  assert.equal(translateError({ message: 'Informe o titulo.', code: '22023' }), 'Informe o titulo.');
  assert.equal(translateError({ message: 'algo estranho' }, 'padrao'), 'padrao');
});

/* ---------- adaptador ---------- */
test('sync devolve o formato do app', async () => {
  const { b, client } = await make({ results: { 'rpc.sync_all': { data: { songs: [{ id: 1 }], setlists: [] }, error: null } } });
  const s = await b.sync();
  assert.deepEqual(s.songs, [{ id: 1 }]);
  assert.ok(s.at > 0);
  assert.deepEqual(client.calls[0], ['rpc', 'sync_all', undefined]);
});

test('putSong: cria, atualiza, limpa campos e converte a linha', async () => {
  const { b, client } = await make({ results: { 'from.songs': { data: row, error: null } } });
  const created = await b.putSong(null, { title: '  Musica ', artist: ' Ana', tone: 'G', capo: '2', style: 'Rock', body: 'G  D', audioName: 'x', id: 99 });
  assert.deepEqual(created, { id: 7, title: 'Musica', artist: 'Ana', tone: 'G', capo: 0, style: 'Rock', body: 'G  D', updatedAt: Date.parse('2026-10-17T10:00:00Z'), audioName: null });
  const ins = client.calls.find((c) => c[1] === 'insert')[2];
  assert.deepEqual(Object.keys(ins).sort(), ['artist', 'body', 'capo', 'style', 'title', 'tone']); // nada de id/audioName/user_id
  assert.equal(ins.title, 'Musica'); assert.equal(ins.capo, 2);

  await b.putSong(7, { title: 'Novo' });
  assert.ok(client.calls.some((c) => c[1] === 'update'));
  assert.deepEqual(client.calls.find((c) => c[1] === 'eq'), ['from.songs', 'eq', 'id', 7]);
  await assert.rejects(b.putSong(null, { title: '   ' }), /Informe o titulo/);
});

test('putSong: item inexistente vira "nao encontrada" (a fila offline descarta em silencio)', async () => {
  const { b } = await make({ results: { 'from.songs': { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 } } });
  await assert.rejects(b.putSong(5, { title: 'x' }), /nao encontrada/i);
});

test('falha de rede vira OfflineError (entra na fila offline)', async () => {
  const { b } = await make({ results: { 'rpc.sync_all': new TypeError('Failed to fetch'), 'from.songs': { data: null, error: { message: 'TypeError: Failed to fetch' } } } });
  await assert.rejects(b.sync(), OfflineError);
  await assert.rejects(b.putSong(null, { title: 'x' }), OfflineError);
});

test('sessao expirada chama onAuthLost', async () => {
  const { b } = await make({ results: { 'rpc.sync_all': { data: null, error: { message: 'JWT expired' }, status: 401 } } });
  let lost = 0; b.onAuthLost = () => lost++;
  await assert.rejects(b.sync(), /Sessao expirada/);
  assert.equal(lost, 1);
});

test('putSetlist envia os itens no formato da funcao do banco', async () => {
  const { b, client } = await make({ results: { 'rpc.save_setlist': { data: { id: 3, title: 'Show', style: '', items: [] }, error: null } } });
  const r = await b.putSetlist(null, { title: 'Show', style: 'Rock', items: [{ songId: 1 }, { label: 'Intervalo' }, { songId: 2, label: null }] });
  assert.equal(r.id, 3);
  assert.deepEqual(client.calls[0], ['rpc', 'save_setlist', { p_id: null, p_title: 'Show', p_style: 'Rock', p_items: [{ songId: 1 }, { label: 'Intervalo' }, { songId: 2 }] }]);
});

test('deleteSong remove tambem o audio da pasta do usuario', async () => {
  const { b, client } = await make();
  await b.deleteSong(7);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(client.calls.some((c) => c[0] === 'from.songs' && c[1] === 'delete'));
  assert.deepEqual(client.calls.find((c) => c[0] === 'storage' && c[1] === 'remove'), ['storage', 'remove', 'audio', ['u-1/7']]);
});

test('audio: valida formato e tamanho; envia para <usuario>/<musica>', async () => {
  const { b, client } = await make({ results: { 'from.songs': { data: null, error: null } } });
  await assert.rejects(b.uploadAudio(7, { type: 'video/mp4', size: 10, name: 'x.mp4' }), /Formato de audio/);
  await assert.rejects(b.uploadAudio(7, { type: 'audio/mpeg', size: 31 * 1024 * 1024, name: 'x.mp3' }), /30 MB/);
  const r = await b.uploadAudio(7, { type: 'audio/mpeg', size: 1000, name: 'Base <1>.mp3' });
  assert.equal(r.audioName, 'Base 1.mp3'); // caracteres perigosos removidos
  assert.deepEqual(client.calls.find((c) => c[1] === 'upload').slice(2, 4), ['audio', 'u-1/7']);
  assert.equal(client.calls.find((c) => c[1] === 'upload')[4].upsert, true);
  const url = await b.getAudioUrl(7);
  assert.ok(typeof url === 'string' && url.startsWith('blob:'));
});

test('login, cadastro e recuperacao de senha', async () => {
  const { b, client } = await make();
  assert.equal((await b.signIn({ email: ' a@b.c ', password: 'x' })).user.email, 'a@b.c');
  const su = await b.signUp({ nick: ' Ana ', email: 'a@b.c', password: '123456' });
  assert.equal(su.user.nick, 'Ana');
  assert.equal(client.calls.find((c) => c[1] === 'signUp')[2].options.emailRedirectTo, 'https://exemplo.github.io/tocacifra/');
  await b.requestPasswordReset('a@b.c');
  assert.deepEqual(client.calls.find((c) => c[1] === 'reset').slice(2), ['a@b.c', { redirectTo: 'https://exemplo.github.io/tocacifra/' }]);
  await b.updatePassword('novaSenha1');
  await b.signOut();
  assert.deepEqual(client.calls.find((c) => c[1] === 'signOut')[2], { scope: 'local' });

  // projeto que exige confirmar e-mail: cadastro sem sessao
  const pending = await make({ results: { signUp: { data: { session: null, user: { email: 'a@b.c' } }, error: null } } });
  assert.deepEqual(await pending.b.signUp({ nick: 'Ana', email: 'a@b.c', password: '123456' }), { needsConfirmation: true });

  // erro de login traduzido
  const bad = await make({ results: { signIn: { data: {}, error: { message: 'Invalid login credentials' } } } });
  await assert.rejects(bad.b.signIn({ email: 'a@b.c', password: 'errada' }), /E-mail ou senha incorretos/);
});

test('init: restaura a sessao e distingue "sem sessao" de "sem internet"', async () => {
  const ok = await make();
  assert.deepEqual(await ok.b.init(), { user: { nick: 'Ana', email: 'a@b.c' }, offline: false });
  const none = await make({ session: null });
  assert.deepEqual(await none.b.init(), { user: null, offline: false });
  const client = fakeClient();
  client.auth.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'fetch failed' } });
  const off = await createSupabaseBackend({ siteUrl: '' }, { client });
  assert.deepEqual(await off.init(), { user: null, offline: true }); // o app mantem o login salvo
});

test('eventos de autenticacao chegam ao app', async () => {
  const { b, client } = await make();
  const seen = [];
  b.onPasswordRecovery = () => seen.push('recovery'); b.onAuthLost = () => seen.push('lost');
  client.auth.emit('PASSWORD_RECOVERY'); client.auth.emit('TOKEN_REFRESHED'); client.auth.emit('SIGNED_OUT');
  assert.deepEqual(seen, ['recovery', 'lost']);
});

test('importar por link nao existe nesta versao; texto funciona no navegador', async () => {
  const { b } = await make();
  assert.equal(b.capabilities.importUrl, false);
  await assert.rejects(b.importContent({ url: 'https://exemplo.com/x' }), /copie o texto/i);
  const r = await b.importContent({ text: 'Am   G\nlinha\n\n\n\nF   C\noutra' });
  assert.equal(r.tone, 'Am');
  assert.ok(!r.body.includes('\n\n\n'));
});
