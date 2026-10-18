// Configuracao da versao publicada (GitHub Pages + Supabase).
// Estes valores sao PUBLICOS por desenho: a chave "publishable" so funciona junto com as regras de seguranca (RLS) do banco.
// NUNCA coloque aqui a chave "secret" / "service_role".
// No desenvolvimento local, o servidor Node responde /config.js com backend 'node' (ver server/index.ts).
export const CONFIG = {
  backend: 'supabase',
  supabaseUrl: 'https://ywmfmsrczwfcimhjqiqh.supabase.co',
  supabaseAnonKey: 'sb_publishable_6nlz7mBfr2c6-EtX47Ycyw_hbEtQF9C',
  siteUrl: 'https://gustavocareta.github.io/tocacifra/', // para onde o e-mail de "esqueci a senha" leva
};
