# TocaCifra online — guia para quem nunca usou GitHub nem Supabase

O app roda de graça na internet com duas peças:

| Peça | Para que serve | Endereço |
|---|---|---|
| **GitHub Pages** | Guarda e mostra o site/app (as telas) | `https://gustavocareta.github.io/tocacifra/` |
| **Supabase** | Guarda as suas músicas, repertórios, áudios e o login | projeto `tocacifra` (São Paulo) |

Você não precisa mexer em código. Este guia explica só o que é seu.

---

## 1. Instalar no celular

### Android — aplicativo de verdade (APK)

1. No celular, abra **https://github.com/gustavocareta/tocacifra/releases/tag/android-latest** (ou aponte a câmera para o QR `QR-Baixar-App-Android.png`).
2. Toque em **TocaCifra.apk** para baixar.
3. Abra o arquivo baixado. Se o Android avisar "bloqueado por segurança", toque em **Configurações** e ative **Permitir desta fonte** (é só para este navegador). Volte e toque em **Instalar**.
4. Se o Play Protect disser "app não verificado", toque em **Instalar mesmo assim**: o app é seu e não está na loja.
5. Abra o **TocaCifra**, entre com o seu e-mail e senha e, no menu, toque em **Conteúdo** (com Wi-Fi) para baixar as músicas.

Atualizações: o GitHub gera um APK novo sempre que o app muda. Baixe de novo o mesmo arquivo e instale por cima; se o Android recusar, desinstale o antigo antes (suas músicas ficam na sua conta).

### iPhone / iPad — instalável pelo Safari (sem custo)

1. Abra **https://gustavocareta.github.io/tocacifra/** no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta para cima) → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra sempre pelo ícone. No menu, toque em **Conteúdo** (com Wi-Fi) para baixar as músicas.

Um app nativo na App Store exige conta de desenvolvedor da Apple (paga); por isso, no iPhone, usamos esta instalação pelo Safari.

## 2. Criar a sua conta

Se ainda não tiver conta, toque em **"Criar uma conta"**, escolha nick, e-mail e senha (mínimo 6 caracteres).
Use um e-mail seu: é por ele que você recupera a senha ("Esqueci a minha senha").

> Depois de criar a **sua** conta, desligue os novos cadastros (passo 4) para ninguém mais criar conta no seu site.

## 3. Passar as suas músicas

No computador, abra o app, vá em **Músicas → Nova** (ou **Importar**) e cadastre. Tudo fica salvo no Supabase e
aparece no celular ao tocar em **Baixar conteúdo offline**.

## 4. Configurações do Supabase que SÓ VOCÊ pode fazer (uma vez)

Entre em <https://supabase.com/dashboard> → projeto **tocacifra**.

1. **Cadastro sem confirmação de e-mail** (recomendado, deixa o cadastro imediato):
   `Authentication` → `Sign In / Providers` → desligue **Confirm email** → **Save changes**.
2. **Endereço do site (necessário para "Esqueci a minha senha")**:
   `Authentication` → `URL Configuration` →
   - **Site URL:** `https://gustavocareta.github.io/tocacifra/`
   - **Redirect URLs** → *Add URL* → `https://gustavocareta.github.io/tocacifra/` → **Save**.
3. **Depois de criar a sua conta**, desligue novos cadastros:
   `Authentication` → `Sign In / Providers` → desligue **Allow new users to sign up** → **Save changes**.
   (Para convidar alguém depois, ligue de novo por um momento.)

## 5. Limites do plano grátis (conferidos em outubro/2026)

- Supabase: 500 MB de banco, **1 GB de arquivos (áudios)**, 50 mil usuários ativos/mês.
- O Supabase **pausa projetos sem uso por 1 semana**. Já existe um aviso automático (GitHub Actions, a cada 3 dias)
  que evita isso. Se um dia o app disser que não consegue conectar: entre no painel do Supabase e clique em **Restore project**.
- O GitHub desativa avisos agendados se o repositório ficar **60 dias sem nenhuma alteração**; se isso acontecer, é só
  ir em `Actions` e reativar.
- Áudios não ficam offline (só os textos e cifras). O e-mail de "esqueci a senha" usa o envio padrão do Supabase,
  que tem limite baixo de mensagens por hora (suficiente para uso pessoal).

## 6. Segurança (resumo)

- No código só existe a chave **pública** (`sb_publishable_...`). Ela é feita para ficar no navegador: sozinha não abre nada.
- Cada pessoa só enxerga os **próprios** dados: regras de segurança por linha (RLS) no banco e por pasta nos áudios.
- **Nunca** cole em lugar nenhum a chave `secret` / `service_role` do Supabase nem a senha do banco.

## 7. Para o desenvolvedor

- `supabase/schema.sql`: tabelas, regras e funções (já aplicado no projeto).
- `public/config.js`: endereço e chave pública do Supabase.
- Publicação automática: cada alteração na branch `main` publica a pasta `public/` (`.github/workflows/pages.yml`) e gera o APK Android (`.github/workflows/android.yml`).
- Importar por link: Edge Function `supabase/functions/import-cifra` (já publicada no projeto; "Verify JWT" desligado, a função confere o login).
- Local: `npm start` usa um servidor Node próprio (banco SQLite) — útil para desenvolver (`/config.js` muda para `backend: 'node'`).
