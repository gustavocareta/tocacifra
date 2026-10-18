# TocaCifra

Organizador de cifras e repertorios: um site para cadastrar e um app (PWA) que baixa tudo e funciona sem internet.
Projeto proprio, inspirado no *tipo* de ferramenta (cifras + repertorios + painel de palco); nao usa codigo, marca nem conteudo de terceiros.

> Versao online (GitHub Pages + Supabase): veja **COMO-PUBLICAR.md**. Em `public/config.js` fica o endereco/chave publica do Supabase; `supabase/schema.sql` cria o banco.

## Rodar

Requer Node 24+ (usa `node:sqlite` e execucao direta de TypeScript, sem build).

```bash
npm install
npm start          # http://localhost:3000
npm test           # 38 testes (cifras, secoes, pedais, acordes, afinador, API, importacao, audio, limite de login)
npm run check      # tipagem (tsc)
```

Variaveis: `PORT`, `HOST` (padrao 127.0.0.1), `DB_PATH`, `SECRET`, `LOGIN_MAX_FAILS` (8 por 15 min), `REGISTER_MAX` (10 por hora).
Os dados ficam em `data/` (banco SQLite, audios e segredo de assinatura) — nao versionar.

## Usar no celular com pedal Bluetooth

1. No computador: `npm run start:lan` (mostra os enderecos, ex.: `http://192.168.1.145:3000`). Use so em Wi-Fi de confianca.
2. No celular (mesmo Wi-Fi): abra esse endereco no Chrome (Android) ou Safari (iPhone/iPad) e entre na conta.
3. Pareie o pedal em Ajustes > Bluetooth do celular (o pareamento e do sistema, nao do app).
4. No app: Configuracoes > Pedal > "Aprender" em cada acao e pise no botao. "Testar pedal" confere.
5. Abra a musica: o pedal vira as paginas. A tela fica ligada durante a musica (opcao em Configuracoes) e ha botao de tela cheia.

Sem HTTPS (endereco `http://192...`), o navegador do celular nao libera modo offline nem microfone (afinador); o pedal funciona normalmente.
Para offline e afinador no celular, publique o app atras de HTTPS.

## O que existe

- Contas (e-mail + senha com scrypt, token assinado) com limite de tentativas de login por IP e por e-mail.
- Musicas: editor com destaque de acordes, transposicao, tom, capotraste, estilo.
- Modo escuro: Automatico (segue o aparelho), Claro ou Escuro, em Configuracoes e no botao do topo; vale para o site e o app.
- Filtros por artista e por estilo (com contagem), busca sem acento e clique no nome do artista; no repertorio, "Adicionar todas" as musicas do filtro.
- Acordes desenhados (violao, cavaquinho, ukulele; destro/canhoto), gerados por busca — sem tabela fixa.
- Repertorios: ordem, "momentos" (etiquetas), ate 300 itens.
- Importar cifra: botao "Colar da area de transferencia e importar" (link da pagina ou texto copiado), ou colando nos campos; sempre **uma** musica por vez, para uso pessoal (o servidor bloqueia enderecos internos). Nao ha busca automatica em sites de cifras.
- Painel de palco: fundo preto, acordes coloridos, 2 colunas, paginacao/rolagem por toque, teclado
  (setas, `+`/`-`, `*` tom original, `F4` busca, espaco rolagem automatica, `Esc` sair), fonte, acordes desenhados.
- Refrao e 2a voz em outra cor: no editor, selecione as linhas e use os botoes "Refrao" / "2a Voz" (inserem `{refrao}`...`{/refrao}`,
  que nao aparecem na exibicao). As cores (letra e cifra do refrao, letra da 2a voz) sao escolhidas em Configuracoes,
  onde tambem ha a chave "Usar cores diferentes no refrao e na 2a voz" (desligada, tudo fica na cor normal).
- Pedais (qualquer marca): Configuracoes > Pedal. Pedais Bluetooth comuns sao teclados (HID): "Aprender" grava o botao que voce pisar
  para cada acao (proxima, anterior, tom +/-, tom original, rolagem, busca). Tambem aceita pedal MIDI (Web MIDI; Chrome/Edge/Android),
  com "Testar pedal" e anti-repeticao ajustavel (0-1000 ms) para pedais que disparam duas vezes.
  Chave geral "Usar pedal para virar as paginas": desligada, so o toque na tela vira (os botoes aprendidos ficam guardados).
- Audio por musica (ate 30 MB) com player e velocidade 0,5x a 1,5x (precisa de internet).
- Afinador por microfone (cromatico, violao, cavaquinho, ukulele, baixo), funciona offline.
- Offline: "Baixar conteudo offline" guarda tudo; edicoes feitas sem internet entram numa fila e sincronizam sozinhas.
  Itens criados offline recebem id provisorio e os vinculos (musica em repertorio) sao remapeados na sincronizacao.

## Limites conhecidos

- Conflitos: vale a ultima edicao (se o mesmo item for editado em dois aparelhos offline, a que sincronizar por ultimo vence).
- Dados offline no `localStorage` (cerca de 5 MB); bibliotecas muito grandes pedem IndexedDB. Audio nao fica offline.
- Service worker e microfone exigem HTTPS (ou localhost): para usar no celular, publique atras de HTTPS.
- Pedais: o pareamento Bluetooth e feito no sistema (Windows/Android/iOS), nao no app. Web MIDI nao existe no Safari/iOS; la so funcionam
  pedais que "digitam". Pedais que mandam apenas teclas de midia podem ser interceptados pelo sistema antes de chegar ao navegador.
- Falta: recuperacao de senha (precisa de provedor de e-mail), grupos, cardapio musical, APK e instalador Windows.

