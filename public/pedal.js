// Pedais: qualquer pedal que "digite" (HID/teclado Bluetooth) ou envie MIDI. Cada botao e aprendido pelo usuario,
// entao nao depende de marca. Aqui fica so a logica pura (testavel); a interface esta em app.js.

export const ACTIONS = [
  { id: 'next', label: 'Próxima página / música' },
  { id: 'prev', label: 'Página / música anterior' },
  { id: 'toneUp', label: 'Subir o tom' },
  { id: 'toneDown', label: 'Descer o tom' },
  { id: 'toneReset', label: 'Voltar ao tom original' },
  { id: 'auto', label: 'Rolagem automática (liga/desliga)' },
  { id: 'search', label: 'Buscar música' },
];

export const DEFAULT_PEDAL = {
  bindings: {
    next: ['k:ArrowRight', 'k:PageDown'],
    prev: ['k:ArrowLeft', 'k:PageUp'],
    toneUp: [],
    toneDown: [],
    toneReset: [],
    auto: ['k:Space'],
    search: ['k:F4'],
  },
  enabled: true, // chave geral: desligada, o painel ignora pedal/teclado externo (so toque na tela)
  midi: false,
  debounce: 250, // ms: ignora toques repetidos (pedais Bluetooth as vezes disparam duas vezes)
};

/** Junta a configuracao salva (parcial) com os padroes. */
export function normalizePedal(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const bindings = {};
  for (const a of ACTIONS) {
    const own = s.bindings?.[a.id];
    bindings[a.id] = Array.isArray(own) ? own.filter((b) => typeof b === 'string') : [...DEFAULT_PEDAL.bindings[a.id]];
  }
  const debounce = Number(s.debounce);
  return { bindings, enabled: s.enabled !== false, midi: s.midi === true, debounce: Number.isFinite(debounce) ? Math.min(1000, Math.max(0, debounce)) : DEFAULT_PEDAL.debounce };
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'Dead', 'Unidentified']);

/** Identificador estavel de uma tecla: usa `code` (posicao fisica, igual em qualquer idioma) com Ctrl/Alt/Meta. Shift e ignorado ("+" = Shift+"="). */
export function keyBinding(e) {
  if (e.key !== 'Unidentified' && MODIFIER_KEYS.has(e.key) && (!e.code || /^(Shift|Control|Alt|Meta|Caps|Num|Scroll)/.test(e.code))) return null;
  let base = e.code && e.code !== 'Unidentified' ? e.code : (e.key && e.key !== 'Unidentified' ? e.key : '');
  if (!base && e.keyCode) base = `KeyCode${e.keyCode}`; // Android/WebView: alguns pedais so informam o numero da tecla
  if (!base || MODIFIER_KEYS.has(base)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean);
  return `k:${[...mods, base].join('+')}`;
}

/** Identificador de uma mensagem MIDI (canal ignorado, para servir a qualquer pedal). So conta o "pisar". */
export function midiBinding(data) {
  if (!data || data.length < 2) return null;
  const type = data[0] & 0xf0;
  const d1 = data[1], d2 = data[2] ?? 0;
  if (type === 0x90 && d2 > 0) return `m:note:${d1}`; // nota ligada (velocity 0 = desligada)
  if (type === 0xb0 && d2 > 0) return `m:cc:${d1}`; // controle (valor 0 = soltar)
  if (type === 0xc0) return `m:pc:${d1}`; // troca de programa
  return null; // relogio, active sensing, pitch bend, soltar etc.
}

const KEY_LABELS = {
  ArrowRight: 'Seta →', ArrowLeft: 'Seta ←', ArrowUp: 'Seta ↑', ArrowDown: 'Seta ↓', PageDown: 'Page Down', PageUp: 'Page Up',
  Space: 'Espaço', Enter: 'Enter', NumpadEnter: 'Enter (num)', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', Home: 'Home', End: 'End',
  Equal: '= / +', Minus: '-', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  MediaTrackNext: 'Mídia ▶▶', MediaTrackPrevious: 'Mídia ◀◀', MediaPlayPause: 'Mídia ▶/❚❚', AudioVolumeUp: 'Volume +', AudioVolumeDown: 'Volume -',
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\',
};

export function labelFor(binding) {
  const [kind, ...rest] = binding.split(':');
  const val = rest.join(':');
  if (kind === 'm') {
    const [t, n] = val.split(':');
    return `MIDI ${t === 'note' ? 'nota' : t === 'cc' ? 'controle' : 'programa'} ${n}`;
  }
  return val.split('+').map((p) => KEY_LABELS[p] ?? p.replace(/^KeyCode(\d+)$/, 'Tecla nº $1').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'Num $1').replace(/^F(\d+)$/, 'F$1')).join(' + ');
}

/**
 * Classifica um gesto de toque (dx/dy em px): "tap" ou "swipe" com a direcao do movimento dos dedos.
 * Alguns pedais viram-pagina (ex.: modo retrato/paisagem) nao digitam teclas: eles "tocam" ou "deslizam" na tela.
 */
export function classifyGesture(dx, dy, min = 40) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < min && ay < min) return { kind: 'tap' };
  if (ax >= ay) return { kind: 'swipe', dir: dx < 0 ? 'left' : 'right' };
  return { kind: 'swipe', dir: dy < 0 ? 'up' : 'down' };
}

/** Qual acao esta ligada a esse botao (ou null). */
export function resolveAction(bindings, id) {
  if (!id) return null;
  for (const a of ACTIONS) if (bindings[a.id]?.includes(id)) return a.id;
  return null;
}

/** Atribui o botao a uma acao, tirando-o de qualquer outra (um botao = uma acao). */
export function assignBinding(bindings, action, id) {
  const next = {};
  for (const a of ACTIONS) next[a.id] = (bindings[a.id] ?? []).filter((b) => b !== id);
  next[action] = [...next[action], id];
  return next;
}

/** Anti-repeticao: aceita a mesma acao no maximo uma vez por `ms`. */
export function makeThrottle(ms, now = () => Date.now()) {
  const last = new Map();
  return (key) => {
    const t = now();
    if (ms > 0 && t - (last.get(key) ?? -Infinity) < ms) return false;
    last.set(key, t);
    return true;
  };
}

/** Acesso ao Web MIDI (Chrome/Edge/Android). Pedais Bluetooth MIDI pareados no sistema aparecem como entradas. */
export function createMidiHub() {
  let access = null, starting = null;
  const subs = new Set();
  const onMsg = (e) => { for (const f of subs) f(e.data); };
  const attach = () => { for (const input of access.inputs.values()) input.onmidimessage = onMsg; };
  return {
    supported: () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function',
    async subscribe(fn) {
      if (!this.supported()) throw new Error('Este navegador não oferece MIDI (use Chrome ou Edge).');
      subs.add(fn);
      try {
        starting ??= navigator.requestMIDIAccess().then((a) => { access = a; a.onstatechange = attach; attach(); return a; });
        await starting;
      } catch (e) { subs.delete(fn); starting = null; throw new Error('Permissão de MIDI negada ou indisponível.'); }
      return () => subs.delete(fn);
    },
    devices: () => (access ? [...access.inputs.values()].map((i) => i.name) : []),
  };
}
