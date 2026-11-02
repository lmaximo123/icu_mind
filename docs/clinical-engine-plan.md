# Plano executável da engine — somente dados sintéticos

Prioridade atual (2026-11-02): engine integrada e controles técnicos necessários
à integração. Backups hospedados, MFA institucional e revisão independente
continuam bloqueios para dados reais; decisões externas não bloqueiam tarefas
independentes de desenvolvimento. Uma única execução trabalha nesta branch.

| Ordem | Tarefa | Aceite e estado |
| --- | --- | --- |
| 1 | Inventariar e versionar instrumentos/fontes | `clinical-catalog.js`: seis candidatos, fonte e nível de verificação explícitos; apenas Cockcroft–Gault tem cálculo na nova engine |
| 2 | Aplicabilidade e cálculo isolados | Inclusão/exclusão/abstenção explicadas; casos sintéticos derivados independentemente da fórmula original; sem imputação nem probabilidades |
| 3 | Prévia remota isolada | Seleção/revisão explícitas; autoria/IDs/unidades/horários; contexto validado pelo episódio autorizado; nenhuma escrita ou leitura de drafts; abstenção obrigatória enquanto faltam dados |
| 4 | Resolver correções e cobertura | Próxima tarefa técnica: consulta autenticada, paginada e consistente de vínculos/eventos; nunca substituir silenciosamente seleção; cadeias/conflitos exigem revisão |
| 5 | Entradas suplementares revisadas | Após 4: representar idade/coeficiente, exclusões, estabilidade e adequação de peso com autoria, instante, origem e confirmação próprias; não inferir de leito/notas |
| 6 | SOFA original | Revisar tabela integral e regras temporais com fonte primária; casos independentes de fronteira; modelo de janela completa e suporte antes de habilitar cálculo remoto |
| 7 | KDIGO/RASS | Refinar protocolo e inputs estruturados; testes temporais para AKI, avaliação explícita para RASS; sem inferência por texto livre |
| 8 | Modelos probabilísticos | Apenas arquitetura de registro preparada; sem runtime/previsões. Desfecho/horizonte e artefato fixos, calibração, validação temporal/externa, monitoramento e rollback exigidos |

## Evidências do incremento 1 — 2026-11-02

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
- D005: a consulta atual é página carregada, não janela completa. `started_at`
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

## Bloqueios para dados reais

Continuam os P0 de [security-foundation.md](security-foundation.md): restauração
hospedada isolada/cópia protegida contra exclusão, MFA institucional e recuperação,
revisão independente, governança e validação clínica. Responsáveis, ações e custos
estão na matriz; nenhum serviço pago ou acesso adicional foi solicitado/criado.
