// Acesso a dados via servidor Node proprio (server/index.ts). Mesma interface do backend Supabase.
import { OfflineError } from './errors.js';

const TOKEN_KEY = 'tc_token';
const USER_KEY = 'tc_user';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* modo privado */ } };

export function createNodeBackend() {
  const self = {
    kind: 'node',
    capabilities: { importUrl: true, passwordReset: false },
    onAuthLost() {}, // o app define: chamado quando o servidor recusa a sessao (401)
    onPasswordRecovery() {},

    async api(path, { method = 'GET', body } = {}) {
      const token = read(TOKEN_KEY);
      let res;
      try {
        res = await fetch(path, {
          method,
          headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new OfflineError('Sem conexao com o servidor.');
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token) { self.onAuthLost(); throw new Error(data.error ?? 'Sessao expirada.'); }
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      return data;
    },

    async init() {
      const token = read(TOKEN_KEY);
      let user = null;
      try { user = JSON.parse(read(USER_KEY) ?? 'null'); } catch { /* ignore */ }
      return { user: token ? user : null, offline: false };
    },
    async signUp({ nick, email, password }) {
      const r = await self.api('/api/register', { method: 'POST', body: { nick, email, password } });
      write(TOKEN_KEY, r.token);
      return { user: r.user, token: r.token };
    },
    async signIn({ email, password }) {
      const r = await self.api('/api/login', { method: 'POST', body: { email, password } });
      write(TOKEN_KEY, r.token);
      return { user: r.user, token: r.token };
    },
    async signOut() { write(TOKEN_KEY, null); },
    async requestPasswordReset() { throw new Error('Recuperacao de senha nao esta disponivel neste servidor.'); },
    async updatePassword() { throw new Error('Recuperacao de senha nao esta disponivel neste servidor.'); },

    sync: () => self.api('/api/sync'),
    putSong: (id, body) => self.api(id == null ? '/api/songs' : `/api/songs/${id}`, { method: id == null ? 'POST' : 'PUT', body }),
    deleteSong: (id) => self.api(`/api/songs/${id}`, { method: 'DELETE' }),
    putSetlist: (id, body) => self.api(id == null ? '/api/setlists' : `/api/setlists/${id}`, { method: id == null ? 'POST' : 'PUT', body }),
    deleteSetlist: (id) => self.api(`/api/setlists/${id}`, { method: 'DELETE' }),

    async uploadAudio(songId, file) {
      let res;
      try {
        res = await fetch(`/api/songs/${songId}/audio`, { method: 'PUT', headers: { authorization: `Bearer ${read(TOKEN_KEY)}`, 'content-type': file.type || 'audio/mpeg', 'x-filename': encodeURIComponent(file.name) }, body: file });
      } catch { throw new OfflineError('Sem conexao com o servidor.'); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Falha no envio.');
      return { audioName: j.audioName };
    },
    deleteAudio: (songId) => self.api(`/api/songs/${songId}/audio`, { method: 'DELETE' }),
    /** URL temporaria (blob:) do audio; quem chama deve liberar com URL.revokeObjectURL. */
    async getAudioUrl(songId) {
      let res;
      try { res = await fetch(`/api/songs/${songId}/audio`, { headers: { authorization: `Bearer ${read(TOKEN_KEY)}` } }); } catch { throw new OfflineError('Sem conexao.'); }
      if (!res.ok) throw new Error('Audio indisponivel.');
      return URL.createObjectURL(await res.blob());
    },

    importContent: ({ url, text }) => self.api('/api/import', { method: 'POST', body: url ? { url } : { text } }),
  };
  return self;
}
