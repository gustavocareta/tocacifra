# Paridade com o ToqueFácil (levantamento por engenharia reversa de recursos)

Fonte: telas e textos do app Android (v7.0 legado) e do software Desktop (v5.1.0), páginas públicas do site e
descrição da Play Store. Só **funcionalidades** foram levantadas; o código e a marca do ToqueFácil não são copiados.

Legenda: ✅ tem · 🟡 parcial · ❌ falta

## Painel de visualização (palco)
| Recurso do ToqueFácil | TocaCifra |
|---|---|
| Virar página tocando na metade direita/esquerda da tela | ✅ (terços) |
| Menu de opções do painel | ✅ (folha de opções + barra inferior de botões redondos) |
| Tom + / − / original | ✅ |
| Afinador e áudio dentro do painel | 🟡 (áudio sim; afinador só em tela separada) |
| Cardápio Musical dentro do painel | ❌ |
| Barra superior: avançar/voltar uma música | 🟡 (só por tecla/pedal e busca) |
| **Incluir uma música provisoriamente** no repertório durante o show | ❌ |
| Busca local (no repertório) | ✅ |
| **Busca no site** (biblioteca inteira) a partir do painel | ❌ |
| Janela de instruções do painel ("não mostrar mais") | ✅ |
| Pedal / controle apenas por pedal | ✅ (qualquer marca) |

## Configurações
| Recurso | TocaCifra |
|---|---|
| Cores: fundo (9), letra, cifra, refrão, 2ª voz | ✅ (paleta livre) |
| Cores: **tablatura** e **anotação** | ❌ |
| Tipo de refrão: com marcador / destacado | ❌ |
| 5 tipos de fonte | ❌ |
| 7 tamanhos prontos (pequena → palco 2) | 🟡 (controle contínuo) |
| Exibir letra e cifras / **só a letra** | ❌ |
| **Letra centralizada** | ❌ |
| Letras em maiúsculo: não / sim / **só no refrão** | 🟡 (sim/não) |
| **Títulos** em maiúsculo | ❌ |
| Instrumento dos acordes (violão, cavaco/banjo, ukulele) + destro/canhoto | ✅ |
| Coluna de acordes exibir/ocultar | 🟡 |
| Confirmar saídas | ❌ |
| Modos: **Paginação**, **Rolagem controlada 1**, **Rolagem controlada 2** | 🟡 (paginação + rolagem simples) |
| Velocidade padrão (1–5) e "saltar para início/fim" | 🟡 |
| Controle de paginação (rápida/normal/devagar/1 página) | ❌ |
| **Travar o painel em retrato** | ❌ |
| **Faixa de referência** (guia de leitura) | ❌ |
| Barra de áudio sim/não | 🟡 |
| **Ajustes de resolução** (caracteres por linha / linhas por página, retrato e paisagem) | ❌ |
| **Idioma**: Português / English / Español | ❌ |
| Restaurar configurações / **Limpar conteúdo baixado** | 🟡 (restaurar sim; limpar não) |

## Músicas, repertórios e site
| Recurso | TocaCifra |
|---|---|
| Buscar por título/letra; **ordenar por título, artista ou tom** | ✅ (+ filtros por artista e estilo) |
| **Grupos** (compartilhar repertórios com a banda; "exibir músicas dos grupos") | ❌ |
| Repertórios com "momentos" | ✅ |
| Áudio por música com velocidade 0,5x–1,5x | ✅ |
| Capotraste, tablaturas, refrão e 2ª voz no editor | 🟡 (tablatura ❌) |
| Baixar conteúdo do site para o celular (offline) | ✅ |
| Buscar e **copiar músicas públicas** de outros usuários | ❌ |
| **Super Cardápio Musical** (público faz pedidos ao vivo, gorjetas; "últimos pedidos", atendidos/não atendidos) | ❌ |
| Afinador (violão, cavaco/banjo, ukulele, baixo) | ✅ |

## Plataforma
| Item | Situação |
|---|---|
| App Android instalável (APK) | ✅ gerado pelo GitHub (Releases > android-latest) |
| iPhone | ✅ instalável pelo Safari (sem custo); app nativo exigiria conta Apple paga |
| Layout pensado para celular | ✅ refeito no formato do ToqueFácil: menu inicial, listas em cartões, detalhe do repertório, painel e editor |
| Importar música no celular | ✅ texto colado e por link (função no Supabase); falta confirmar com login real |
