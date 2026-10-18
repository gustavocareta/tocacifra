// Acesso a dados via Supabase (login, banco Postgres com RLS e arquivos de audio). Mesma interface do backend Node.
import { OfflineError } from './errors.js';
import { importFromText } from './importer-core.js';

const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac']);
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

/** Falha de rede (sem internet / servidor inacessivel), e nao um erro de negocio. */
export function isNetworkError(e) {
  if (!e) return false;
  if (e.name === 'AuthRetryableFetchError' || e.name === 'FunctionsFetchError' || e instanceof TypeError) return true;
  const msg = String(e.message ?? e);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg);
}

/** Mensagem em portugues para erros comuns do Supabase (Auth, Postgres, Storage). */
export function translateError(e, fallback = 'Algo deu errado. Tente novamente.') {
  const msg = String(e?.message ?? '');
  const code = String(e?.code ?? '');
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme o seu e-mail (veja a caixa de entrada e o spam) antes de entrar.';
  if (/already registered|already been registered|user_already_exists/i.test(msg + code)) return 'Este e-mail ja esta cadastrado.';
  if (/signups? (not allowed|are disabled|disabled)|signup_disabled/i.test(msg + code)) return 'Novos cadastros estao desativados neste site.';
  if (/rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit/i.test(msg + code)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  if (/password should be at least|weak_password/i.test(msg + code)) return 'A senha deve ter pelo menos 6 caracteres.';
  if (/valid email|email_address_invalid|invalid format/i.test(msg + code)) return 'E-mail invalido.';
  if (/same_password/i.test(code) || /should be different from the old password/i.test(msg)) return 'A nova senha deve ser diferente da anterior.';
  if (code === 'PGRST116') return 'Item nao encontrado.';
  if (code === '23514') return 'Dados invalidos (confira os tamanhos dos campos).';
  if (code === '42501') return 'Sem permissao para esta operacao.';
  if (code === '22023' || code === 'P0002') return msg || fallback; // mensagens em portugues levantadas pelas funcoes do banco
  if (/payload too large|exceeded the maximum allowed size/i.test(msg)) return 'O arquivo e maior que o limite permitido (30 MB).';
  return fallback;
}

const toSong = (r) => ({
  id: r.id, title: r.title, artist: r.artist, tone: r.tone, capo: r.capo, style: r.style, body: r.body,
  updatedAt: Date.parse(r.updated_at), audioName: r.audio_name ?? null,
});

/** `deps.client` permite injetar um cliente de teste (sem rede). */
export async function createSupabaseBackend(cfg, deps = {}) {
  const redirectTo = cfg.siteUrl || `${location.origin}${location.pathname}`;
  const sb = deps.client ?? (await import('./vendor/supabase.js')).createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tc-sb-auth' },
  });

  const self = {
    kind: 'supabase',
    capabilities: { importUrl: true, passwordReset: true },
    onAuthLost() {},
    onPasswordRecovery() {},
  };

  const toUser = (u) => (u ? { nick: u.user_metadata?.nick || u.email?.split('@')[0] || '', email: u.email } : null);
  const fail = (e, fallback) => {
    if (isNetworkError(e)) throw new OfflineError('Sem conexao com o servidor.');
    throw new Error(translateError(e, fallback));
  };
  const userId = async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('Sessao expirada. Entre novamente.');
    return data.session.user.id;
  };
  /** Executa uma consulta do banco; devolve data ou lanca OfflineError/Error em portugues. */
  const run = async (query, fallback) => {
    let res;
    try { res = await query; } catch (e) { fail(e, fallback); }
    if (res.error) {
      if (res.status === 401 || /jwt expired|invalid jwt/i.test(res.error.message ?? '')) { self.onAuthLost(); throw new Error('Sessao expirada. Entre novamente.'); }
      fail(res.error, fallback);
    }
    return res.data;
  };

  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') self.onPasswordRecovery();
    else if (event === 'SIGNED_OUT') self.onAuthLost();
  });

  Object.assign(self, {
    /** Restaura a sessao salva. offline=true quando nao foi possivel confirmar (sem internet). */
    async init() {
      try {
        const { data, error } = await sb.auth.getSession();
        if (error) return { user: null, offline: isNetworkError(error) };
        return { user: toUser(data.session?.user), offline: false };
      } catch (e) {
        return { user: null, offline: isNetworkError(e) };
      }
    },

    async signUp({ nick, email, password }) {
      let res;
      try { res = await sb.auth.signUp({ email: email.trim(), password, options: { data: { nick: nick.trim() }, emailRedirectTo: redirectTo } }); } catch (e) { fail(e); }
      if (res.error) fail(res.error, 'Nao foi possivel criar a conta.');
      if (!res.data.session) return { needsConfirmation: true }; // projeto exige confirmar o e-mail
      return { user: toUser(res.data.user) };
    },
    async signIn({ email, password }) {
      let res;
      try { res = await sb.auth.signInWithPassword({ email: email.trim(), password }); } catch (e) { fail(e); }
      if (res.error) fail(res.error, 'Nao foi possivel entrar.');
      return { user: toUser(res.data.user) };
    },
    async signOut() {
      try { await sb.auth.signOut({ scope: 'local' }); } catch { /* sem rede: a sessao local ja foi removida */ }
    },
    async requestPasswordReset(email) {
      let res;
      try { res = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo }); } catch (e) { fail(e); }
      if (res.error) fail(res.error, 'Nao foi possivel enviar o e-mail.');
    },
    async updatePassword(password) {
      let res;
      try { res = await sb.auth.updateUser({ password }); } catch (e) { fail(e); }
      if (res.error) fail(res.error, 'Nao foi possivel trocar a senha.');
    },

    async sync() {
      const d = await run(sb.rpc('sync_all'), 'Nao foi possivel baixar o conteudo.');
      return { at: Date.now(), songs: d.songs, setlists: d.setlists };
    },

    async putSong(id, body) {
      const row = {
        title: String(body.title ?? '').trim(), artist: String(body.artist ?? '').trim(), tone: String(body.tone ?? '').trim(),
        capo: Number(body.capo) || 0, style: String(body.style ?? '').trim(), body: String(body.body ?? ''),
      };
      if (!row.title) throw new Error('Informe o titulo.');
      const q = id == null ? sb.from('songs').insert(row) : sb.from('songs').update(row).eq('id', id);
      let res;
      try { res = await q.select().single(); } catch (e) { fail(e, 'Nao foi possivel salvar a musica.'); }
      if (res.error?.code === 'PGRST116') throw new Error('Musica nao encontrada.');
      if (res.error) {
        if (res.status === 401) { self.onAuthLost(); throw new Error('Sessao expirada. Entre novamente.'); }
        fail(res.error, 'Nao foi possivel salvar a musica.');
      }
      return toSong(res.data);
    },
    async deleteSong(id) {
      const uid = await userId();
      await run(sb.from('songs').delete().eq('id', id), 'Nao foi possivel excluir a musica.');
      sb.storage.from('audio').remove([`${uid}/${id}`]).catch(() => {}); // audio, se houver (sem erro se nao existir)
      return null;
    },

    async putSetlist(id, body) {
      const items = (body.items ?? []).map((i) => (i.songId != null ? { songId: i.songId } : { label: i.label }));
      return run(sb.rpc('save_setlist', { p_id: id, p_title: body.title ?? '', p_style: body.style ?? '', p_items: items }), 'Nao foi possivel salvar o repertorio.');
    },
    async deleteSetlist(id) {
      await run(sb.from('setlists').delete().eq('id', id), 'Nao foi possivel excluir o repertorio.');
      return null;
    },

    async uploadAudio(songId, file) {
      if (!AUDIO_TYPES.has((file.type || '').toLowerCase())) throw new Error('Formato de audio nao suportado (use mp3, m4a, ogg, wav ou flac).');
      if (file.size > MAX_AUDIO_BYTES) throw new Error('O audio deve ter no maximo 30 MB.');
      const uid = await userId();
      const up = await sb.storage.from('audio').upload(`${uid}/${songId}`, file, { upsert: true, contentType: file.type });
      if (up.error) fail(up.error, 'Falha no envio do audio.');
      const audioName = (file.name || 'audio').replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 100) || 'audio';
      await run(sb.from('songs').update({ audio_name: audioName }).eq('id', songId), 'Nao foi possivel registrar o audio.');
      return { audioName };
    },
    async deleteAudio(songId) {
      const uid = await userId();
      await sb.storage.from('audio').remove([`${uid}/${songId}`]);
      await run(sb.from('songs').update({ audio_name: null }).eq('id', songId), 'Nao foi possivel remover o audio.');
      return null;
    },
    async getAudioUrl(songId) {
      const uid = await userId();
      const res = await sb.storage.from('audio').download(`${uid}/${songId}`);
      if (res.error) fail(res.error, 'Audio indisponivel.');
      return URL.createObjectURL(res.data);
    },

    /** Importa uma cifra: por link (funcao "import-cifra" do Supabase baixa a pagina) ou por texto colado. */
    async importContent({ url, text }) {
      if (!url) return importFromText(text ?? '');
      let res;
      try { res = await sb.functions.invoke('import-cifra', { body: { url } }); } catch (e) { fail(e, 'Nao foi possivel importar o link.'); }
      if (res.error) {
        if (isNetworkError(res.error)) throw new OfflineError('Sem conexao com o servidor.');
        const status = res.error.context?.status;
        let msg = '';
        try { msg = (await res.error.context.json())?.error ?? ''; } catch { /* sem corpo */ }
        if (status === 404) throw new Error('A importacao por link ainda nao foi ativada neste projeto. Copie o texto da cifra e cole aqui.');
        if (status === 401) { self.onAuthLost(); throw new Error('Sessao expirada. Entre novamente.'); }
        throw new Error(msg || 'Nao foi possivel importar o link. Copie o texto da cifra e cole aqui.');
      }
      const d = res.data ?? {};
      return importFromText(d.body ?? '', { title: d.title, artist: d.artist });
    },
  });
  return self;
}
