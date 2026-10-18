// Tema claro/escuro: preferencia 'auto' (segue o aparelho), 'light' ou 'dark'. Guardada fora do objeto de configuracoes
// para poder ser aplicada antes do app carregar (ver o script no <head> de index.html) e evitar o "piscar" de tema.

export const THEMES = ['auto', 'light', 'dark'];
const KEY = 'tc_theme';

export const normalizeTheme = (v) => (THEMES.includes(v) ? v : 'auto');

/** Tema efetivo: a preferencia, ou o do aparelho quando 'auto'. */
export const resolveTheme = (pref, systemDark) => (pref === 'dark' || pref === 'light' ? pref : systemDark ? 'dark' : 'light');

export function readTheme() {
  try { return normalizeTheme(localStorage.getItem(KEY)); } catch { return 'auto'; }
}

export const systemPrefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Aplica a preferencia: 'auto' remove o atributo (o CSS segue o aparelho); ajusta a cor da barra do navegador. */
export function applyThemePref(pref, root = document.documentElement) {
  const p = normalizeTheme(pref);
  if (p === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolveTheme(p, systemPrefersDark()) === 'dark' ? '#0b0f14' : '#1f2933');
}

export function saveTheme(pref) {
  const p = normalizeTheme(pref);
  try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* modo privado: vale so nesta sessao */ }
  applyThemePref(p);
  return p;
}

/** Botao rapido: alterna entre claro e escuro (a partir do tema efetivo). */
export function toggleTheme() {
  const now = resolveTheme(readTheme(), systemPrefersDark());
  return saveTheme(now === 'dark' ? 'light' : 'dark');
}

/** Chama fn quando o aparelho muda de tema (so importa em 'auto'). */
export function onSystemThemeChange(fn) {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (readTheme() === 'auto') { applyThemePref('auto'); fn(); } });
}
