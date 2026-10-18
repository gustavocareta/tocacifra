import { KEYS, SECTIONS, guessKey, isChord, isChordLine, parseLines, toggleSection, transposeBody, transposeChord } from './chords.js';
import { facets, filterSongs } from './filters.js';
import { onSystemThemeChange, readTheme, resolveTheme, saveTheme, systemPrefersDark, toggleTheme } from './theme.js';
import { ACTIONS, DEFAULT_PEDAL, assignBinding, createMidiHub, keyBinding, labelFor, makeThrottle, midiBinding, normalizePedal, resolveAction } from './pedal.js';
import { INSTRUMENTS, chordShape, chordSvg } from './diagrams.js';
import { TUNINGS, detectPitch, freqToNote, nearestString, noteToFreq } from './tuner.js';
import { OfflineError } from './errors.js';
import { createBackend } from './backend.js';

/* ---------------- utilidades ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);

// replaceChildren(null) insere o texto "null"; aqui null/false/arrays aninhados sao ignorados/achatados, como em h().
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...kids) {
  return nativeReplaceChildren.apply(this, kids.flat().filter((k) => k != null && k !== false));
};

/** Cria elementos sem innerHTML: textos entram como nos de texto (sem risco de XSS). */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3000);
}

/** Preferencias de exibicao do painel de palco (ficam no aparelho). */
const DEFAULT_SETTINGS = {
  mode: 'pages', columns: 'auto', bg: '#000000', lyric: '#cfcfcf', chord: '#ff7a3d', uppercase: false, speed: 60,
  sectionColors: true, // usar cores diferentes no refrao e na 2a voz (desligado: tudo na cor normal)
  keepAwake: true, // manter a tela ligada no painel de palco
  chorus: '#6ec1ff', chorusChord: '#ffd84d', voice2: '#8be28b', // cores do refrao (letra e cifra) e da 2a voz (letra)
  pedal: DEFAULT_PEDAL,
};

const store = {
  get settings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('tc_settings') ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } },
  set settings(v) { try { localStorage.setItem('tc_settings', JSON.stringify(v)); } catch { /* ignore */ } },
  get token() { try { return localStorage.getItem('tc_token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('tc_token', v) : localStorage.removeItem('tc_token'); } catch { /* modo privado */ } },
  get user() { try { return JSON.parse(localStorage.getItem('tc_user') ?? 'null'); } catch { return null; } },
  set user(v) { try { v ? localStorage.setItem('tc_user', JSON.stringify(v)) : localStorage.removeItem('tc_user'); } catch { /* ignore */ } },
  get cache() { try { return JSON.parse(localStorage.getItem('tc_cache') ?? 'null'); } catch { return null; } },
  set cache(v) { try { v ? localStorage.setItem('tc_cache', JSON.stringify(v)) : localStorage.removeItem('tc_cache'); } catch { toast('Sem espaco para guardar o conteudo offline.'); } },
  get queue() { try { return JSON.parse(localStorage.getItem('tc_queue') ?? '[]'); } catch { return []; } },
  set queue(v) { try { localStorage.setItem('tc_queue', JSON.stringify(v)); } catch { toast('Sem espaco para guardar as edicoes offline.'); } },
  get instrument() { return localStorage.getItem('tc_inst') || 'violao'; },
  set instrument(v) { try { localStorage.setItem('tc_inst', v); } catch { /* ignore */ } },
  get leftHanded() { return localStorage.getItem('tc_left') === '1'; },
  set leftHanded(v) { try { localStorage.setItem('tc_left', v ? '1' : '0'); } catch { /* ignore */ } },
  get fontSize() { return Number(localStorage.getItem('tc_font')) || 18; },
  set fontSize(v) { try { localStorage.setItem('tc_font', String(v)); } catch { /* ignore */ } },
};

/* ---------------- dados (servidor Node ou Supabase, via backend.js) ---------------- */
let backend = null; // criado em boot()

const data = { songs: [], setlists: [], at: 0, online: true };

function loadCache() {
  const c = store.cache;
  if (c) Object.assign(data, { songs: c.songs, setlists: c.setlists, at: c.at });
}

/**
 * Baixa tudo do servidor e guarda para uso offline. Antes, envia as edicoes feitas sem internet.
 * Sem rede, mantem o que ja foi baixado (e as edicoes pendentes).
 */
async function refresh() {
  try {
    await flushQueue();
    if (store.queue.length) { data.online = true; renderNav(); return; } // ainda ha pendencias: nao sobrescreve o local
    const s = await backend.sync();
    Object.assign(data, { songs: s.songs, setlists: s.setlists, at: s.at, online: true });
    store.cache = { songs: s.songs, setlists: s.setlists, at: s.at };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    data.online = false;
    if (!data.at) loadCache();
  }
  renderNav();
}

/* ---- edicao offline: cada alteracao vira uma operacao na fila e e aplicada localmente na hora ---- */
// ids negativos = itens criados offline (ainda sem id no servidor)
const isTmp = (id) => id < 0;
const newTmpId = () => -Date.now() - Math.floor(Math.random() * 1000);
const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });

function applyLocal(op) {
  const list = op.kind === 'song' ? data.songs : data.setlists;
  if (op.op === 'del') {
    const i = list.findIndex((x) => x.id === op.id);
    if (i >= 0) list.splice(i, 1);
    if (op.kind === 'song') data.setlists.forEach((l) => { l.items = l.items.filter((it) => it.songId !== op.id); });
  } else {
    const rec = op.kind === 'song'
      ? { audioName: null, ...op.body, id: op.id, updatedAt: Date.now() }
      : { ...op.body, id: op.id, updatedAt: Date.now(), items: (op.body.items ?? []).map((it) => ({ songId: it.songId ?? null, label: it.label ?? null })) };
    const i = list.findIndex((x) => x.id === op.id);
    if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec);
    list.sort(byTitle);
  }
  store.cache = { songs: data.songs, setlists: data.setlists, at: data.at };
}

function enqueue(op) {
  let q = store.queue;
  if (isTmp(op.id)) {
    // item que ainda nao existe no servidor: funde com a criacao pendente
    const i = q.findIndex((x) => x.kind === op.kind && x.id === op.id);
    if (op.op === 'del') q = q.filter((x) => !(x.kind === op.kind && x.id === op.id));
    else if (i >= 0) q[i] = { ...op };
    else q.push(op);
  } else {
    const i = q.findIndex((x) => x.kind === op.kind && x.id === op.id && x.op === 'put');
    if (op.op === 'del') { q = q.filter((x) => !(x.kind === op.kind && x.id === op.id)); q.push(op); }
    else if (i >= 0) q[i] = { ...op };
    else q.push(op);
  }
  store.queue = q;
}

async function sendOp(op, idMap) {
  const remapItems = (items) => (items ?? []).map((it) => (it.songId != null ? { songId: idMap[it.songId] ?? it.songId } : it)).filter((it) => it.songId == null || it.songId > 0);
  if (op.kind === 'song') {
    if (op.op === 'del') { if (!isTmp(op.id)) await backend.deleteSong(op.id); return; }
    if (isTmp(op.id)) idMap[op.id] = (await backend.putSong(null, op.body)).id;
    else await backend.putSong(op.id, op.body);
  } else {
    if (op.op === 'del') { if (!isTmp(op.id)) await backend.deleteSetlist(op.id); return; }
    const body = { ...op.body, items: remapItems(op.body.items) };
    if (isTmp(op.id)) idMap[op.id] = (await backend.putSetlist(null, body)).id;
    else await backend.putSetlist(op.id, body);
  }
}

const resolvedIds = {}; // id provisorio -> id real, para redirecionar telas abertas apos sincronizar
let flushing = false;
async function flushQueue() {
  if (flushing || !store.token || !store.queue.length) return;
  flushing = true;
  const idMap = {};
  let failed = 0;
  try {
    for (const op of store.queue) {
      try {
        await sendOp(op, idMap);
      } catch (e) {
        if (e instanceof OfflineError) throw e;
        if (!/nao encontrad/i.test(e.message)) failed++; // 404 = ja removido por outro aparelho: descarta em silencio
      }
      const sig = JSON.stringify(op);
      store.queue = store.queue.filter((x) => JSON.stringify(x) !== sig);
    }
    Object.assign(resolvedIds, idMap);
    if (Object.keys(idMap).length) toast(`${store.queue.length ? 'Parte das' : 'Suas'} edicoes offline foram sincronizadas.`);
    if (failed) toast(`${failed} edicao(oes) offline foram recusadas pelo servidor e descartadas.`);
  } finally { flushing = false; }
}

/** Salva/exclui tentando o servidor; sem internet, guarda na fila e aplica localmente. */
async function commit(op) {
  try {
    const q = store.queue;
    if (q.length) { await refresh(); if (store.queue.length) throw new OfflineError('pendente'); }
    let res = null;
    const createNew = isTmp(op.id) || op.id === 'new'; // ainda nao existe no servidor
    if (op.kind === 'song') res = op.op === 'del' ? await backend.deleteSong(op.id) : await backend.putSong(createNew ? null : op.id, op.body);
    else res = op.op === 'del' ? await backend.deleteSetlist(op.id) : await backend.putSetlist(createNew ? null : op.id, op.body);
    await refresh();
    return res;
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    const real = op.id === 'new' ? { ...op, id: newTmpId() } : op;
    enqueue(real);
    applyLocal(real);
    data.online = false;
    renderNav();
    toast('Sem internet: salvo no aparelho. Sincroniza quando a conexao voltar.');
    return { id: real.id };
  }
}

const songById = (id) => data.songs.find((s) => s.id === id);
const setlistById = (id) => data.setlists.find((s) => s.id === id);

/* ---------------- navegacao ---------------- */
function logout() {
  backend?.signOut();
  store.token = null; store.user = null; store.cache = null; store.queue = [];
  Object.assign(data, { songs: [], setlists: [], at: 0 });
  location.hash = '#/login';
}

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  nav.append(h('a', { class: 'brand', href: '#/songs' }, 'TocaCifra'));
  // botao rapido claro/escuro: mostra o tema atual e alterna ao clicar
  const dark = resolveTheme(readTheme(), systemPrefersDark()) === 'dark';
  const themeBtn = h('button', { class: 'btn theme', title: dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro', 'aria-label': dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro', onclick: () => { toggleTheme(); renderNav(); } }, dark ? '🌙' : '☀️');
  if (!store.token) { nav.append(h('span', { class: 'sp' }), themeBtn); return; }
  const cur = location.hash.split('/')[1] ?? '';
  const tab = (href, label, n, key) => h('a', { class: 'tab' + (cur.startsWith(key) ? ' on' : ''), href }, label, ' ', h('span', { class: 'chip' }, n));
  nav.append(tab('#/songs', 'Musicas', data.songs.length, 'song'), tab('#/setlists', 'Repertorios', data.setlists.length, 'setlist'), h('a', { class: 'tab' + (cur === 'afinador' ? ' on' : ''), href: '#/afinador' }, 'Afinador'), h('a', { class: 'tab' + (cur === 'config' ? ' on' : ''), href: '#/config' }, 'Configurações'));
  nav.append(h('span', { class: 'sp' }));
  const pending = store.queue.length;
  if (pending) nav.append(h('span', { class: 'chip', title: 'Edicoes feitas sem internet, aguardando sincronizar' }, `${pending} pendente${pending > 1 ? 's' : ''}`));
  if (!data.online) nav.append(h('span', { class: 'chip off' }, 'offline'));
  nav.append(h('span', { class: 'muted', style: 'color:#cfd8e1;margin:0 10px' }, store.user?.nick ?? ''), h('button', { class: 'btn sm', onclick: logout }, 'Sair'), themeBtn);
}

const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let stageCleanup = null;

async function navigate() {
  stageCleanup?.();
  stageCleanup = null;
  runSettingsCleanups(); // para de escutar o pedal se a tela de configuracao foi deixada
  const hash = location.hash || '#/songs';
  if (!store.token && !hash.startsWith('#/login') && !hash.startsWith('#/nova-senha')) { location.hash = '#/login'; return; }
  const tmp = /^#\/(song|setlist)\/(-\d+)/.exec(hash);
  if (tmp && resolvedIds[tmp[2]]) { location.replace(`#/${tmp[1]}/${resolvedIds[tmp[2]]}`); return; }
  const view = $('#view');
  for (const [re, fn] of routes) {
    const m = re.exec(hash);
    if (m) {
      try { await fn(view, ...m.slice(1)); } catch (e) { view.replaceChildren(h('p', { class: 'err' }, e.message)); }
      renderNav();
      return;
    }
  }
  location.hash = '#/songs';
}

/* ---------------- login / cadastro ---------------- */
route(/^#\/login/, (view) => {
  let registering = false;
  const err = h('p', { class: 'err' });
  const nick = h('input', { type: 'text', maxlength: 40, autocomplete: 'nickname' });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const pass = h('input', { type: 'password', minlength: 6, autocomplete: 'current-password', required: true });
  const nickField = h('div', { class: 'field', hidden: true }, h('label', {}, 'Nick (como quer ser chamado)'), nick);
  const title = h('h1', {}, 'Entrar');
  const submit = h('button', { class: 'btn pri', type: 'submit' }, 'Entrar');
  const swap = h('a', { href: '#', onclick: (e) => { e.preventDefault(); registering = !registering; nickField.hidden = !registering; title.textContent = registering ? 'Criar conta' : 'Entrar'; submit.textContent = title.textContent; swap.textContent = registering ? 'Ja tenho conta' : 'Criar uma conta'; } }, 'Criar uma conta');
  const form = h('form', { class: 'card auth', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try {
      const r = registering ? await backend.signUp({ nick: nick.value, email: email.value, password: pass.value }) : await backend.signIn({ email: email.value, password: pass.value });
      if (r.needsConfirmation) { err.textContent = ''; toast('Conta criada! Abra o e-mail que enviamos, confirme e depois entre.'); return; }
      store.token = r.token ?? 'sb'; store.user = r.user; // 'sb' = marcador de "logado" (a sessao real fica com o Supabase)
      await refresh();
      location.hash = '#/songs';
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } },
  title, nickField, h('div', { class: 'field' }, h('label', {}, 'E-mail'), email), h('div', { class: 'field' }, h('label', {}, 'Senha'), pass), err,
  h('div', { class: 'row' }, submit, swap),
  backend.capabilities.passwordReset ? h('p', {}, h('a', { href: '#', onclick: async (e) => {
    e.preventDefault(); err.textContent = '';
    const to = email.value.trim() || prompt('Digite o e-mail da sua conta:');
    if (!to) return;
    try { await backend.requestPasswordReset(to); toast('Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.'); } catch (ex) { err.textContent = ex.message; }
  } }, 'Esqueci a minha senha')) : null);
  view.replaceChildren(form);
});

/* ---------------- nova senha (link do e-mail de recuperacao) ---------------- */
route(/^#\/nova-senha$/, (view) => {
  const err = h('p', { class: 'err' });
  const pass = h('input', { type: 'password', minlength: 6, autocomplete: 'new-password', required: true });
  const pass2 = h('input', { type: 'password', minlength: 6, autocomplete: 'new-password', required: true });
  const submit = h('button', { class: 'btn pri', type: 'submit' }, 'Salvar nova senha');
  view.replaceChildren(h('form', { class: 'card auth', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (pass.value !== pass2.value) { err.textContent = 'As senhas nao conferem.'; return; }
    submit.disabled = true;
    try {
      await backend.updatePassword(pass.value);
      const r = await backend.init();
      store.token = store.token ?? 'sb'; store.user = r.user ?? store.user;
      toast('Senha alterada!');
      await refresh();
      location.hash = '#/songs';
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } },
  h('h1', {}, 'Nova senha'), h('p', { class: 'muted' }, 'Escolha uma senha nova para a sua conta.'),
  h('div', { class: 'field' }, h('label', {}, 'Nova senha (minimo 6 caracteres)'), pass), h('div', { class: 'field' }, h('label', {}, 'Repita a nova senha'), pass2), err, h('div', { class: 'row' }, submit)));
});

/* ---------------- lista de musicas ---------------- */
const songFilters = { term: '', artist: '', style: '' }; // lembrados ao voltar para a lista

/** <select> de filtro com "Todos ..." e as opcoes de `items` ({key,name,count}). */
function facetSelect(allLabel, items, current, onPick) {
  const sel = h('select', { class: 'fsel', onchange: () => onPick(sel.value) }, h('option', { value: '' }, allLabel), items.map((i) => h('option', { value: i.key }, `${i.name} (${i.count})`)));
  sel.value = items.some((i) => i.key === current) ? current : '';
  return sel;
}

route(/^#\/songs$/, async (view) => {
  await refresh();
  const q = h('input', { type: 'text', placeholder: 'Buscar por titulo ou artista', class: 'grow', value: songFilters.term });
  const tbody = h('tbody');
  const filters = h('div', { class: 'row' });
  const count = h('p', { class: 'muted' });
  const draw = () => {
    const f = facets(data.songs);
    // se o artista/estilo escolhido nao existe mais (ex.: a ultima musica dele foi apagada), volta para "todos"
    if (songFilters.artist && !f.artists.some((a) => a.key === songFilters.artist)) songFilters.artist = '';
    if (songFilters.style && !f.styles.some((a) => a.key === songFilters.style)) songFilters.style = '';
    const list = filterSongs(data.songs, songFilters);
    const active = songFilters.term || songFilters.artist || songFilters.style;
    filters.replaceChildren(
      facetSelect('Todos os artistas', f.artists, songFilters.artist, (v) => { songFilters.artist = v; draw(); }),
      facetSelect('Todos os estilos', f.styles, songFilters.style, (v) => { songFilters.style = v; draw(); }),
      active ? h('button', { class: 'btn sm', onclick: () => { Object.assign(songFilters, { term: '', artist: '', style: '' }); q.value = ''; draw(); } }, 'Limpar filtros') : null);
    count.textContent = data.songs.length ? `${list.length} de ${data.songs.length} musicas` : '';
    tbody.replaceChildren(...list.map((s) => h('tr', {},
      h('td', {}, h('a', { href: `#/song/${s.id}` }, s.title)),
      h('td', {}, s.artist ? h('a', { href: '#', title: `Ver so as musicas de ${s.artist}`, onclick: (e) => { e.preventDefault(); songFilters.artist = facets([s]).artists[0].key; draw(); } }, s.artist) : ''),
      h('td', {}, s.tone), h('td', {}, s.style),
      h('td', { class: 'act' }, h('a', { class: 'btn sm pri', href: `#/palco?song=${s.id}` }, 'Tocar')))));
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, data.songs.length ? 'Nada encontrado com esses filtros.' : 'Nenhuma musica ainda. Cadastre ou importe a primeira!')));
  };
  q.addEventListener('input', () => { songFilters.term = q.value; draw(); });
  draw();
  const dl = h('button', { class: 'btn', onclick: async () => {
    await refresh();
    toast(data.online ? `${data.songs.length} musicas e ${data.setlists.length} repertorios salvos para uso offline.` : 'Sem internet: usando o conteudo ja baixado.');
  } }, 'Baixar conteudo offline');
  view.replaceChildren(
    h('h1', {}, 'Minhas musicas'),
    h('div', { class: 'row' }, q, h('a', { class: 'btn ok', href: '#/song/new' }, 'Nova'), h('button', { class: 'btn', onclick: () => importDialog() }, 'Importar'), dl),
    filters, count,
    data.at ? h('p', { class: 'muted' }, `Conteudo baixado em ${new Date(data.at).toLocaleString('pt-BR')}.`) : null,
    h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, ['Titulo', 'Artista', 'Tom', 'Estilo', ''].map((t) => h('th', {}, t)))), tbody)));
});

/* ---------------- importar ---------------- */
function importDialog() {
  const url = h('input', { type: 'text', placeholder: 'https://... (link da pagina da cifra)' });
  const text = h('textarea', { placeholder: 'Ou cole aqui a cifra (acordes acima da letra)', style: 'min-height:160px' });
  const term = h('input', { type: 'text', placeholder: 'Musica ou artista' });
  const err = h('p', { class: 'err' });
  const close = () => bg.remove();
  const go = h('button', { class: 'btn pri', onclick: async () => {
    err.textContent = '';
    if (!url.value.trim() && !text.value.trim()) { err.textContent = 'Informe um link ou cole o texto.'; return; }
    go.disabled = true; go.textContent = 'Importando...';
    try {
      const r = await backend.importContent(url.value.trim() ? { url: url.value.trim() } : { text: text.value });
      sessionStorage.setItem('tc_prefill', JSON.stringify(r));
      close();
      location.hash = '#/song/new?prefill=1';
    } catch (e) { err.textContent = e.message; go.disabled = false; go.textContent = 'Importar'; }
  } }, 'Importar');
  // le a area de transferencia: se for um link, importa a pagina; se for texto, importa a cifra colada
  const pasteBtn = h('button', { class: 'btn pri', onclick: async () => {
    err.textContent = '';
    let clip = '';
    try { clip = (await navigator.clipboard.readText()).trim(); } catch { err.textContent = 'Nao consegui ler a area de transferencia (permissao negada ou navegador sem suporte). Cole com Ctrl+V nos campos abaixo.'; return; }
    if (!clip) { err.textContent = 'A area de transferencia esta vazia. Copie o link ou o texto da cifra primeiro.'; return; }
    if (/^https?:\/\/\S+$/i.test(clip)) {
      if (!backend.capabilities.importUrl) { err.textContent = 'Nesta versao o link nao e importado automaticamente. Na pagina da cifra, selecione e copie o TEXTO da cifra e clique de novo.'; return; }
      url.value = clip; text.value = '';
    } else { text.value = clip; url.value = ''; }
    go.click();
  } }, 'Colar da área de transferência e importar');
  const bg = h('div', { class: 'dlg-bg', onclick: (e) => e.target === bg && close() }, h('div', { class: 'dlg' },
    h('h2', {}, 'Importar cifra'),
    h('p', { class: 'muted' }, 'Importe uma musica por vez, para uso pessoal. Confira o resultado no editor antes de salvar.'),
    h('label', {}, '1. Procurar em um site de cifras (abre em outra aba)'),
    h('div', { class: 'row' }, term, h('button', { class: 'btn sm', onclick: () => term.value.trim() && window.open(`https://www.cifraclub.com.br/?q=${encodeURIComponent(term.value.trim())}`, '_blank', 'noopener') }, 'Abrir Cifra Club')),
    h('label', {}, '2. Na aba do site, abra a música e copie o link da página (ou o texto da cifra). Depois:'),
    h('div', { class: 'row' }, pasteBtn),
    h('label', {}, 'Link da cifra'), url, h('p', { class: 'muted' }, '— ou —'), text, err,
    h('div', { class: 'row', style: 'margin-top:10px' }, go, h('button', { class: 'btn', onclick: close }, 'Cancelar'))));
  document.body.append(bg);
}

/* ---------------- acordes desenhados ---------------- */
/** Acordes distintos usados nas linhas de acordes, na ordem em que aparecem. */
function chordsIn(body) {
  const seen = new Set();
  for (const line of body.split('\n')) if (isChordLine(line)) for (const t of line.trim().split(/\s+/)) if (isChord(t)) seen.add(t);
  return [...seen];
}

function renderDiagrams(target, chords) {
  const inst = store.instrument;
  const cells = chords.map((name) => {
    const shape = chordShape(name, inst);
    return h('figure', { class: 'dg' }, shape ? chordSvg(name, shape, { left: store.leftHanded }) : h('div', { class: 'muted', style: 'width:70px;height:90px;font-size:12px' }, name, h('br'), 'sem desenho'));
  });
  target.replaceChildren(...(cells.length ? cells : [h('span', { class: 'muted' }, 'Nenhum acorde encontrado. Adicione cifras na letra para que os desenhos aparecam aqui.')]));
}

/* ---------------- editor de musica ---------------- */
/** Cada linha de acordes fica junto da letra logo abaixo (um bloco), para nao quebrar entre colunas. */
function renderCifra(target, body) {
  const lines = parseLines(body); // marcadores {refrao}/{voz2} somem; cada linha traz a sua secao
  const blocks = [];
  const useSectionColors = store.settings.sectionColors;
  const cls = (l) => `blk${l.section && useSectionColors ? ` sec-${l.section}` : ''}`;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    if (l.chord && next && !next.chord && next.text.trim()) {
      blocks.push(h('div', { class: cls(next) }, h('span', { class: 'c' }, l.text), '\n', h('span', { class: 'ly' }, next.text)));
      i++;
    } else {
      blocks.push(h('div', { class: cls(l) }, l.chord ? h('span', { class: 'c' }, l.text) : h('span', { class: 'ly' }, l.text || ' ')));
    }
  }
  target.replaceChildren(...blocks);
}

route(/^#\/song\/(new|-?\d+)(\?prefill=1)?$/, async (view, id, prefill) => {
  if (!data.at) await refresh();
  const isNew = id === 'new';
  const song = isNew ? { title: '', artist: '', tone: '', capo: 0, style: '', body: '' } : { ...songById(Number(id)) };
  if (!isNew && !song.id) throw new Error('Musica nao encontrada (talvez ainda nao tenha sido baixada).');
  if (isNew && prefill) {
    try { Object.assign(song, JSON.parse(sessionStorage.getItem('tc_prefill') ?? '{}')); } catch { /* ignore */ }
    sessionStorage.removeItem('tc_prefill');
  }
  const f = {
    title: h('input', { type: 'text', maxlength: 120, value: song.title }),
    artist: h('input', { type: 'text', maxlength: 120, value: song.artist }),
    tone: h('select', {}, h('option', { value: '' }, '—'), KEYS.map((k) => h('option', { value: k }, k))),
    capo: h('input', { type: 'number', min: 0, max: 12, value: song.capo }),
    style: h('input', { type: 'text', maxlength: 40, value: song.style, placeholder: 'ex.: Sertanejo' }),
    body: h('textarea', { placeholder: 'Digite ou cole a cifra: acordes em uma linha, letra na linha de baixo.' }),
  };
  f.tone.value = song.tone; f.body.value = song.body;
  const preview = h('div', { class: 'cifra', style: `font-size:${store.fontSize - 4}px` });
  applyTheme(preview); // usa as cores escolhidas em Configuracoes (refrao, 2a voz)
  const sync = () => renderCifra(preview, f.body.value);
  f.body.addEventListener('input', sync);
  sync();

  const shiftTone = (n) => {
    f.body.value = transposeBody(f.body.value, n);
    if (f.tone.value) f.tone.value = transposeChord(f.tone.value.replace(/m$/, ''), n).replace(/b$/, 'b') + (f.tone.value.endsWith('m') ? 'm' : '');
    if (!KEYS.includes(f.tone.value)) f.tone.value = guessKey(f.body.value);
    sync();
  };
  /** Marca/desmarca como refrao (ou 2a voz) as linhas selecionadas no editor. */
  const markSel = (type) => {
    const ta = f.body, v = ta.value;
    const a = ta.selectionStart;
    let b = ta.selectionEnd;
    if (b > a && v[b - 1] === '\n') b--; // selecao que termina no inicio da linha seguinte
    const startLine = v.slice(0, a).split('\n').length - 1;
    const endLine = v.slice(0, b).split('\n').length - 1;
    ta.value = toggleSection(v, startLine, endLine, type);
    ta.dispatchEvent(new Event('input')); // atualiza a pre-visualizacao e os acordes
    ta.focus();
  };
  const collect = () => ({ title: f.title.value, artist: f.artist.value, tone: f.tone.value, capo: Number(f.capo.value) || 0, style: f.style.value, body: f.body.value });
  const err = h('p', { class: 'err' });
  const save = async () => {
    err.textContent = '';
    try {
      const body = collect();
      if (!body.title.trim()) { err.textContent = 'Informe o titulo.'; return; }
      const saved = await commit({ kind: 'song', op: 'put', id: isNew ? 'new' : song.id, body });
      if (data.online) toast('Musica salva.');
      if (isNew) location.hash = `#/song/${saved.id}`;
    } catch (e) { err.textContent = e.message; }
  };
  const del = async () => {
    if (!confirm(`Excluir "${song.title}"? Ela tambem sai dos repertorios.`)) return;
    try { await commit({ kind: 'song', op: 'del', id: song.id }); location.hash = '#/songs'; } catch (e) { err.textContent = e.message; }
  };
  const field = (label, el, cls = '') => h('div', { class: cls }, h('label', {}, label), el);

  // acordes desenhados (violao, cavaquinho, ukulele; destro ou canhoto)
  const diag = h('div', { class: 'diagrams' });
  const instSel = h('select', { onchange: () => { store.instrument = instSel.value; drawDiag(); } }, Object.entries(INSTRUMENTS).map(([k, v]) => h('option', { value: k }, v.label)));
  instSel.value = store.instrument;
  const leftChk = h('input', { type: 'checkbox', onchange: () => { store.leftHanded = leftChk.checked; drawDiag(); } });
  leftChk.checked = store.leftHanded;
  let diagTimer;
  const drawDiag = () => renderDiagrams(diag, chordsIn(f.body.value));
  f.body.addEventListener('input', () => { clearTimeout(diagTimer); diagTimer = setTimeout(drawDiag, 300); });
  drawDiag();

  // audio para acompanhar (so para musicas ja salvas no servidor)
  const audioBox = h('div', { class: 'card' });
  const drawAudio = (name) => {
    const pick = h('input', { type: 'file', accept: 'audio/*', onchange: async () => {
      const file = pick.files[0];
      if (!file) return;
      if (file.size > 30 * 1024 * 1024) { err.textContent = 'O audio deve ter no maximo 30 MB.'; return; }
      err.textContent = '';
      try {
        const j = await backend.uploadAudio(song.id, file);
        song.audioName = j.audioName; await refresh(); drawAudio(j.audioName); toast('Audio enviado.');
      } catch (e) { err.textContent = e instanceof OfflineError ? 'Sem internet: o envio de audio precisa de conexao.' : e.message; }
    } });
    audioBox.replaceChildren(h('label', {}, 'Audio de acompanhamento (mp3, m4a, ogg, wav — ate 30 MB)'),
      name ? h('p', {}, '🎵 ', name, ' ', h('button', { class: 'btn sm bad', onclick: async () => { try { await backend.deleteAudio(song.id); song.audioName = null; await refresh(); drawAudio(null); } catch (e) { err.textContent = e.message; } } }, 'Remover')) : null, pick);
  };
  if (!isNew && !isTmp(song.id)) drawAudio(song.audioName);

  view.replaceChildren(
    h('h1', {}, isNew ? 'Nova musica' : 'Editar musica'),
    h('div', { class: 'row' },
      h('button', { class: 'btn pri', onclick: save }, 'Salvar'),
      isNew ? null : h('a', { class: 'btn ok', href: `#/palco?song=${song.id}` }, 'Tocar'),
      h('button', { class: 'btn', onclick: () => importDialog() }, 'Importar'),
      h('span', { class: 'grow' }),
      isNew ? null : h('button', { class: 'btn bad', onclick: del }, 'Excluir')),
    err,
    h('div', { class: 'card' },
      h('div', { class: 'row' }, field('Titulo', f.title, 'grow'), field('Artista', f.artist, 'grow')),
      h('div', { class: 'row' }, field('Tom', f.tone), field('Capotraste (casa)', f.capo), field('Estilo', f.style, 'grow'),
        h('button', { class: 'btn sm', onclick: () => shiftTone(-1) }, '− Tom'), h('button', { class: 'btn sm', onclick: () => shiftTone(1) }, '+ Tom'),
        h('button', { class: 'btn sm', onclick: () => { f.tone.value = guessKey(f.body.value); } }, 'Detectar tom')),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Selecione as linhas e marque:'),
        h('button', { class: 'btn sm mk-refrao', title: 'Marca ou desmarca as linhas selecionadas como refrão (outra cor)', onclick: () => markSel('refrao') }, SECTIONS.refrao),
        h('button', { class: 'btn sm mk-voz2', title: 'Marca ou desmarca as linhas selecionadas como 2ª voz', onclick: () => markSel('voz2') }, SECTIONS.voz2),
        h('span', { class: 'muted' }, 'As marcas {refrao} aparecem só no editor; a cor é escolhida em Configurações.'))),
    h('div', { class: 'grid2' }, field('Letra cifrada', f.body), field('Pre-visualizacao', preview)),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', {}, 'Acordes da musica'), instSel, h('label', { style: 'display:flex;gap:4px;align-items:center;margin:0' }, leftChk, 'Canhoto')), diag),
    isNew || isTmp(song.id) ? null : audioBox,
    h('p', { class: 'muted' }, 'Dica: acordes e letra ficam em linhas diferentes; as linhas de acordes sao destacadas automaticamente.'));
});

/* ---------------- repertorios ---------------- */
route(/^#\/setlists$/, async (view) => {
  await refresh();
  view.replaceChildren(
    h('h1', {}, 'Meus repertorios'),
    h('div', { class: 'row' }, h('a', { class: 'btn ok', href: '#/setlist/new' }, 'Novo')),
    h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Titulo', 'Estilo', 'Musicas', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, data.setlists.length ? data.setlists.map((s) => h('tr', {},
        h('td', {}, h('a', { href: `#/setlist/${s.id}` }, s.title)), h('td', {}, s.style), h('td', {}, s.items.filter((i) => i.songId != null).length),
        h('td', { class: 'act' }, h('a', { class: 'btn sm pri', href: `#/palco?set=${s.id}` }, 'Tocar'))))
        : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Nenhum repertorio ainda.'))))));
});

route(/^#\/setlist\/(new|-?\d+)$/, async (view, id) => {
  if (!data.at) await refresh();
  const isNew = id === 'new';
  const cur = isNew ? { title: '', style: '', items: [] } : setlistById(Number(id));
  if (!cur) throw new Error('Repertorio nao encontrado.');
  let items = cur.items.map((i) => ({ ...i }));
  const title = h('input', { type: 'text', maxlength: 120, value: cur.title });
  const style = h('input', { type: 'text', maxlength: 40, value: cur.style });
  const list = h('ul', { class: 'items' });
  const search = h('input', { type: 'text', placeholder: 'Buscar musica para adicionar' });
  const pick = h('div', { class: 'pick', hidden: true });
  const pickFilters = h('div', { class: 'row' }); // artista / estilo + "adicionar todas"
  const pf = { artist: '', style: '' };
  let pickOpen = false;
  const err = h('p', { class: 'err' });

  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; drawItems(); };
  function drawItems() {
    let n = 0;
    list.replaceChildren(...items.map((it, i) => {
      const s = it.songId != null ? songById(it.songId) : null;
      return h('li', { class: it.songId == null ? 'mom' : '' },
        h('span', { class: 'muted', style: 'width:2em' }, it.songId != null ? ++n : '•'),
        h('span', { class: 't' }, it.songId == null ? it.label : s ? `${s.title} — ${s.artist}` : '(musica removida)'),
        h('button', { class: 'btn sm', onclick: () => move(i, -1) }, '↑'), h('button', { class: 'btn sm', onclick: () => move(i, 1) }, '↓'),
        h('button', { class: 'btn sm bad', onclick: () => { items.splice(i, 1); drawItems(); } }, '✕'));
    }));
    if (!items.length) list.append(h('li', { class: 'muted' }, 'Repertorio vazio.'));
  }
  const MAX_ITEMS = 300;
  const drawPick = () => {
    const used = new Set(items.map((i) => i.songId));
    const f = facets(data.songs);
    const available = filterSongs(data.songs, { term: search.value, artist: pf.artist, style: pf.style }).filter((s) => !used.has(s.id));
    const room = MAX_ITEMS - items.length;
    const filtering = !!(search.value.trim() || pf.artist || pf.style);
    pickFilters.replaceChildren(
      facetSelect('Todos os artistas', f.artists, pf.artist, (v) => { pf.artist = v; pickOpen = true; drawPick(); }),
      facetSelect('Todos os estilos', f.styles, pf.style, (v) => { pf.style = v; pickOpen = true; drawPick(); }),
      filtering && available.length
        ? h('button', { class: 'btn sm pri', title: 'Adiciona ao repertorio todas as musicas que aparecem com este filtro', onclick: () => {
          const add = available.slice(0, Math.max(0, room));
          add.forEach((s) => items.push({ songId: s.id, label: null }));
          if (add.length < available.length) toast(`Limite de ${MAX_ITEMS} itens: adicionei ${add.length} de ${available.length}.`);
          else toast(`${add.length} musica${add.length > 1 ? 's' : ''} adicionada${add.length > 1 ? 's' : ''}.`);
          drawItems(); drawPick();
        } }, `Adicionar todas (${available.length})`)
        : null);
    const shown = available.slice(0, 40);
    pick.hidden = !(pickOpen || filtering) || !shown.length;
    pick.replaceChildren(...shown.map((s) => h('div', { onclick: () => { items.push({ songId: s.id, label: null }); drawItems(); drawPick(); } }, `${s.title} — ${s.artist}`)),
      available.length > shown.length ? h('div', { class: 'muted' }, `+ ${available.length - shown.length} musicas: refine a busca ou use "Adicionar todas".`) : null);
  };
  search.addEventListener('input', () => { pickOpen = true; drawPick(); });
  search.addEventListener('focus', () => { pickOpen = true; drawPick(); });

  const save = async () => {
    err.textContent = '';
    try {
      const body = { title: title.value, style: style.value, items: items.map((i) => (i.songId != null ? { songId: i.songId } : { label: i.label })) };
      if (!body.title.trim()) { err.textContent = 'Informe o titulo.'; return; }
      if (body.items.length > 300) { err.textContent = 'Um repertorio aceita no maximo 300 itens.'; return; }
      const saved = await commit({ kind: 'setlist', op: 'put', id: isNew ? 'new' : cur.id, body });
      if (data.online) toast('Repertorio salvo.');
      if (isNew) location.hash = `#/setlist/${saved.id}`;
    } catch (e) { err.textContent = e.message; }
  };
  const del = async () => {
    if (!confirm(`Excluir o repertorio "${cur.title}"? As musicas continuam salvas.`)) return;
    try { await commit({ kind: 'setlist', op: 'del', id: cur.id }); location.hash = '#/setlists'; } catch (e) { err.textContent = e.message; }
  };
  drawItems();
  view.replaceChildren(
    h('h1', {}, isNew ? 'Novo repertorio' : 'Editar repertorio'),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: save }, 'Salvar'),
      isNew ? null : h('a', { class: 'btn ok', href: `#/palco?set=${cur.id}` }, 'Tocar'), h('span', { class: 'grow' }),
      isNew ? null : h('button', { class: 'btn bad', onclick: del }, 'Excluir')),
    err,
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Titulo'), title), h('div', { class: 'grow' }, h('label', {}, 'Estilo'), style))),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, search),
      h('button', { class: 'btn sm', onclick: () => { const l = prompt('Nome do momento (ex.: Entrada dos noivos, Intervalo):'); if (l?.trim()) { items.push({ songId: null, label: l.trim().slice(0, 60) }); drawItems(); } } }, '+ Momento')), pickFilters, pick, list));
  drawPick(); // monta os filtros de artista/estilo (a lista de sugestoes so aparece ao buscar ou filtrar)
});

/* ---------------- configuracoes ---------------- */
/** Aplica tema (cores) e fonte a um elemento que mostra cifra. */
function applyTheme(el) {
  const s = store.settings;
  el.style.setProperty('--st-bg', s.bg);
  el.style.setProperty('--st-lyric', s.lyric);
  el.style.setProperty('--st-chord', s.chord);
  el.style.setProperty('--st-chorus', s.chorus);
  el.style.setProperty('--st-chorus-chord', s.chorusChord);
  el.style.setProperty('--st-voice2', s.voice2);
}

/* ---------------- pedais (teclado Bluetooth e MIDI) ---------------- */
const midiHub = createMidiHub();
let activeListeners = 0; // > 0 enquanto aprendendo/testando: o painel ignora as teclas
const settingsCleanups = new Set(); // paineis de configuracao abertos (param de escutar ao sair)
const runSettingsCleanups = () => { settingsCleanups.forEach((f) => f()); settingsCleanups.clear(); };

/** Escuta o proximo botao do pedal (teclado ou MIDI) e chama handler(binding). Retorna a funcao que para de escutar. */
async function listenInputs(handler, { midi = false } = {}) {
  const onKey = (e) => {
    const id = keyBinding(e);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) handler(id);
  };
  document.addEventListener('keydown', onKey, true);
  activeListeners++;
  let unsub = null;
  if (midi) { try { unsub = await midiHub.subscribe((d) => { const id = midiBinding(d); if (id) handler(id); }); } catch (err) { toast(err.message); } }
  return () => { document.removeEventListener('keydown', onKey, true); unsub?.(); activeListeners = Math.max(0, activeListeners - 1); };
}

/** Bloco de configuracao do pedal: aprende botoes (qualquer marca), testa e liga o MIDI. */
function pedalSection(onChange) {
  const box = h('fieldset', { class: 'pedal' });
  const testOut = h('p', { class: 'muted' });
  let stop = null, learning = null, testing = false, timer = 0;
  const cfg = () => normalizePedal(store.settings.pedal);
  const save = (patch) => { store.settings = { ...store.settings, pedal: { ...cfg(), ...patch } }; onChange?.(); };
  const stopAll = () => { clearTimeout(timer); stop?.(); stop = null; learning = null; testing = false; };
  settingsCleanups.add(stopAll);

  async function learn(actionId) {
    stopAll(); learning = actionId; render();
    const myStop = await listenInputs((binding) => {
      save({ bindings: assignBinding(cfg().bindings, actionId, binding) });
      toast(`"${labelFor(binding)}" agora faz: ${ACTIONS.find((a) => a.id === actionId).label}`);
      stopAll(); render();
    }, { midi: cfg().midi });
    if (learning !== actionId) { myStop(); return; } // cancelado enquanto aguardava o MIDI
    stop = myStop;
    timer = setTimeout(() => { stopAll(); render(); toast('Tempo esgotado: nenhum botão foi detectado.'); }, 15000);
  }

  async function toggleTest() {
    if (testing) { stopAll(); testOut.textContent = ''; render(); return; }
    stopAll(); testing = true; render();
    testOut.textContent = 'Pise nos botões do pedal…';
    const myStop = await listenInputs((binding) => {
      const a = resolveAction(cfg().bindings, binding);
      testOut.textContent = `Recebido: ${labelFor(binding)} → ${a ? ACTIONS.find((x) => x.id === a).label : '(nenhuma ação ligada a este botão)'}`;
    }, { midi: cfg().midi });
    if (!testing) { myStop(); return; }
    stop = myStop;
  }

  async function setMidi(on) {
    save({ midi: on });
    if (!on) { render(); return; }
    try {
      await midiHub.subscribe(() => {}); // pede a permissao do navegador agora
      const names = midiHub.devices();
      toast(names.length ? `MIDI conectado: ${names.join(', ')}` : 'MIDI liberado, mas nenhum pedal MIDI foi encontrado. Pareie-o no sistema e tente de novo.');
    } catch (e) { toast(e.message); save({ midi: false }); }
    render();
  }

  function render() {
    const c = cfg();
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
    box.replaceChildren(
      h('legend', {}, 'Pedal Bluetooth (qualquer marca)'),
      h('label', { class: 'opt', style: 'font-weight:600' }, h('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => { save({ enabled: e.target.checked }); render(); } }), ' Usar pedal para virar as páginas'),
      c.enabled ? null : h('p', { class: 'muted' }, 'Pedal desligado: as páginas só viram pelo toque na tela. Os botões ensinados ficam guardados.'),
      mobile
        ? h('ol', { class: 'muted steps' }, h('li', {}, 'Ligue o pedal e pareie nas configurações de Bluetooth do celular.'), h('li', {}, 'Volte ao TocaCifra, toque em "Aprender" ao lado de cada ação e pise no botão do pedal.'), h('li', {}, 'Abra uma música: os botões viram as páginas. Use "Testar pedal" para conferir.'))
        : h('p', { class: 'muted' }, 'Pareie o pedal com o aparelho pelo Bluetooth. A maioria dos pedais funciona como um teclado: toque em "Aprender" e pise no botão que quer usar. Funciona com qualquer marca.'),
      ...ACTIONS.map((a) => h('div', { class: 'prow' },
        h('span', { class: 'plabel' }, a.label),
        h('span', { class: 'chips' }, c.bindings[a.id].length
          ? c.bindings[a.id].map((b) => h('span', { class: 'chip2', title: 'Remover este botão' }, labelFor(b), h('button', { class: 'x', 'aria-label': `Remover ${labelFor(b)}`, onclick: () => { save({ bindings: { ...c.bindings, [a.id]: c.bindings[a.id].filter((x) => x !== b) } }); render(); } }, '×')))
          : h('span', { class: 'muted' }, 'nenhum')),
        learning === a.id
          ? h('button', { class: 'btn sm bad', onclick: () => { stopAll(); render(); } }, 'Aperte o botão do pedal… (cancelar)')
          : h('button', { class: 'btn sm', onclick: () => learn(a.id) }, 'Aprender'),
        h('button', { class: 'btn sm', title: 'Voltar aos botões padrão desta ação', onclick: () => { save({ bindings: { ...c.bindings, [a.id]: [...DEFAULT_PEDAL.bindings[a.id]] } }); render(); } }, 'Padrão'))),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm' + (testing ? ' pri' : ''), onclick: toggleTest }, testing ? 'Parar teste' : 'Testar pedal')),
      testOut,
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: c.midi, onchange: (e) => setMidi(e.target.checked) }), ' Usar pedal MIDI (Bluetooth MIDI) — só em Chrome ou Edge'),
      h('label', { class: 'opt' }, 'Ignorar toques repetidos: ', h('input', { type: 'range', min: 0, max: 1000, step: 50, value: c.debounce, oninput: (e) => { save({ debounce: Number(e.target.value) }); dbOut.textContent = ` ${e.target.value} ms`; } }), (dbOut.textContent = ` ${c.debounce} ms`, dbOut)),
      h('p', { class: 'muted' }, 'Dica: se o pedal "pula" duas páginas de uma vez, aumente o tempo acima.'));
  }
  const dbOut = h('span', { class: 'muted' });
  render();
  return box;
}

/** Formulario de preferencias do painel. `onChange` roda a cada alteracao. */
function settingsForm(onChange) {
  const upd = (patch) => { store.settings = { ...store.settings, ...patch }; onChange?.(); };
  const s = store.settings;
  const radio = (name, value, label) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: `cfg-${name}`, checked: String(s[name]) === String(value), onchange: () => upd({ [name]: value }) }), ' ', label);
  const color = (key, label) => h('label', { class: 'opt' }, h('input', { type: 'color', value: s[key], oninput: (e) => upd({ [key]: e.target.value }) }), ' ', label);
  const fontOut = h('span', { class: 'muted' }, ` ${store.fontSize}px`);
  const speedOut = h('span', { class: 'muted' }, ` ${s.speed}`);
  const inst = h('select', { onchange: () => { store.instrument = inst.value; onChange?.(); } }, Object.entries(INSTRUMENTS).map(([k, v]) => h('option', { value: k }, v.label)));
  inst.value = store.instrument;
  const reset = h('button', { class: 'btn sm', onclick: () => { store.settings = { ...DEFAULT_SETTINGS }; store.fontSize = 18; onChange?.(); form.replaceWith(settingsForm(onChange)); } }, 'Restaurar padrões');

  const form = h('div', { class: 'cfg' },
    h('fieldset', {}, h('legend', {}, 'Como a música é mostrada'),
      radio('mode', 'pages', 'Paginação (vira de página, em colunas)'), radio('mode', 'scroll', 'Rolagem contínua (para baixo)')),
    h('fieldset', {}, h('legend', {}, 'Colunas (na paginação)'),
      radio('columns', 'auto', 'Automático (2 em tela larga)'), radio('columns', 1, '1 coluna'), radio('columns', 2, '2 colunas')),
    h('fieldset', {}, h('legend', {}, 'Tamanho da letra'),
      h('input', { type: 'range', min: 10, max: 48, value: store.fontSize, oninput: (e) => { store.fontSize = Number(e.target.value); fontOut.textContent = ` ${store.fontSize}px`; onChange?.(); } }), fontOut),
    h('fieldset', {}, h('legend', {}, 'Cores'), color('bg', 'Fundo'), color('lyric', 'Letra'), color('chord', 'Cifra'),
      h('label', { class: 'opt', style: 'margin-top:8px;font-weight:600' }, h('input', { type: 'checkbox', checked: s.sectionColors, onchange: (e) => upd({ sectionColors: e.target.checked }) }), ' Usar cores diferentes no refrão e na 2ª voz'),
      color('chorus', 'Letra do refrão'), color('chorusChord', 'Cifra do refrão'), color('voice2', 'Letra da 2ª voz'),
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: s.uppercase, onchange: (e) => upd({ uppercase: e.target.checked }) }), ' Letra em MAIÚSCULAS')),
    h('fieldset', {}, h('legend', {}, 'Tela'),
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: s.keepAwake, onchange: (e) => upd({ keepAwake: e.target.checked }) }), ' Manter a tela ligada durante a música (recomendado com pedal)')),
    h('fieldset', {}, h('legend', {}, 'Rolagem automática (modo rolagem)'),
      h('input', { type: 'range', min: 10, max: 200, step: 5, value: s.speed, oninput: (e) => { speedOut.textContent = ` ${e.target.value}`; upd({ speed: Number(e.target.value) }); } }), speedOut, h('span', { class: 'muted' }, ' (mais alto = mais rápido)')),
    h('fieldset', {}, h('legend', {}, 'Acordes desenhados'), h('label', { class: 'opt' }, 'Instrumento ', inst),
      h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: store.leftHanded, onchange: (e) => { store.leftHanded = e.target.checked; onChange?.(); } }), ' Canhoto')),
    pedalSection(onChange),
    h('div', { class: 'row' }, reset));
  return form;
}

route(/^#\/config$/, async (view) => {
  const preview = h('div', { class: 'stage-preview' });
  const drawPreview = () => {
    const s = store.settings;
    applyTheme(preview);
    preview.className = `stage-preview body${s.uppercase ? ' upper' : ''}`;
    preview.style.fontSize = `${store.fontSize}px`;
    renderCifra(preview, 'G        D\nLinha de exemplo inventada\nEm       C\nOutra linha de exemplo\n{refrao}\nC        G\nLinha de refrão inventada\n{/refrao}\n{voz2}\nResposta da segunda voz\n{/voz2}');
  };
  drawPreview();
  const pending = store.queue.length;
  const themeOpt = (value, label) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'cfg-theme', checked: readTheme() === value, onchange: () => { saveTheme(value); renderNav(); } }), ' ', label);
  view.replaceChildren(
    h('h1', {}, 'Configurações'),
    h('div', { class: 'card cfg' }, h('h2', {}, 'Aparência do app'),
      h('div', { class: 'row' }, themeOpt('auto', 'Automático (segue o aparelho)'), themeOpt('light', '☀️ Claro'), themeOpt('dark', '🌙 Escuro')),
      h('p', { class: 'muted' }, 'Vale para o site e para o app. O painel de palco tem as suas próprias cores (mais abaixo).')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, 'Painel de palco'), settingsForm(drawPreview)),
      h('div', {},
        h('div', { class: 'card' }, h('h2', {}, 'Pré-visualização'), preview),
        h('div', { class: 'card' }, h('h2', {}, 'Conta e conteúdo offline'),
          h('p', {}, `Conectado como ${store.user?.nick ?? ''} (${store.user?.email ?? ''}).`),
          h('p', { class: 'muted' }, data.at ? `Conteúdo baixado em ${new Date(data.at).toLocaleString('pt-BR')}: ${data.songs.length} músicas e ${data.setlists.length} repertórios.` : 'Nada baixado ainda.'),
          pending ? h('p', {}, `${pending} edição(ões) feita(s) offline aguardando sincronizar.`) : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: async () => { await refresh(); toast(data.online ? 'Conteúdo atualizado e salvo para uso offline.' : 'Sem internet: usando o conteúdo já baixado.'); navigate(); } }, 'Baixar conteúdo offline'),
            h('button', { class: 'btn bad', onclick: logout }, 'Sair da conta'))))));
});

/* ---------------- painel de palco ---------------- */
route(/^#\/palco(\?.*)?$/, async (view, query) => {
  if (!data.at) await refresh();
  const qs = new URLSearchParams(query ?? '');
  let queue; // [{ song, moment }]
  if (qs.has('set')) {
    const set = setlistById(Number(qs.get('set')));
    if (!set) throw new Error('Repertorio nao encontrado.');
    let moment = null; queue = [];
    for (const it of set.items) {
      if (it.songId == null) { moment = it.label; continue; }
      const song = songById(it.songId);
      if (song) queue.push({ song, moment }); moment = null;
    }
  } else {
    const song = songById(Number(qs.get('song')));
    if (!song) throw new Error('Musica nao encontrada.');
    queue = [{ song, moment: null }];
  }
  if (!queue.length) throw new Error('Este repertorio nao tem musicas.');

  let idx = Math.min(Math.max(Number(qs.get('i')) || 0, 0), queue.length - 1);
  let steps = 0, auto = false, autoTimer = null, searching = false;
  const ttl = h('span', { class: 'ttl' }), sub = h('span', { class: 'sub' }), cnt = h('span', { class: 'cnt' }), mom = h('div', { class: 'mom' });
  const body = h('div', { class: 'body' });
  const cols = h('div', { class: 'cols' }); // dentro do body: em paginacao e deslocado com translateX (scrollLeft e limitado pelo navegador na ultima pagina)
  body.append(cols);
  let pageNo = 0;
  const autoBtn = h('button', { onclick: () => toggleAuto() }, 'Rolagem');
  const dgPanel = h('div', { class: 'dgpanel', hidden: true });
  const dgBtn = h('button', { onclick: () => { dgPanel.hidden = !dgPanel.hidden; dgBtn.classList.toggle('on', !dgPanel.hidden); draw(true); } }, 'Acordes');
  const audioPanel = h('div', { class: 'audiopanel', hidden: true });
  const audioBtn = h('button', { onclick: () => toggleAudio() }, '♪ Áudio');
  let audioUrl = null, audioEl = null;
  const stopAudio = () => { audioEl?.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; audioEl = null; audioPanel.hidden = true; audioPanel.replaceChildren(); audioBtn.classList.remove('on'); };
  async function toggleAudio() {
    if (audioEl) { stopAudio(); return; }
    const { song } = queue[idx];
    if (!song.audioName || isTmp(song.id)) { toast('Esta musica nao tem audio.'); return; }
    audioBtn.disabled = true;
    try {
      audioUrl = await backend.getAudioUrl(song.id);
    } catch { toast('O audio precisa de internet (nao fica salvo offline).'); audioBtn.disabled = false; return; }
    audioBtn.disabled = false;
    audioEl = h('audio', { controls: true, src: audioUrl, style: 'flex:1;min-width:200px' });
    const speed = h('select', { onchange: () => { audioEl.playbackRate = Number(speed.value); } }, [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map((v) => h('option', { value: v }, `${v}x`)));
    speed.value = '1';
    audioPanel.replaceChildren(audioEl, h('label', { style: 'margin:0;color:#bbb' }, 'Velocidade ', speed));
    audioPanel.hidden = false; audioBtn.classList.add('on');
  }

  const GAP = 40; // espaco entre colunas (px)
  const isPages = () => store.settings.mode === 'pages';

  /** Aplica cores, fonte, modo (paginacao x rolagem) e numero de colunas. */
  function applyLayout() {
    const s = store.settings;
    applyTheme(stage);
    const nCols = s.columns === 'auto' ? (window.innerWidth >= 1000 ? 2 : 1) : Number(s.columns);
    body.className = `body ${s.mode === 'pages' ? 'pages' : 'scroll'}${s.uppercase ? ' upper' : ''}`;
    cols.style.columnCount = s.mode === 'pages' ? String(nCols) : ''; // em rolagem, colunas quebrariam o scroll vertical
    cols.style.columnGap = `${GAP}px`;
    if (s.mode !== 'pages') cols.style.transform = '';
    body.style.fontSize = `${store.fontSize}px`;
    autoBtn.hidden = s.mode === 'pages';
    if (s.mode === 'pages' && auto) toggleAuto();
  }

  /** Largura de uma "pagina" (todas as colunas visiveis) em modo paginacao. */
  const pageStep = () => {
    const cs = getComputedStyle(body);
    return body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + GAP;
  };
  const pageCount = () => {
    const blks = cols.children;
    if (!blks.length) return 1;
    return Math.floor((blks[blks.length - 1].offsetLeft - blks[0].offsetLeft + 1) / pageStep()) + 1;
  };

  function updateCounter() {
    const { song } = queue[idx];
    let txt = `♪ ${idx + 1} / ${queue.length}`;
    if (isPages()) { const total = pageCount(); if (total > 1) txt += `  ·  pág. ${pageNo + 1}/${total}`; }
    cnt.textContent = txt;
    cnt.title = song.title;
  }

  /** Mostra a pagina n (0-based), limitada ao total. */
  function setPage(n) {
    if (!isPages()) { updateCounter(); return; }
    pageNo = Math.max(0, Math.min(n, pageCount() - 1));
    cols.style.transform = `translateX(${-pageNo * pageStep()}px)`;
    updateCounter();
  }

  function draw(keepScroll = false) {
    const { song, moment } = queue[idx];
    const text = transposeBody(song.body, steps);
    if (!dgPanel.hidden) renderDiagrams(dgPanel, chordsIn(text));
    ttl.textContent = song.title;
    const toneNow = song.tone ? transposeChord(song.tone.replace(/m$/, ''), steps) + (song.tone.endsWith('m') ? 'm' : '') : '';
    sub.textContent = [song.artist, toneNow && `Tom: ${toneNow}`, song.capo ? `Capo na ${song.capo}ª casa` : ''].filter(Boolean).join('  ·  ');
    mom.textContent = moment ?? ''; mom.hidden = !moment;
    applyLayout();
    renderCifra(cols, text);
    if (!keepScroll) { body.scrollTop = 0; pageNo = 0; }
    setPage(pageNo); // mantem a pagina (limitada ao novo total) quando so o tom/fonte mudam
  }
  const go = (n) => { if (n < 0 || n >= queue.length) return; stopAudio(); idx = n; steps = 0; draw(); };

  /** Proxima/anterior: vira a pagina (colunas) ou desce a tela; no fim/inicio passa para a musica vizinha. */
  const page = (dir) => {
    if (isPages()) {
      if (dir > 0) { if (pageNo < pageCount() - 1) setPage(pageNo + 1); else go(idx + 1); }
      else if (pageNo > 0) setPage(pageNo - 1);
      else go(idx - 1);
      return;
    }
    const room = body.scrollHeight - body.clientHeight - body.scrollTop;
    if (dir > 0 && room > 4) body.scrollBy({ top: body.clientHeight * 0.9, behavior: 'smooth' });
    else if (dir > 0) go(idx + 1);
    else if (body.scrollTop > 4) body.scrollBy({ top: -body.clientHeight * 0.9, behavior: 'smooth' });
    else go(idx - 1);
  };
  const tone = (n) => { steps += n; draw(true); };
  const font = (n) => { store.fontSize = Math.min(48, Math.max(10, store.fontSize + n)); draw(true); };
  let acc = 0;
  function toggleAuto() {
    if (isPages()) { toast('A rolagem automatica funciona no modo "Rolagem continua" (Configuracoes).'); return; }
    auto = !auto; autoBtn.classList.toggle('on', auto);
    clearInterval(autoTimer);
    if (auto) autoTimer = setInterval(() => {
      acc += store.settings.speed * 0.03; // px/s * 30 ms
      const whole = Math.floor(acc);
      if (whole) { body.scrollTop += whole; acc -= whole; }
    }, 30);
  }
  function openConfig() {
    if (searching) return; searching = true;
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { document.removeEventListener('keydown', onEsc, true); runSettingsCleanups(); searching = false; bg.remove(); draw(true); syncMidi(); syncWake(); };
    const bg = h('div', { class: 'dlg-bg', style: 'z-index:60', onclick: (e) => e.target === bg && close() },
      h('div', { class: 'dlg' }, h('h2', {}, 'Configurações do painel'), settingsForm(() => draw(true)), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn pri', onclick: close }, 'Fechar'))));
    document.addEventListener('keydown', onEsc, true);
    document.body.append(bg);
  }
  function exit() { location.hash = qs.has('set') ? `#/setlist/${qs.get('set')}` : '#/songs'; }

  function openSearch() {
    if (searching) return; searching = true;
    const input = h('input', { type: 'text', placeholder: 'Buscar no repertorio...' });
    const res = h('div', { class: 'pick' });
    const close = () => { searching = false; bg.remove(); };
    const draw2 = () => {
      const t = input.value.trim().toLowerCase();
      const found = queue.map((q, i) => ({ q, i })).filter(({ q }) => !t || `${q.song.title} ${q.song.artist}`.toLowerCase().includes(t)).slice(0, 30);
      res.replaceChildren(...found.map(({ q, i }) => h('div', { onclick: () => { close(); go(i); } }, `${i + 1}. ${q.song.title} — ${q.song.artist}`)));
      return found;
    };
    input.addEventListener('input', draw2);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') { const f = draw2(); if (f[0]) { close(); go(f[0].i); } } });
    const bg = h('div', { class: 'dlg-bg', style: 'z-index:60', onclick: (e) => e.target === bg && close() }, h('div', { class: 'dlg' }, input, res));
    document.body.append(bg); draw2(); input.focus();
  }

  // ---- pedal: teclado Bluetooth (HID) e MIDI; os botoes sao os que o usuario ensinou em Configuracoes ----
  const pedalCfg = () => normalizePedal(store.settings.pedal);
  const pedalActions = { next: () => page(1), prev: () => page(-1), toneUp: () => tone(1), toneDown: () => tone(-1), toneReset: () => { steps = 0; draw(true); }, auto: toggleAuto, search: openSearch };
  let allow = makeThrottle(pedalCfg().debounce), allowMs = pedalCfg().debounce;
  /** Executa a acao ligada ao botao. Devolve true se o botao e do pedal (mesmo que o toque tenha sido barrado por ser repetido). */
  const runBinding = (id, repeat = false) => {
    if (!pedalCfg().enabled) return false; // chave geral desligada
    const action = resolveAction(pedalCfg().bindings, id);
    if (!action) return false;
    if (pedalCfg().debounce !== allowMs) { allowMs = pedalCfg().debounce; allow = makeThrottle(allowMs); }
    if (!repeat && !searching && allow(action)) pedalActions[action]();
    return true;
  };
  const onKey = (e) => {
    if (searching || activeListeners > 0 || e.target.closest?.('input,textarea,select')) return;
    const id = keyBinding(e);
    if (id && runBinding(id, e.repeat)) { e.preventDefault(); return; }
    // atalhos fixos de teclado (nao dependem do pedal)
    const scrollStep = (d) => (isPages() ? page(d) : body.scrollBy({ top: d * 60 }));
    const fixed = { ArrowDown: () => scrollStep(1), ArrowUp: () => scrollStep(-1), '+': () => tone(1), '=': () => tone(1), '-': () => tone(-1), '*': () => { steps = 0; draw(true); }, F2: openConfig, Escape: exit };
    if (fixed[e.key]) { e.preventDefault(); fixed[e.key](); }
  };
  document.addEventListener('keydown', onKey);
  let unsubMidi = null, disposed = false;
  const onMidi = (d) => { const id = midiBinding(d); if (id && activeListeners === 0) runBinding(id); };
  async function syncMidi() {
    const want = pedalCfg().enabled && pedalCfg().midi;
    if (want && !unsubMidi) {
      try { const u = await midiHub.subscribe(onMidi); if (disposed) u(); else unsubMidi = u; } catch (e) { toast(e.message); }
    } else if (!want && unsubMidi) { unsubMidi(); unsubMidi = null; }
  }
  syncMidi();

  // tela ligada durante a musica: com pedal ninguem toca na tela e ela apagaria sozinha
  let wakeLock = null;
  async function syncWake() {
    try {
      if (store.settings.keepAwake && 'wakeLock' in navigator && !wakeLock && !disposed) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!store.settings.keepAwake && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* sem suporte ou negado pelo sistema (economia de bateria): segue sem */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') syncWake(); }; // o sistema solta o bloqueio ao trocar de app
  document.addEventListener('visibilitychange', onVisible);
  syncWake();
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Tela cheia indisponível neste navegador.'));
    else toast('Tela cheia indisponível neste navegador.');
  };
  const onResize = () => { applyLayout(); setPage(pageNo); };
  window.addEventListener('resize', onResize);
  stageCleanup = () => { disposed = true; unsubMidi?.(); wakeLock?.release().catch(() => {}); document.removeEventListener('visibilitychange', onVisible); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); clearInterval(autoTimer); stopAudio(); };

  // toque: terco direito avanca, terco esquerdo volta (no meio nao faz nada, para poder selecionar/rolar)
  body.addEventListener('click', (e) => { const x = e.clientX / window.innerWidth; if (x > 0.66) page(1); else if (x < 0.33) page(-1); });
  const btn = (label, fn, title) => h('button', { onclick: fn, title }, label);
  const stage = h('div', { class: 'stage' },
    h('div', { class: 'top' }, mom, ttl, sub, cnt), body, dgPanel, audioPanel,
    h('div', { class: 'bar' }, h('span', { class: 'brand' }, 'TocaCifra'),
      btn('← Anterior', () => page(-1)), btn('Próxima →', () => page(1)), btn('F4 Busca', openSearch),
      btn('− Tom', () => tone(-1)), btn('★ Tom', () => { steps = 0; draw(true); }, 'Voltar ao tom original'), btn('+ Tom', () => tone(1)),
      btn('A−', () => font(-2)), btn('A+', () => font(2)), dgBtn, audioBtn, autoBtn, btn('⚙ Config', openConfig, 'Configuracoes do painel (F2)'), btn('⛶ Tela cheia', toggleFullscreen), btn('Esc Sair', exit)));
  view.replaceChildren(stage);
  draw();
});

/* ---------------- afinador ---------------- */
route(/^#\/afinador$/, async (view) => {
  let stream = null, ctx = null, raf = 0, running = false;
  const recent = [];
  const tuningSel = h('select', {}, Object.entries(TUNINGS).map(([k, v]) => h('option', { value: k }, v.label)));
  tuningSel.value = localStorage.getItem('tc_tuning') && TUNINGS[localStorage.getItem('tc_tuning')] ? localStorage.getItem('tc_tuning') : 'violao';
  const noteEl = h('div', { class: 'note' }, '—');
  const infoEl = h('div', { class: 'muted' }, 'Toque uma corda e deixe soar.');
  const needle = h('div', { class: 'needle' });
  const meter = h('div', { class: 'meter' }, h('div', { class: 'mid' }), needle);
  const strings = h('div', { class: 'strings' });
  const err = h('p', { class: 'err' });
  const startBtn = h('button', { class: 'btn pri', onclick: () => (running ? stop() : start()) }, 'Ligar microfone');

  const drawStrings = (current) => {
    const list = TUNINGS[tuningSel.value].strings ?? [];
    strings.replaceChildren(...list.map((s) => h('button', { class: 'btn' + (s === current ? ' cur' : ''), title: `${Math.round(noteToFreq(s) * 10) / 10} Hz` }, s.replace(/\d/, (d) => d))));
  };
  tuningSel.addEventListener('change', () => { localStorage.setItem('tc_tuning', tuningSel.value); drawStrings(null); });
  drawStrings(null);

  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  function tick(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    const f = detectPitch(buf, ctx.sampleRate);
    if (f) {
      recent.push(f); if (recent.length > 5) recent.shift();
      const freq = median(recent);
      const strs = TUNINGS[tuningSel.value].strings;
      let name, cents, current = null;
      if (strs) { const n = nearestString(freq, strs); current = n.note; name = n.note.replace(/\d/, ''); cents = n.cents; noteEl.replaceChildren(name, h('small', {}, n.note.slice(-1))); }
      else { const n = freqToNote(freq); cents = n.cents; noteEl.replaceChildren(n.name, h('small', {}, String(n.octave))); }
      const clamped = Math.max(-50, Math.min(50, cents));
      needle.style.left = `${50 + clamped}%`;
      const ok = Math.abs(cents) <= 5;
      needle.classList.toggle('in', ok);
      infoEl.textContent = ok ? 'Afinado ✓' : cents < 0 ? `${Math.abs(cents)} centavos abaixo — aperte a corda` : `${cents} centavos acima — afrouxe a corda`;
      drawStrings(current);
    } else if (recent.length) { recent.shift(); }
    raf = requestAnimationFrame(() => tick(analyser, buf));
  }

  async function start() {
    err.textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) { err.textContent = 'Este navegador nao permite usar o microfone (use HTTPS ou localhost).'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch { err.textContent = 'Nao foi possivel usar o microfone. Permita o acesso nas configuracoes do navegador.'; return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    ctx.createMediaStreamSource(stream).connect(analyser);
    running = true; startBtn.textContent = 'Desligar microfone';
    tick(analyser, new Float32Array(analyser.fftSize));
  }
  function stop() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close();
    stream = ctx = null; running = false; startBtn.textContent = 'Ligar microfone';
  }
  stageCleanup = stop;

  view.replaceChildren(h('div', { class: 'tuner' }, h('h1', {}, 'Afinador'),
    h('div', { class: 'row', style: 'justify-content:center' }, tuningSel, startBtn), err, noteEl, meter, infoEl, strings,
    h('p', { class: 'muted' }, 'Funciona sem internet. O microfone so e usado enquanto esta ligado e nada e gravado ou enviado.')));
});

/* ---------------- inicio ---------------- */
async function boot() {
  onSystemThemeChange(renderNav); // em "automatico", acompanha o aparelho se ele mudar de tema
  window.addEventListener('hashchange', navigate);
  renderNav();

  backend = await createBackend();
  if (backend.kind === 'unconfigured') {
    $('#view').replaceChildren(h('div', { class: 'card' }, h('h1', {}, 'Configuração pendente'), h('p', {}, 'Faltam o endereço e a chave pública do Supabase no arquivo config.js.')));
    return;
  }
  backend.onAuthLost = () => { if (store.token) { logout(); toast('Sua sessao expirou. Entre novamente.'); } };
  backend.onPasswordRecovery = () => { location.hash = '#/nova-senha'; };

  // restaura o login salvo; sem internet e sem como confirmar, mantem o login e o conteudo ja baixado
  const r = await backend.init();
  if (backend.kind === 'supabase') {
    if (r.user) { store.token = 'sb'; store.user = r.user; } // 'sb' = marcador de "logado"; a sessao real fica com o Supabase
    else if (!r.offline) { store.token = null; store.user = null; }
  }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash); // limpa o ?code=... do link do e-mail

  loadCache();
  window.addEventListener('online', () => refresh().then(navigate));
  window.addEventListener('offline', () => { data.online = false; renderNav(); });
  renderNav();
  navigate();
}
boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline do casco */ });
