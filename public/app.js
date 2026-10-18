import { KEYS, SECTIONS, guessKey, isChord, isChordLine, lyricFor, parseLines, tidyCifra, toggleSection, transposeBody, transposeChord, wrapPair } from './chords.js';
import { facets, filterSongs } from './filters.js';
import { onSystemThemeChange, readTheme, resolveTheme, saveTheme, systemPrefersDark, toggleTheme } from './theme.js';
import { ACTIONS, DEFAULT_PEDAL, assignBinding, createMidiHub, keyBinding, labelFor, makeThrottle, midiBinding, normalizePedal, resolveAction } from './pedal.js';
import { INSTRUMENTS, chordShape, chordSvg } from './diagrams.js';
import { TUNINGS, detectPitch, freqToNote, nearestString, noteToFreq } from './tuner.js';
import { OfflineError } from './errors.js';
import { createBackend } from './backend.js';
import { importBackup, parseBackup } from './migrate.js';
import { APK_URL, checkForUpdate, localVersion, shortSha } from './update.js';

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

/* ---- icones simples (desenhados aqui; herdam a cor do texto) ---- */
const ICONS = {
  back: 'M15 5l-7 7 7 7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sliders: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1',
  more: 'M12 6v.01M12 12v.01M12 18v.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  chevron: 'M9 5l7 7-7 7',
  prev: 'M14 5l-7 7 7 7',
  next: 'M10 5l7 7-7 7',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM19 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  tuner: 'M8 4v7a4 4 0 008 0V4M12 15v5M9 20h6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  logout: 'M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h4M15 8l4 4-4 4M19 12H9',
  play: 'M8 5l11 7-11 7z',
  edit: 'M5 19l1-4L16 5l3 3L9 18zM14 7l3 3',
  chords: 'M5 4v16M10 4v16M15 4v16M20 4v16M5 9h15M5 15h15',
  audio: 'M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  help: 'M9 9a3 3 0 116 0c0 2-3 2-3 4M12 17v.01',
  close: 'M6 6l12 12M18 6L6 18',
  scroll: 'M12 5v14M7 14l5 5 5-5',
};
/** Icone SVG; `size` em px. */
function icon(name, size = 22) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] ?? ''); svg.append(p);
  return svg;
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

/** Titulo e "voltar" de cada tela (barra superior, como no ToqueFacil). */
function pageMeta(hash) {
  const h0 = hash || '#/menu';
  const rules = [
    [/^#\/menu/, { title: '', back: null }],
    [/^#\/songs/, { title: 'Minhas músicas', back: '#/menu' }],
    [/^#\/song\/new/, { title: 'Nova música', back: '#/songs' }],
    [/^#\/song\//, { title: 'Editar música', back: '#/songs' }],
    [/^#\/setlists/, { title: 'Repertórios', back: '#/menu' }],
    [/^#\/repertorio\//, { title: 'Repertório', back: '#/setlists' }],
    [/^#\/setlist\/new/, { title: 'Novo repertório', back: '#/setlists' }],
    [/^#\/setlist\//, { title: 'Editar repertório', back: '#/setlists' }],
    [/^#\/afinador/, { title: 'Afinador', back: '#/menu' }],
    [/^#\/instalar/, { title: 'Instalar no celular', back: '#/menu' }],
    [/^#\/config/, { title: 'Configurações', back: '#/menu' }],
    [/^#\/login|^#\/nova-senha/, { title: '', back: null }],
  ];
  return (rules.find(([re]) => re.test(h0)) ?? [null, { title: '', back: '#/menu' }])[1];
}

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  const meta = pageMeta(location.hash);
  const logged = !!store.token;
  // botao rapido claro/escuro: mostra o tema atual e alterna ao clicar
  const dark = resolveTheme(readTheme(), systemPrefersDark()) === 'dark';
  const themeBtn = h('button', { class: 'ib', title: dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro', 'aria-label': dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro', onclick: () => { toggleTheme(); renderNav(); } }, dark ? '🌙' : '☀️');
  nav.append(logged && meta.back
    ? h('a', { class: 'ib', href: meta.back, 'aria-label': 'Voltar' }, icon('back'))
    : h('a', { class: 'brand', href: logged ? '#/menu' : '#/login' }, h('img', { src: 'icon-192.png', alt: '', width: 28, height: 28 }), 'TocaCifra'));
  if (meta.title) nav.append(h('h1', { class: 'title' }, meta.title));
  nav.append(h('span', { class: 'sp' }));
  if (!logged) { nav.append(themeBtn); return; }
  const pending = store.queue.length;
  if (pending) nav.append(h('span', { class: 'chip', title: 'Edicoes feitas sem internet, aguardando sincronizar' }, `${pending} pendente${pending > 1 ? 's' : ''}`));
  if (!data.online) nav.append(h('span', { class: 'chip off' }, 'offline'));
  nav.append(themeBtn, h('a', { class: 'ib', href: '#/config', 'aria-label': 'Configurações', title: 'Configurações' }, icon('sliders')));
}

const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let stageCleanup = null;

async function navigate() {
  stageCleanup?.();
  stageCleanup = null;
  runSettingsCleanups(); // para de escutar o pedal se a tela de configuracao foi deixada
  const hash = location.hash || '#/menu';
  if (!store.token && !hash.startsWith('#/login') && !hash.startsWith('#/nova-senha') && !hash.startsWith('#/instalar')) { location.hash = '#/login'; return; }
  const tmp = /^#\/(song|setlist)\/(-\d+)/.exec(hash);
  if (tmp && resolvedIds[tmp[2]]) { location.replace(`#/${tmp[1]}/${resolvedIds[tmp[2]]}`); return; }
  const view = $('#view');
  view.classList.toggle('wide', /^#\/(song|setlist|config|palco)/.test(hash)); // editor e configuracoes usam mais largura no computador
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) {
    const m = re.exec(hash);
    if (m) {
      try { await fn(view, ...m.slice(1)); } catch (e) { view.replaceChildren(h('p', { class: 'err' }, e.message)); }
      renderNav();
      return;
    }
  }
  location.hash = '#/menu';
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
      location.hash = '#/menu';
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } },
  title, nickField, h('div', { class: 'field' }, h('label', {}, 'E-mail'), email), h('div', { class: 'field' }, h('label', {}, 'Senha'), pass), err,
  h('div', { class: 'row' }, submit, swap),
  backend.capabilities.passwordReset ? h('p', {}, h('a', { href: '#', onclick: async (e) => {
    e.preventDefault(); err.textContent = '';
    const to = email.value.trim() || prompt('Digite o e-mail da sua conta:');
    if (!to) return;
    try { await backend.requestPasswordReset(to); toast('Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.'); } catch (ex) { err.textContent = ex.message; }
  } }, 'Esqueci a minha senha')) : null,
  isNativeApp() ? null : h('p', {}, h('a', { href: '#/instalar' }, 'Instalar o app no celular (QR code)')));
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
      location.hash = '#/menu';
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } },
  h('h1', {}, 'Nova senha'), h('p', { class: 'muted' }, 'Escolha uma senha nova para a sua conta.'),
  h('div', { class: 'field' }, h('label', {}, 'Nova senha (minimo 6 caracteres)'), pass), h('div', { class: 'field' }, h('label', {}, 'Repita a nova senha'), pass2), err, h('div', { class: 'row' }, submit)));
});

/* ---------------- menu inicial (como no ToqueFacil: botoes grandes) ---------------- */
route(/^#\/menu$/, async (view) => {
  const btn = (ic, label, sub, onclick, href) => h(href ? 'a' : 'button', { class: 'menu-btn', href, onclick, type: href ? undefined : 'button' },
    h('span', { class: 'mi' }, icon(ic, 26)), h('span', { class: 'mt' }, h('b', {}, label), sub ? h('small', {}, sub) : null), h('span', { class: 'mc' }, icon('chevron', 20)));
  const downloaded = data.at ? `Baixado em ${new Date(data.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Ainda não baixado';
  const status = h('p', { class: 'muted menu-status' }, downloaded);
  view.replaceChildren(
    h('div', { class: 'menu' },
      h('div', { class: 'menu-head' }, h('div', { class: 'hello' }, `Olá, ${store.user?.nick || 'músico'}`), status),
      btn('download', 'Conteúdo', 'Baixar músicas e repertórios para usar sem internet', async () => {
        status.textContent = 'Baixando…';
        await refresh();
        status.textContent = data.online ? `Pronto: ${data.songs.length} músicas e ${data.setlists.length} repertórios salvos neste aparelho.` : 'Sem internet: usando o conteúdo já baixado.';
      }),
      btn('note', 'Músicas', h('span', { class: 'n-songs' }, `${data.songs.length} neste aparelho`), null, '#/songs'),
      btn('plus', 'Importar cifra', 'Colar o texto ou o link de uma cifra', () => importDialog()),
      btn('list', 'Repertórios', h('span', { class: 'n-sets' }, `${data.setlists.length} neste aparelho`), null, '#/setlists'),
      btn('tuner', 'Afinador', 'Violão, cavaco, ukulele e baixo', null, '#/afinador'),
      isNativeApp() ? null : btn('download', 'Instalar no celular', 'QR code para Android e iPhone', null, '#/instalar'),
      btn('logout', 'Sair', 'Encerrar a sessão neste aparelho', () => { if (confirm('Sair da conta neste aparelho?')) logout(); })));
  refresh().then(() => {
    if (location.hash !== '#/menu') return;
    $('.n-songs')?.replaceChildren(`${data.songs.length} neste aparelho`);
    $('.n-sets')?.replaceChildren(`${data.setlists.length} neste aparelho`);
  });
});

/* ---------------- instalar no celular (QR codes) ---------------- */
const isNativeApp = () => !!(window.Capacitor?.isNativePlatform?.());

route(/^#\/instalar$/, (view) => {
  const qr = (src, alt) => h('img', { src, alt, width: 220, height: 220, class: 'qr' });
  view.replaceChildren(h('div', { class: 'page install' },
    store.token ? null : h('p', {}, h('a', { href: '#/login' }, '‹ Voltar para entrar')),
    h('h1', {}, 'Instalar no celular'),
    h('div', { class: 'card' }, h('h2', {}, 'Android (aplicativo)'),
      qr('qr-android.png', 'QR code para baixar o aplicativo Android'),
      h('ol', {}, h('li', {}, 'Aponte a câmera do celular para o QR code.'), h('li', {}, 'Toque em ', h('b', {}, 'TocaCifra.apk'), ' para baixar.'),
        h('li', {}, 'Abra o arquivo e toque em ', h('b', {}, 'Instalar'), ' (permita "instalar desta fonte" se o Android pedir).')),
      h('a', { class: 'btn pri', href: 'https://github.com/gustavocareta/tocacifra/releases/tag/android-latest', target: '_blank', rel: 'noopener' }, 'Baixar o APK')),
    h('div', { class: 'card' }, h('h2', {}, 'iPhone / iPad'),
      qr('qr-site.png', 'QR code para abrir o TocaCifra no Safari'),
      h('ol', {}, h('li', {}, 'Aponte a câmera para o QR code e abra no ', h('b', {}, 'Safari'), '.'),
        h('li', {}, 'Toque em ', h('b', {}, 'Compartilhar'), ' → ', h('b', {}, 'Adicionar à Tela de Início'), '.')))));
});

/* ---------------- lista de musicas ---------------- */
const songFilters = { term: '', artist: '', style: '', sort: 't', tone: '', mode: 'songs' }; // lembrados ao voltar para a lista

/** <select> de filtro com "Todos ..." e as opcoes de `items` ({key,name,count}). */
function facetSelect(allLabel, items, current, onPick) {
  const sel = h('select', { class: 'fsel', onchange: () => onPick(sel.value) }, h('option', { value: '' }, allLabel), items.map((i) => h('option', { value: i.key }, `${i.name} (${i.count})`)));
  sel.value = items.some((i) => i.key === current) ? current : '';
  return sel;
}

route(/^#\/songs$/, async (view) => {
  await refresh();
  const q = h('input', { type: 'search', placeholder: 'Buscar por título, letra ou artista', value: songFilters.term, enterkeyhint: 'search', autocomplete: 'off' });
  const listEl = h('div', { class: 'list' });
  const count = h('p', { class: 'muted count' });
  const modeBar = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ver por' });
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  const byTitleCmp = (a, b) => collator.compare(a.title, b.title);
  const MODES = [['songs', 'Músicas'], ['artists', 'Artistas'], ['tones', 'Tom']];
  const toneLabel = (t) => t || 'Sem tom';

  const draw = () => {
    const f = facets(data.songs);
    // se o artista/tom escolhido nao existe mais (ex.: a ultima musica dele foi apagada), volta para a lista de escolha
    if (songFilters.artist && !f.artists.some((a) => a.key === songFilters.artist)) songFilters.artist = '';
    if (songFilters.tone != null && songFilters.tone !== '' && !data.songs.some((s) => (s.tone || '-') === songFilters.tone)) songFilters.tone = '';
    modeBar.replaceChildren(...MODES.map(([k, label]) => h('button', { type: 'button', class: songFilters.mode === k ? 'on' : '', 'aria-pressed': songFilters.mode === k, onclick: () => { songFilters.mode = k; songFilters.artist = ''; songFilters.tone = ''; draw(); } }, label)));
    const t = songFilters.term.trim().toLowerCase();
    const pickRows = (rows, onPick, noun) => {
      count.textContent = data.songs.length ? `${rows.length} ${noun}` : '';
      listEl.replaceChildren(...rows.map((r) => h('button', { type: 'button', class: 'li li-main artist-row', onclick: () => onPick(r) }, h('b', {}, r.name), h('small', {}, `${r.count} música${r.count > 1 ? 's' : ''}`))));
      if (!rows.length) listEl.append(h('p', { class: 'empty' }, `Nenhum resultado em ${noun}.`));
    };
    // "Artistas" e "Tom": a propria aba ja abre a escolha; tocar num item mostra as musicas dele
    if (songFilters.mode === 'artists' && !songFilters.artist) {
      pickRows(f.artists.filter((a) => !t || a.name.toLowerCase().includes(t)), (a) => { songFilters.artist = a.key; draw(); }, 'artistas');
      return;
    }
    if (songFilters.mode === 'tones' && !songFilters.tone) {
      const counts = new Map();
      data.songs.forEach((s) => { const k = s.tone || '-'; counts.set(k, (counts.get(k) ?? 0) + 1); });
      const rows = [...counts].map(([key, n]) => ({ key, name: toneLabel(key === '-' ? '' : key), count: n }))
        .filter((r) => !t || r.name.toLowerCase().includes(t)).sort((a, b) => collator.compare(a.key === '-' ? '~' : a.key, b.key === '-' ? '~' : b.key));
      pickRows(rows, (r) => { songFilters.tone = r.key; draw(); }, 'tons');
      return;
    }
    let list = filterSongs(data.songs, { term: songFilters.term, artist: songFilters.artist, style: '' });
    if (songFilters.mode === 'tones') list = list.filter((s) => (s.tone || '-') === songFilters.tone);
    list.sort(byTitleCmp);
    const chosen = songFilters.mode === 'artists' ? 'artistas' : songFilters.mode === 'tones' ? 'tons' : '';
    const backRow = chosen ? h('button', { type: 'button', class: 'btn sm', onclick: () => { songFilters.artist = ''; songFilters.tone = ''; draw(); } }, `‹ Todos os ${chosen}`) : null;
    count.textContent = data.songs.length ? `${list.length} de ${data.songs.length} músicas` : '';
    listEl.replaceChildren(backRow, ...list.map((s) => h('div', { class: 'li' },
      h('a', { class: 'li-main', href: `#/palco?song=${s.id}` },
        h('b', {}, s.title),
        h('small', {}, [s.artist, s.tone && `Tom ${s.tone}`, s.style].filter(Boolean).join(' · ') || 'Sem artista')),
      h('a', { class: 'ib', href: `#/song/${s.id}`, 'aria-label': `Editar ${s.title}`, title: 'Editar' }, icon('edit', 20)))));
    if (!list.length) listEl.append(h('p', { class: 'empty' }, data.songs.length ? 'Nada encontrado.' : 'Nenhuma música ainda. Toque em + para cadastrar ou importar a primeira.'));
  };
  q.addEventListener('input', () => { songFilters.term = q.value; draw(); });
  draw();
  view.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'actions-row' },
        h('a', { class: 'btn pri big grow', href: '#/song/new' }, icon('edit', 18), ' Nova música'),
        h('button', { class: 'btn big grow', type: 'button', onclick: () => importDialog() }, icon('download', 18), ' Importar cifra')),
      h('div', { class: 'searchbar' }, icon('search', 20), q),
      modeBar, count, listEl),
    fab([['edit', 'Nova música', () => { location.hash = '#/song/new'; }], ['download', 'Importar cifra', () => importDialog()]]));
});

/** Botao flutuante "+" que abre um menu de acoes (folha inferior). */
function fab(actions) {
  const btn = h('button', { class: 'fab', type: 'button', 'aria-label': 'Adicionar', onclick: () => {
    const close = () => sheet.remove();
    const sheet = h('div', { class: 'dlg-bg sheet-bg', onclick: (e) => e.target === sheet && close() },
      h('div', { class: 'sheet' }, actions.map(([ic, label, fn]) => h('button', { class: 'sheet-item', type: 'button', onclick: () => { close(); fn(); } }, icon(ic, 22), label)),
        h('button', { class: 'sheet-item cancel', type: 'button', onclick: close }, 'Cancelar')));
    document.body.append(sheet);
  } }, icon('plus', 28));
  return btn;
}
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
function renderCifra(target, body, maxChars = 0) {
  const lines = parseLines(body); // marcadores {refrao}/{voz2} somem; cada linha traz a sua secao
  const blocks = [];
  const useSectionColors = store.settings.sectionColors;
  const cls = (l) => `blk${l.section && useSectionColors ? ` sec-${l.section}` : ''}`;
  // maxChars > 0 (painel): quebra as linhas compridas para caberem na tela, mantendo cada acorde sobre a sua silaba
  const pushPair = (l, chord, lyric) => {
    const parts = maxChars > 0 && Math.max(chord.length, lyric.length) > maxChars ? wrapPair(chord, lyric, maxChars) : [{ chord, lyric }];
    for (const p of parts) {
      const kids = [];
      if (p.chord.trim()) kids.push(h('span', { class: 'c' }, p.chord));
      if (p.chord.trim() && p.lyric.trim()) kids.push('\n');
      if (p.lyric.trim() || !p.chord.trim()) kids.push(h('span', { class: 'ly' }, p.lyric || ' '));
      blocks.push(h('div', { class: cls(l) }, ...kids));
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    const k = l.chord ? lyricFor(lines, i) : -1; // acordes + a letra deles (mesmo com linhas em branco no meio) ficam sempre juntos
    if (k > 0) { pushPair(lines[k], l.text, lines[k].text); i = k; }
    else if (l.chord) pushPair(l, l.text, '');
    else pushPair(l, '', l.text);
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

  // ---- layout: no celular, abas (Letra / Previa / Acordes / Audio); no computador, letra e previa lado a lado ----
  const hasAudio = !isNew && !isTmp(song.id);
  const TABS = [['letra', 'Letra'], ['previa', 'Prévia'], ['acordes', 'Acordes'], ...(hasAudio ? [['audio', 'Áudio']] : [])];
  const editor = h('div', { class: 'editor', 'data-tab': 'letra' });
  const tabBar = h('div', { class: 'seg tabs', role: 'tablist' });
  const setTab = (name) => { editor.dataset.tab = name; [...tabBar.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === name)); if (name === 'previa') sync(); };
  TABS.forEach(([k, label]) => tabBar.append(h('button', { type: 'button', role: 'tab', 'data-tab': k, class: k === 'letra' ? 'on' : '', onclick: () => setTab(k) }, label)));

  const moreSheet = () => {
    const close = () => bg.remove();
    const bg = h('div', { class: 'dlg-bg sheet-bg', onclick: (e) => e.target === bg && close() }, h('div', { class: 'sheet' },
      h('button', { class: 'sheet-item', type: 'button', onclick: () => { close(); importDialog(); } }, icon('download', 22), 'Importar cifra (colar texto)'),
      isNew ? null : h('button', { class: 'sheet-item danger', type: 'button', onclick: () => { close(); del(); } }, icon('close', 22), 'Excluir música'),
      h('button', { class: 'sheet-item cancel', type: 'button', onclick: close }, 'Cancelar')));
    document.body.append(bg);
  };

  editor.append(
    err,
    h('div', { class: 'card fields' },
      field('Título', f.title, 'f-title'), field('Artista', f.artist, 'f-artist'),
      field('Tom', f.tone, 'f-tone'), field('Capotraste', f.capo, 'f-capo'), field('Estilo', f.style, 'f-style')),
    h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Ferramentas da cifra' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => shiftTone(-1) }, '− Tom'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => shiftTone(1) }, '+ Tom'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { f.tone.value = guessKey(f.body.value); } }, 'Detectar tom'),
      h('button', { class: 'btn sm', type: 'button', title: 'Junta cada linha de acordes com a letra dela (tira linhas em branco no meio)', onclick: () => {
        const before = f.body.value; f.body.value = tidyCifra(before); f.body.dispatchEvent(new Event('input'));
        toast(f.body.value === before ? 'A cifra já estava certa.' : 'Cifra arrumada: acordes e letra juntos.');
      } }, 'Arrumar cifra'),
      h('button', { class: 'btn sm mk-refrao', type: 'button', title: 'Selecione as linhas e toque: marca ou desmarca como refrão (outra cor)', onclick: () => markSel('refrao') }, SECTIONS.refrao),
      h('button', { class: 'btn sm mk-voz2', type: 'button', title: 'Selecione as linhas e toque: marca ou desmarca como 2ª voz', onclick: () => markSel('voz2') }, SECTIONS.voz2)),
    tabBar,
    h('div', { class: 'editor-grid' }, h('div', { class: 'pane pane-letra' }, field('Letra cifrada', f.body), h('p', { class: 'muted hint' }, 'Acordes em uma linha, letra na de baixo. Selecione linhas e use Refrão ou 2ª Voz para dar outra cor.')),
      h('div', { class: 'pane pane-previa' }, field('Pré-visualização', preview))),
    h('div', { class: 'pane pane-acordes card' }, h('div', { class: 'row' }, h('strong', {}, 'Acordes da música'), instSel, h('label', { class: 'inline' }, leftChk, 'Canhoto')), diag),
    hasAudio ? h('div', { class: 'pane pane-audio' }, audioBox) : null);

  view.replaceChildren(
    editor,
    h('div', { class: 'actionbar' },
      h('button', { class: 'btn pri big grow', type: 'button', onclick: save }, 'Salvar'),
      isNew ? null : h('a', { class: 'btn ok big', href: `#/palco?song=${song.id}` }, icon('play', 18), ' Tocar'),
      h('button', { class: 'ib more', type: 'button', 'aria-label': 'Mais ações', title: 'Mais ações', onclick: moreSheet }, icon('more', 24))));
});

/* ---------------- repertorios ---------------- */
route(/^#\/setlists$/, async (view) => {
  await refresh();
  const items = data.setlists.map((s) => {
    const n = s.items.filter((i) => i.songId != null).length;
    return h('div', { class: 'li' },
      h('a', { class: 'li-main', href: `#/repertorio/${s.id}` }, h('b', {}, s.title), h('small', {}, [`${n} música${n === 1 ? '' : 's'}`, s.style].filter(Boolean).join(' · '))),
      h('a', { class: 'ib', href: `#/setlist/${s.id}`, 'aria-label': `Editar ${s.title}`, title: 'Editar' }, icon('edit', 20)));
  });
  view.replaceChildren(
    h('div', { class: 'page' }, h('p', { class: 'muted count' }, data.setlists.length ? `${data.setlists.length} repertório${data.setlists.length === 1 ? '' : 's'}` : ''),
      h('div', { class: 'list' }, items.length ? items : h('p', { class: 'empty' }, 'Nenhum repertório ainda. Toque em + para criar o primeiro.'))),
    fab([['list', 'Novo repertório', () => { location.hash = '#/setlist/new'; }]]));
});

/** Detalhe do repertorio (como no ToqueFacil): lista numerada; tocar uma musica abre o painel nela. */
route(/^#\/repertorio\/(-?\d+)$/, async (view, id) => {
  if (!data.at) await refresh();
  const set = setlistById(Number(id));
  if (!set) throw new Error('Repertorio nao encontrado.');
  let n = 0;
  const rows = set.items.map((it) => {
    if (it.songId == null) return h('div', { class: 'moment' }, it.label);
    const s = songById(it.songId);
    if (!s) return null;
    const idx = n++;
    return h('a', { class: 'li li-main track', href: `#/palco?set=${set.id}&i=${idx}` },
      h('span', { class: 'no' }, idx + 1),
      h('span', { class: 'tt' }, h('b', {}, s.title), h('small', {}, [s.artist, s.tone && `Tom ${s.tone}`].filter(Boolean).join(' · '))),
      icon('play', 20));
  }).filter(Boolean);
  view.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'detail-head' }, h('h2', {}, set.title), h('p', { class: 'muted' }, [`${n} música${n === 1 ? '' : 's'}`, set.style].filter(Boolean).join(' · '))),
      h('div', { class: 'row' },
        n ? h('a', { class: 'btn pri big', href: `#/palco?set=${set.id}` }, icon('play', 18), ' Tocar do início') : null,
        h('a', { class: 'btn big', href: `#/setlist/${set.id}` }, icon('edit', 18), ' Editar')),
      h('div', { class: 'list tracks' }, rows.length ? rows : h('p', { class: 'empty' }, 'Este repertório está vazio. Toque em Editar para adicionar músicas.'))));
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

/** No app Android o MainActivity avisa cada tecla recebida (evento 'tc-nativekey'), mesmo que o WebView nao a entregue como keydown. */
const ANDROID_KEYS = { 19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight', 23: 'Enter', 62: 'Space', 66: 'Enter', 92: 'PageUp', 93: 'PageDown', 85: 'MediaPlayPause', 126: 'MediaPlayPause', 127: 'MediaPlayPause', 87: 'MediaTrackNext', 88: 'MediaTrackPrevious', 24: 'AudioVolumeUp', 25: 'AudioVolumeDown', 111: 'Escape', 122: 'Home', 123: 'End' };
function nativeKeyEvent(d) {
  const name = ANDROID_KEYS[d.code] ?? String(d.name || `KEYCODE_${d.code}`).replace(/^KEYCODE_/, 'Android_');
  return { key: name, code: name, keyCode: d.code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: document.body, native: true, device: d.device || '', preventDefault() {}, stopPropagation() {} };
}

/** Escuta o proximo botao do pedal (teclado ou MIDI) e chama handler(binding, evento). Retorna a funcao que para de escutar. */
async function listenInputs(handler, { midi = false } = {}) {
  const onKey = (e) => {
    const id = keyBinding(e);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) handler(id, e);
  };
  const onNative = (ev) => { const e = nativeKeyEvent(ev.detail); const id = keyBinding(e); if (id) handler(id, e); };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('tc-nativekey', onNative);
  activeListeners++;
  let unsub = null;
  if (midi) { try { unsub = await midiHub.subscribe((d) => { const id = midiBinding(d); if (id) handler(id); }); } catch (err) { toast(err.message); } }
  return () => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('tc-nativekey', onNative); unsub?.(); activeListeners = Math.max(0, activeListeners - 1); };
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
    const myStop = await listenInputs((binding, ev) => {
      const a = resolveAction(cfg().bindings, binding);
      testOut.textContent = `Recebido: ${labelFor(binding)}${ev?.native ? ' (via Android' + (ev.device ? ': ' + ev.device : '') + ')' : ''} → ${a ? ACTIONS.find((x) => x.id === a).label : '(nenhuma ação ligada a este botão)'}`;
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
            h('button', { class: 'btn bad', onclick: logout }, 'Sair da conta'))),
        updateCard(),
        tidyCard(),
        backupCard())));
});

/** Cartao "Arrumar cifras": junta acordes e letra (sem linhas em branco no meio) em todas as musicas que precisarem. */
function tidyCard() {
  const status = h('p', { class: 'muted' }, 'Corrige músicas em que a cifra ficou separada da letra (linha em branco no meio), para nunca caírem em páginas diferentes.');
  const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const todo = data.songs.filter((s) => !isTmp(s.id) && tidyCifra(s.body) !== s.body);
    if (!todo.length) { status.textContent = 'Todas as músicas já estão certas.'; return; }
    if (!confirm(`Arrumar ${todo.length} música(s)? Só serão removidas linhas em branco entre a cifra e a letra.`)) return;
    btn.disabled = true;
    let ok = 0, fail = 0;
    try {
      for (const s of todo) {
        status.textContent = `Arrumando ${ok + fail + 1}/${todo.length}…`;
        try { await backend.putSong(s.id, { title: s.title, artist: s.artist, tone: s.tone, capo: s.capo, style: s.style, body: tidyCifra(s.body) }); ok++; } catch { fail++; }
      }
      await refresh();
      status.textContent = `Pronto: ${ok} música(s) arrumada(s)${fail ? `, ${fail} falharam` : ''}.`;
    } catch (e) { status.textContent = e.message || 'Não foi possível arrumar.'; } finally { btn.disabled = false; }
  } }, 'Arrumar todas as músicas');
  const n = data.songs.filter((s) => tidyCifra(s.body) !== s.body).length;
  if (n) status.textContent += ` Encontrei ${n} música(s) para arrumar.`;
  return h('div', { class: 'card' }, h('h2', {}, 'Arrumar cifras'), status, h('div', { class: 'row' }, btn));
}

/** Cartao "Atualizar o app": no Android baixa o APK novo (instala por cima); no site/iPhone recarrega com a versao mais nova. */
function updateCard() {
  const native = isNativeApp();
  const status = h('p', { class: 'muted' }, native ? 'Confira se existe uma versão mais nova do aplicativo.' : 'Carrega a versão mais nova do site neste aparelho.');
  const actions = h('div', { class: 'row' });
  const version = h('p', { class: 'muted' }, 'Versão: …');
  localVersion().then((v) => { version.textContent = `Versão instalada: ${shortSha(v)}`; });

  const reloadFresh = async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch { /* segue e recarrega mesmo assim */ }
    location.reload();
  };
  const downloadApk = h('button', { class: 'btn pri', type: 'button', onclick: () => { location.href = APK_URL; } }, 'Baixar e instalar a nova versão');
  const checkBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    checkBtn.disabled = true; status.textContent = 'Verificando…';
    try {
      const r = await checkForUpdate();
      if (r.state === 'current') status.textContent = 'Você já está com a versão mais recente.';
      else if (r.state === 'available') { status.textContent = 'Há uma versão nova! Toque em "Baixar e instalar", abra o arquivo baixado e toque em Instalar (os seus dados continuam).'; actions.append(downloadApk); }
      else status.textContent = 'Não consegui comparar as versões. Toque em "Baixar e instalar" para pegar a mais recente.', actions.append(downloadApk);
    } catch (e) { status.textContent = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Sem internet para verificar.' : e.message; } finally { checkBtn.disabled = false; }
  } }, 'Verificar atualização');
  if (native) actions.append(checkBtn);
  else actions.append(h('button', { class: 'btn pri', type: 'button', onclick: reloadFresh }, 'Atualizar agora'));
  return h('div', { class: 'card' }, h('h2', {}, 'Atualizar o app'), version, status, actions);
}

/** Cartao "Importar de arquivo": traz musicas e repertorios de um backup .json (ex.: vindos do ToqueFacil). */
function backupCard() {
  const status = h('p', { class: 'muted' }, 'Escolha o arquivo de backup (.json). Músicas que já existem (mesmo título e artista) não são duplicadas.');
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const btn = h('button', { class: 'btn', onclick: () => input.click() }, 'Importar de arquivo (.json)');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    btn.disabled = true;
    try {
      const d = parseBackup(await file.text());
      if (!confirm(`Importar ${d.songs.length} músicas e ${d.setlists.length} repertórios para a sua conta?`)) return;
      await refresh();
      const r = await importBackup(d, data, backend, (msg, done, total) => { status.textContent = `${done}/${total} — ${msg}`; });
      await refresh();
      status.textContent = `Pronto: ${r.songsAdded} músicas e ${r.setsAdded} repertórios adicionados (${r.songsSkipped} músicas e ${r.setsSkipped} repertórios já existiam).${r.failed.length ? ` ${r.failed.length} falharam: ${r.failed.slice(0, 3).join('; ')}` : ''}`;
      toast('Importação concluída.');
    } catch (e) { status.textContent = e.message || 'Não foi possível importar.'; } finally { btn.disabled = false; }
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Importar de arquivo'), status, h('div', { class: 'row' }, btn, input));
}

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

  /** Quantos caracteres cabem numa linha da coluna com a fonte atual (a letra e monoespacada); o texto e quebrado nesse limite. */
  function charsPerLine() {
    const cs = getComputedStyle(body);
    const avail = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const n = isPages() ? (parseInt(cols.style.columnCount, 10) || 1) : 1;
    const colW = (avail - GAP * (n - 1)) / n;
    const probe = h('span', { style: 'position:absolute;visibility:hidden;white-space:pre' }, 'M'.repeat(40));
    cols.append(probe);
    const cw = probe.getBoundingClientRect().width / 40;
    probe.remove();
    return cw > 0 && colW > 0 ? Math.max(8, Math.floor((colW - 1) / cw)) : 0;
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
    toneBtn.textContent = toneNow || '♪';
    mom.textContent = moment ?? ''; mom.hidden = !moment;
    applyLayout();
    renderCifra(cols, text, charsPerLine());
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
  function exit() { location.hash = qs.has('set') ? `#/repertorio/${qs.get('set')}` : '#/songs'; }

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
  let lastNative = { key: '', t: 0 };
  const onKey = (e) => {
    if (!e.native && e.key === lastNative.key && Date.now() - lastNative.t < 250) return; // o mesmo toque ja chegou pelo Android
    if (helpClose) helpClose(); // instrucoes abertas: o pedal as fecha e ja executa a acao
    if (searching || activeListeners > 0 || e.target.closest?.('input,textarea,select')) return;
    const id = keyBinding(e);
    if (id && runBinding(id, e.repeat)) { e.preventDefault(); return; }
    // atalhos fixos de teclado (nao dependem do pedal)
    const scrollStep = (d) => (isPages() ? page(d) : body.scrollBy({ top: d * 60 }));
    const fixed = { ArrowDown: () => scrollStep(1), ArrowUp: () => scrollStep(-1), '+': () => tone(1), '=': () => tone(1), '-': () => tone(-1), '*': () => { steps = 0; draw(true); }, F2: openConfig, Escape: exit };
    // setas e Page Up/Down viram pagina mesmo que os botoes padrao tenham sido apagados em Configuracoes (pedal ligado)
    const turn = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 };
    if (fixed[e.key]) { e.preventDefault(); fixed[e.key](); }
    else if (pedalCfg().enabled && turn[e.key]) { e.preventDefault(); if (!e.repeat && allow('turn')) page(turn[e.key]); }
    else if (pedalCfg().enabled && id && e.key.length > 1 && !e.repeat && !/^(Tab|Shift|Control|Alt|Meta|F\d+)$/.test(e.key) && allow('unknown')) {
      toast(`Botão do pedal não reconhecido: ${labelFor(id)}. Ligue-o em Configurações → Pedal → Aprender.`); // ajuda a descobrir o que o pedal envia
    }
  };
  // captura na janela: chega mesmo se algum elemento da tela segurar o foco (WebView do Android)
  window.addEventListener('keydown', onKey, true);
  const onNative = (ev) => { const e = nativeKeyEvent(ev.detail); lastNative = { key: e.key, t: Date.now() }; onKey(e); };
  window.addEventListener('tc-nativekey', onNative);
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
  const onResize = () => { draw(true); };
  window.addEventListener('resize', onResize);
  stageCleanup = () => { disposed = true; unsubMidi?.(); wakeLock?.release().catch(() => {}); document.removeEventListener('visibilitychange', onVisible); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); window.removeEventListener('keydown', onKey, true); window.removeEventListener('tc-nativekey', onNative); window.removeEventListener('resize', onResize); clearInterval(autoTimer); stopAudio(); };

  // toque: terco direito avanca, terco esquerdo volta (no meio nao faz nada, para poder selecionar/rolar)
  body.addEventListener('click', (e) => { const x = e.clientX / window.innerWidth; if (x > 0.66) page(1); else if (x < 0.33) page(-1); });
  // ---- menu de opcoes (folha) e instrucoes, como no ToqueFacil ----
  function openMenu() {
    if (searching) return; searching = true;
    const close = () => { searching = false; bg.remove(); };
    const item = (ic, label, fn, keep = false) => h('button', { class: 'sheet-item', type: 'button', onclick: () => { if (!keep) close(); fn(); } }, icon(ic, 22), label);
    const fontRow = h('div', { class: 'sheet-item font-row' }, icon('note', 22), 'Tamanho da letra',
      h('span', { class: 'sp' }), h('button', { class: 'rb sm', type: 'button', 'aria-label': 'Diminuir a letra', onclick: () => font(-2) }, 'A−'),
      h('button', { class: 'rb sm', type: 'button', 'aria-label': 'Aumentar a letra', onclick: () => font(2) }, 'A+'));
    const bg = h('div', { class: 'dlg-bg sheet-bg', style: 'z-index:60', onclick: (e) => e.target === bg && close() },
      h('div', { class: 'sheet dark' },
        item('search', 'Buscar música (F4)', () => { searching = false; openSearch(); }),
        item('chords', dgPanel.hidden ? 'Mostrar acordes desenhados' : 'Ocultar acordes desenhados', () => dgBtn.click()),
        item('audio', 'Áudio da música', () => toggleAudio()),
        isPages() ? null : item('scroll', auto ? 'Parar rolagem automática' : 'Rolagem automática', () => toggleAuto()),
        fontRow,
        item('tuner', 'Afinador', () => { location.hash = '#/afinador'; }),
        item('sliders', 'Configurações do painel (F2)', () => { searching = false; openConfig(); }),
        item('fullscreen', 'Tela cheia', () => toggleFullscreen()),
        item('help', 'Instruções do painel', () => { searching = false; openHelp(true); }),
        item('logout', 'Sair da música (voltar)', () => exit()),
        h('button', { class: 'sheet-item cancel', type: 'button', onclick: close }, 'Fechar')));
    document.body.append(bg);
  }

  let helpClose = null;
  function openHelp(force = false) {
    let seen = false;
    try { seen = localStorage.getItem('tc_help') === '1'; } catch { /* ignore */ }
    if (seen && !force) return;
    if (searching) return; searching = true;
    const never = h('input', { type: 'checkbox' });
    // a janela de instrucoes aparece so na primeira vez; qualquer tecla do pedal a fecha (senao ela segura o pedal e ele "nao faz nada")
    const close = () => { try { if (never.checked || !force) localStorage.setItem('tc_help', '1'); } catch { /* ignore */ } searching = false; helpClose = null; bg.remove(); };
    helpClose = close;
    const row = (k, t) => h('li', {}, h('b', {}, k), ' ', t);
    const bg = h('div', { class: 'dlg-bg', style: 'z-index:60', onclick: (e) => e.target === bg && close() },
      h('div', { class: 'dlg help' }, h('h2', {}, 'Instruções do painel'),
        h('ul', {}, row('Lado direito da tela', '→ próxima página'), row('Lado esquerdo da tela', '→ página anterior'),
          row('≡', 'menu de opções (busca, acordes, áudio, afinador, configurações)'), row('− e +', 'abaixam e sobem o tom (toque no tom para voltar ao original)'),
          row('◀ e ▶', 'página anterior e próxima'), row('Pedal Bluetooth', 'ensine os botões em Configurações → Pedal')),
        h('label', { class: 'inline' }, never, 'Não mostrar mais esta janela'),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn pri big', type: 'button', onclick: close }, 'Fechar'))));
    document.body.append(bg);
  }

  const rb = (ic, label, fn, cls = '') => h('button', { class: `rb ${cls}`.trim(), type: 'button', onclick: fn, 'aria-label': label, title: label }, icon(ic, 24));
  const toneBtn = h('button', { class: 'rb tone', type: 'button', 'aria-label': 'Tom atual (toque para voltar ao original)', title: 'Tom atual — toque para voltar ao original', onclick: () => { steps = 0; draw(true); } }, '♪');
  const clock = h('span', { class: 'clock' });
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  tick(); const clockTimer = setInterval(tick, 20000);
  const prevCleanup = stageCleanup;
  stageCleanup = () => { clearInterval(clockTimer); prevCleanup?.(); };
  const stage = h('div', { class: 'stage' },
    h('div', { class: 'top' }, mom, ttl, sub, cnt), body, dgPanel, audioPanel,
    h('div', { class: 'bar' },
      rb('back', qs.has('set') ? 'Sair da música e voltar ao repertório' : 'Sair da música e voltar às músicas', exit, 'exit'),
      rb('menu', 'Menu de opções', openMenu), rb('minus', 'Descer o tom', () => tone(-1)), toneBtn, rb('plus', 'Subir o tom', () => tone(1)),
      h('span', { class: 'sp' }), rb('prev', 'Página anterior', () => page(-1), 'nav'), rb('next', 'Próxima página', () => page(1), 'nav'), clock));
  view.replaceChildren(stage);
  activeListeners = 0; // garantia: nenhum "aprender/testar pedal" esquecido pode deixar o painel surdo
  stage.tabIndex = -1; // o painel fica com o foco do teclado: sem isso o WebView do Android pode nao entregar as teclas do pedal
  stage.style.outline = 'none';
  stage.focus({ preventScroll: true });
  draw();
  setTimeout(() => openHelp(false), 400); // primeira vez: mostra as instrucoes
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
