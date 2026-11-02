# Proposta: prévia de escores com observações remotas revisadas

Status: primeiro incremento autorizado pela solicitação de evolução da engine;
implementação e limites registrados em [clinical-engine-plan.md](clinical-engine-plan.md).
O corpo abaixo preserva a proposta histórica. A decisão vigente usa cálculo novo
isolado e versionado; não chama o motor legado. CG numérico sintético exige snapshot
consistente, correções resolvidas e revisão de todas as entradas necessárias.
Escopo: branch `develop/osler-secure-foundation`, projeto de desenvolvimento
`otnwkxchugsovtjdanyu`, contas e dados exclusivamente sintéticos.

## Situação observada no código

`score-ui.js` lê notas e correções de `draft()`, organiza resultados por
`currentBed` e também preenche campos usados por nutrição, anticoagulação e
passagem de plantão. Chamar `updateAutoScores()` com dados remotos misturaria
esses contextos e produziria efeitos fora do painel remoto.

`remote-session.js` mantém unidade, episódio e observações separados, sem
consultar rascunhos. `ClinicalScores.calculate()` recebe dados estruturados,
mas suas entradas atuais contêm basicamente valor, origem textual e erro:
não verificam a identidade do episódio, a completude da consulta ou os horários
dos eventos. As flags de janela temporal não são prova desses requisitos.

O histórico remoto retorna até 100 registros. A ausência de um evento nessa
página não demonstra ausência no período nem permite escolher extremos de uma
janela completa. O esquema remoto atual também não oferece todos os campos
necessários para completar os cinco cálculos existentes.

## Primeiro incremento recomendado

Adicionar uma **prévia remota independente**, somente de leitura, dentro do
painel remoto. Não alimentar os cartões locais nem seus campos derivados.
O fluxo proposto é:

1. O usuário escolhe explicitamente unidade e episódio remoto. A tela mostra
   ambos os IDs e o intervalo de avaliação; número de leito é apenas um rótulo.
2. Uma ação **Preparar prévia de escores** consulta os eventos autorizados desse
   episódio. Apenas eventos confirmados, válidos e mapeáveis viram candidatos;
   consulta incompleta é indicada e impede qualquer alegação de janela completa.
3. A tela apresenta candidatos por campo: valor original, unidade, horário da
   medição, horário de criação, origem, autor e ID do evento. Nada vem marcado
   como escolhido. Múltiplas medidas exigem seleção explícita; não se aplica
   silenciosamente a regra de usar o último registro.
4. O usuário revisa e confirma um conjunto. Um adaptador puro valida esse conjunto
   e monta uma entrada estruturada para `ClinicalScores.calculate()`, sem passar
   pela extração de texto e sem chamar `updateAutoScores()`.
5. O resultado aparece somente na prévia remota, com campos ausentes e critérios
   ainda não demonstrados como pendências. Valores incompletos não são publicados
   como escores finais. Com os campos atuais, é esperado que cálculos permaneçam
   pendentes; não se completam dados a partir do leito local.

No primeiro incremento não haverá persistência do resultado, edição de eventos,
sincronização com rascunhos, preenchimento de outros painéis ou criação de novos
campos clínicos no banco. A prévia permanecerá em memória.

## Rastreabilidade e regras de invalidação

Cada conjunto confirmado terá um ID próprio, versão do adaptador/motor, instante
da consulta e confirmação, usuário revisor, unidade, episódio e período escolhido.
Cada entrada manterá os IDs dos eventos usados, valores/unidades originais e
eventuais conversões explícitas versionadas. Dados derivados referenciarão todos
os eventos de origem, não uma string genérica como "Supabase".

O motor poderá ser reutilizado para cálculo, mas a proveniência ficará em um
objeto separado do resultado e associado ao conjunto confirmado. O adaptador
fará validação de tipo, finitude, unidade e faixa tanto do evento quanto do campo
de destino; divergências não serão convertidas ou corrigidas silenciosamente.

Trocar unidade/episódio, sair, expirar a sessão ou perder acesso invalida a prévia.
Respostas assíncronas de um contexto anterior são descartadas. Uma atualização
do histórico sinaliza que há dados novos e exige nova revisão para recalcular;
não substitui a seleção nem o resultado já mostrado automaticamente. Recalcular
é sempre uma ação explícita e produz outro conjunto de entrada.

O número de leito local e `currentBed` nunca são chaves desse conjunto. Dois
episódios no mesmo leito, ou leitos iguais em unidades distintas, continuam
separados por UUID. Nenhum campo é copiado de `draft()`, `scoreOverrides` ou
`scoreMerged` para suprir faltantes.

## Limites temporais e de cobertura

Evento confirmado significa que a observação foi revisada; não confirma sua
adequação ao escore nem a cobertura do período. O usuário deverá confirmar essa
adequação separadamente. `started_at` do episódio não será interpretado como
horário de admissão na UTI sem um dado explícito que estabeleça essa relação.

O primeiro incremento não marcará `sapsWindow` ou `sofaWindow` automaticamente.
Esses cálculos continuarão pendentes enquanto faltar a representação e validação
da janela correspondente e sua cobertura, mesmo que existam medidas numéricas.
Antes de liberar seleção automática de extremos será necessário especificar
paginação/consulta completa por período e revisar as regras clínicas existentes.

Pares de medidas para valores derivados também precisarão de compatibilidade
temporal e contextual explicitamente definida. Não se pareiam PaO₂ e FiO₂ apenas
porque pertencem ao mesmo episódio. Campos demográficos, condições clínicas,
suporte e outras informações não disponíveis no esquema remoto permanecem
ausentes; qualquer futura entrada suplementar exigirá origem e revisão próprias.

## Critérios de aceite da implementação futura

- Selecionar eventos e gerar prévia não altera IndexedDB, escores locais,
  nutrição, anticoagulação, notas ou passagem de plantão.
- Não há seleção, importação, conversão ou recálculo silenciosos.
- Cada entrada e cada derivação pode ser rastreada ao evento e ao contexto remoto.
- Mesmos leitos em unidades distintas e episódios sucessivos não compartilham
  entradas. Troca de contexto durante uma consulta não aceita resposta atrasada.
- Falta de permissão, sessão expirada, consulta truncada, campo ausente, unidade
  incompatível, valor conflitante ou janela não demonstrada não produzem um
  resultado completo enganoso.
- Testes usam casos sintéticos conhecidos e verificam ausência de efeitos locais,
  isolamento, proveniência, invalidação e conservação das fórmulas existentes.
- O teste em navegador demonstra seleção e confirmação explícitas, além de
  manter os rascunhos locais intactos.

Decisão proposta: aprovar primeiro esse incremento de prévia independente.
Persistir resultados, preencher escores locais ou automatizar seleção temporal
seriam mudanças posteriores, com proposta e critérios próprios.
