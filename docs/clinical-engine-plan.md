# Plano executável da engine — somente dados sintéticos

Prioridade atual (2026-11-02): engine integrada e controles técnicos necessários
à integração. Backups hospedados, MFA institucional e revisão independente
continuam bloqueios para dados reais; decisões externas não bloqueiam tarefas
independentes de desenvolvimento. Uma única execução trabalha nesta branch.

| Ordem | Tarefa | Aceite e estado |
| --- | --- | --- |
| 1 | Inventariar e versionar instrumentos/fontes | `clinical-catalog.js`: seis candidatos, fonte e nível de verificação explícitos; CG remoto, RASS/KDIGO parcial somente como núcleos isolados |
| 2 | Aplicabilidade e cálculo isolados | Inclusão/exclusão/abstenção explicadas; casos sintéticos derivados independentemente da fórmula original; sem imputação nem probabilidades |
| 3 | Prévia remota isolada | Seleção/revisão explícitas; autoria/IDs/unidades/horários; contexto validado pelo episódio autorizado; nenhuma escrita ou leitura de drafts; abstenção obrigatória enquanto faltam dados |
| 4 | Resolver correções e cobertura | Implementado/testado: snapshot único sob RLS, limites explícitos e abstenção por truncamento; cadeias, conflitos, fontes fora da janela e resposta atrasada tratados sem substituição automática |
| 5 | Entradas suplementares revisadas | Implementado/testado: idade/coeficiente, exclusões, estabilidade, peso e cobertura com autoria, instantes, origem e confirmação por item; CG numérico somente após revisão completa |
| 6 | SOFA original | Bloqueio concreto: acesso disponível não contém tabela integral; obter texto primário legalmente e resolver regras antes de novo núcleo/remoto; ver especificações |
| 7 | KDIGO/RASS | Núcleos isolados implementados/testados: RASS de exame explícito e KDIGO via creatinina parcial. Fronteira RASS 10 s e contrato de diurese/RRT pendentes; sem UI remota desses instrumentos |
| 8 | Modelos probabilísticos | Preparação executável ampliada: diagnóstico de calibração/splits sintéticos, sem treino ou runtime. Estudos clínicos e autorização externa continuam ausentes; registry sempre desabilitado |

Especificações, critérios e ações externas: [instrument-specifications.md](instrument-specifications.md).
As etapas técnicas independentes acima foram executadas. O restante exige acesso
primário do SOFA, decisões clínicas explícitas de protocolo/contrato ou estudos
institucionais; não preencher essas lacunas por convenções inventadas.

## Prioridade entregue: imagem sintética até a engine

O fluxo completo de arquivo/câmera → rotação/recorte → OCR local → revisão lado a
lado → unidade/episódio explícitos → persistência por campo → prévia foi integrado.
Ver [como abrir e experimentar](synthetic-image-workflow.md), incluindo limitações,
tipos efetivamente testados e distinção entre mocks e OCR/Auth/RPC reais.
O OCR legado foi preservado e reutiliza o mesmo helper local fixado. Não houve
upload remoto de imagens, preenchimento de horários ausentes, migração de drafts
ou remoção dos bloqueios de SOFA/RASS/KDIGO para demonstrar o fluxo.

Migração `20261102233142_document_observations.sql` aplicada após inspeção sem
vestígios parciais: evento e proveniência imutável por transação, RLS/MFA/função,
retry de payload idêntico e auditoria minimizada. Oito versões locais/remotas.
Hash dos 71 eventos anteriores preservado: `caf86e7a9770e6727939ebcaef7c2761`.
Fila em memória suporta confirmações parciais, verificação e retries sem novos IDs;
não sobrevive a reload/fechamento. A interface avisa essa limitação e não chama
ausência de comprovante de prova de falha. Encerrar recusados não apaga confirmados.

## Evidências atuais — continuidade de 2026-11-02

- Migração `20261102224140_engine_snapshot.sql` aplicada após inspeção do projeto,
  histórico e schema. Sete versões locais/remotas correspondem. Função STABLE,
  invoker, search_path vazio, anon sem EXECUTE; RLS e MFA existentes preservados.
- Antes da migração havia 44 eventos/37 episódios. Hash dos 44 eventos anteriores
  permaneceu `467eafc1831d92f3a0fe63c432427338` após migração e testes. As quatro
  unidades e duas exceções sintéticas continuam presentes. Registros novos de
  teste foram mantidos; somente episódios/fatores/perfis próprios foram limpos.
- Testes locais incluem correções lineares, ramos/ciclos, vínculo ausente, horário
  deslocado, truncamento, suplemento não revisado/fora de contexto, sessão expirada
  durante resposta, valores/unidades e origem inválidos. Nenhum assert foi relaxado.
  Resultado final: **66 testes aprovados, zero falhos/ignorados**; build de 20 ativos
  locais com inventário SHA-256 aprovado. A validação da matriz não libera dados reais.
- SQL local e restauração exercitam anon, AAL1, AAL2, leitor sem escrita, contextos
  cruzados, medição corrigida fora da janela, limite 1001/1000 e atributos da função.
- Teste hospedado `test-hosted-protected.js` passou com chamadas diretas à RPC:
  anônimo/AAL1/contexto cruzado negados, leitor/clínico/admin AAL2 autorizados;
  correção, auditoria, encerramento e revogação existentes passaram novamente.
- Chrome real passou com CG remoto sintético = 72 mL/min derivado independentemente,
  cadeia de duas correções, seleção explícita da folha, oito suplementos rastreáveis,
  exclusão por AKI, revisão invalidada ao alterar origem, descarte de resposta após
  mudança de intervalo e falha de consulta. Regressões anteriores de login/MFA,
  persistência/reload/novo login, isolamento, leitor, OCR/áudio e drafts passaram.
- Núcleos novos: RASS cobre os dez ordinais e abstenção em 10 s; KDIGO reproduz
  exemplos sintéticos A–E publicados e testa limites 48 h/7 dias, basal desconhecida,
  creatinina cronicamente alta, unidades e contexto. Não há validação clínica/diurese/RRT.
- Avaliação probabilística usa somente números artificiais fornecidos, sem previsão
  clínica: Brier/confiabilidade por aritmética independente e testes de horizonte,
  follow-up/censura e vazamento estrutural entre splits. Registry permanece desabilitado.
- Restauração local repetida: preparação 6701 ms, snapshot 194 ms,
  restauração/verificação 3255 ms, zero registros comprometidos antes da cópia
  perdidos. Esses tempos não representam recuperação hospedada ou RPO/RTO clínico.
- CI do commit de implementação `8cf7851512a3920da19cac891bc973cad08421f8`:
  jobs `test` e `database` concluídos com sucesso na
  [execução 41541365643](https://github.com/lmaximo123/icu_mind/actions/runs/41541365643).
  Inclui npm ci/build/audit, secret check, 66 testes, restauração local e PostgreSQL
  17 nativo com todas as migrações, testes de snapshot/RLS e persistência após restart.
  Não é restauração hospedada nem validação clínica. A execução paralela automática
  do provedor de CI não representa segunda sessão de desenvolvimento sobre o banco
  hospedado: esses jobs usam somente bancos locais descartáveis isolados.

## Evidências históricas do incremento 1 — 2026-11-02

- `node --test tests/*.test.js`: 50 aprovados, zero falhos/ignorados. Inclui
  fórmula por aritmética independente, coeficiente feminino, aplicabilidade,
  entradas não finitas, contexto cruzado, seleção conflitante, unidade errada,
  dado não revisado/futuro, catálogo imutável e registro probabilístico desabilitado.
- Integração HTTP: novos scripts servidos pela allowlist estática; Auth, schemas,
  no-store, CSP, origem e tratamento de erros existentes continuam passando.
- `node --env-file=.env.test scripts/test-remote-browser.js`: Chrome real com
  Auth/API hospedados autorizados passou; catálogo de seis candidatos, revisão
  explícita, seleção não pré-marcada, proveniência e abstenção, invalidação no
  refresh/reload, nenhuma escrita pela prévia, drafts inalterados. Regressão de
  login/MFA, dois registros/reload/novo login, isolamento de unidades com mesmo
  leito e negação de escrita/abertura/fechamento para leitor passou. Novos registros
  são sintéticos; só episódios próprios foram encerrados e fatores próprios removidos.
- Restauração PGlite: aprovada, preparação 5703 ms, snapshot 126 ms,
  restauração/verificação 675 ms, zero registros comprometidos antes da cópia
  perdidos. Não representa backup hospedado, Auth completo ou RPO/RTO clínico.
- Verificações de diff, segredos e matriz de bloqueios passaram; `.env.test`
  continua ignorado e não versionado, sem leitura de conteúdo para relatórios.
- Não validado: acurácia/utilidade clínica, uso numérico remoto, dados suplementares,
  correções resolvidas, janela completa, predição/calibração ou algoritmos
  terapêuticos. Nenhuma migração ou mudança remota de política foi feita.

A primeira tentativa de navegador ficou bloqueada no sandbox de rede. A repetição
com permissão técnica autorizada passou; não se desativou sandbox do Chrome,
TLS, cadastro fechado, MFA, asserts ou políticas para obter aprovação.

Para cada incremento: unitários, integração API e navegador pertinente, registro
de evidências/limites, verificação de segredos/diff, commit e envio exclusivamente
a `develop/osler-secure-foundation`. Nenhuma migração necessária no incremento 1.
Não reexecutar suíte hospedada concorrente sobre fixtures compartilhadas.

## Decisões e limites

- D001: engine nova é independente de `ClinicalScores`, `draft()`, `currentBed`,
  nutrição e anticoagulação. Funcionalidades legadas preservadas, sem alegação de
  revalidação clínica dessas fórmulas.
- D002: primeiro estimador é Cockcroft–Gault 1976, não algoritmo de decisão de
  dose. Fórmula verificada no resumo da fonte original: [Cockcroft/Gault](https://doi.org/10.1159/000180580).
  Limites numéricos técnicos não ampliam a população validada. Não há casos de
  pacientes publicados reproduzidos; casos de teste são aritmética independente
  sintética. Aderência da implementação não prova acurácia em paciente crítico.
- D003: [SOFA original](https://pubmed.ncbi.nlm.nih.gov/8844239/) descreve disfunção;
  [SAPS 3 parte 2](https://pubmed.ncbi.nlm.nih.gov/16132892/) é prognóstico de
  mortalidade hospitalar. Inventário não habilita cálculo nem probabilidade.
- D004: [qSOFA](https://pmc.ncbi.nlm.nih.gov/articles/PMC4968574/) tem contexto fora
  da UTI; não extrapolar para prognóstico validado na UTI. [RASS](https://pubmed.ncbi.nlm.nih.gov/12421743/)
  exige exame. [KDIGO](https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf)
  exige basal/séries e intervalos. Nenhum algoritmo terapêutico habilitado.
- D005 (histórico, substituído por D007): a primeira consulta era página carregada, não janela completa. `started_at`
  não significa admissão à UTI. A prévia guarda contexto, revisor, versões e
  eventos em memória, invalida com mudança/refresh/expiração/erro/logout e nunca
  publica estimativa numérica remota com demografia ou correções pendentes.
- D006: modelos futuros terão contrato de features com unidades/janelas e origem,
  desfecho/horizonte, população/coorte e exclusões, versão/digest do artefato,
  relatórios de discriminação/calibração (intercepto, inclinação, curvas e incerteza),
  validação temporal/externa por local/subgrupo, missingness e censura explícitos.
  Registro aprovado separado da execução; rollout sintético, monitoramento de
  drift/erros/calibração com governança, rollback para versão fixa ou abstenção.
  `model-registry.js` só verifica metadados e mantém tudo desabilitado. Sem treino
  real, aprendizado online ou aprovação por concordância entre modelos.
- D007: leitura única limitada e consistente substitui composição de páginas de
  instantes diferentes. Consultar todo o episódio evita perder correções que movam
  medidas para fora do intervalo. Truncamento bloqueia; cobertura clínica exige
  confirmação própria. Não há nova hipótese de identidade por leito.
- D008: suplementos são entradas revisadas em memória, com ID/contexto/origem/tempos
  por item; não viram observações persistidas nem auditoria clínica durável. Não
  existe envio de drafts. Atualizações exigem nova consulta/revisão explícitas.
- D009: avançar em RASS/KDIGO isolados e diagnóstico probabilístico sintético enquanto
  SOFA original está bloqueado por acesso primário. Fronteiras/protocolos clínicos
  não inferíveis permanecem explícitos em `instrument-specifications.md`.
- D010: revisão documental é um contexto independente de drafts e leito local.
  Imagens/original/ajustes permanecem no navegador durante a revisão; não há Storage
  ou serviço OCR externo. Câmera somente com permissão do usuário, mesma origem.
- D011: persistência é por campo com evento e proveniência atômicos, IDs fixos no
  lote e estados confirmados/ambíguos/recusados explícitos. Não alegar atomicidade
  do lote inteiro ou deduplicação entre novas importações após perder a fila.
- D012: foto, documento, captura no navegador e medição são instantes distintos;
  ausência não vira valor padrão. Confiança retornada pelo OCR é mostrada como tal,
  não por campo e nunca como confiança clínica. Fonte/horário/alterações exigem revisão.

## Bloqueios para dados reais

Continuam os P0 de [security-foundation.md](security-foundation.md): restauração
hospedada isolada/cópia protegida contra exclusão, MFA institucional e recuperação,
revisão independente, governança e validação clínica. Responsáveis, ações e custos
estão na matriz; nenhum serviço pago ou acesso adicional foi solicitado/criado.
