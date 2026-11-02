# Preparação de segurança — ambiente exclusivamente sintético

Branch exclusiva: `develop/osler-secure-foundation`. Projeto: `otnwkxchugsovtjdanyu`.
Este documento registra implementação e evidências, não uma declaração de aptidão
clínica, conformidade LGPD ou autorização para dados reais.

## Inventário e fronteiras de confiança

| Ativo/fluxo | Conteúdo atual | Fronteira e risco |
| --- | --- | --- |
| Navegador/IndexedDB | notas, OCR revisado/bruto, resultados locais, rascunhos por leito | dispositivo compartilhado, XSS, exportação; sem identificação de paciente autorizada |
| Áudio/imagens | arquivos selecionados, blobs de áudio temporários | permissões locais, arquivo hostil, download para dispositivo |
| OCR | bytes da imagem processados pelo worker local | dependências/modelos carregados por rede eram uma fronteira de fornecimento |
| API loopback | login sintético, tokens em memória, consultas e eventos | abuso, replay, IDOR, logs; HTTP apenas loopback, HTTPS necessário fora dele |
| Auth/PostgREST | identidades sintéticas, sessões, unidades, membros, episódios, eventos | credenciais de usuário, JWT roubado, autorização direta fora da UI |
| Storage | nenhum bucket observado | anexos não habilitados; não criar caminho de upload público |
| Exportação/importação | JSON local sem proteção criptográfica | cópias fora do controle, ransomware, importações não confiáveis |
| Git/CI/logs | código, testes, metadados mínimos | vazamento de segredos e comprometimento da cadeia de entrega |
| Administração/provedor | membros do projeto, chaves privilegiadas, backups | superusuário pode contornar RLS, destruir dados e auditoria no mesmo banco |

## Ameaças e tarefas priorizadas

1. **P0 — exfiltração/XSS/cadeia de fornecimento:** ativos locais versionados,
   retirar handlers inline, CSP e negar conexões externas no navegador; preservar OCR.
2. **P0 — autorização:** política por unidade e MFA no banco, menor privilégio,
   testar REST/RPC/Storage e escalada direta. Nunca usar leito como identidade.
3. **P0 — perda/comprometimento administrativo:** restauração sintética isolada,
   documentar capacidade não observável de PITR e cópias independentes necessárias.
4. **P1 — API:** origem, limites, paginação, timeouts, rate limiting e erros
   sanitizados. Logs com rota normalizada, não corpo, query, senha ou token.
5. **P1 — integridade:** auditoria minimizada de mutações e correções como eventos
   imutáveis referenciando originais, sem apagar registros anteriores.
6. **P1 — sessão:** MFA/renovação testadas pelo fluxo oficial; revogação efetiva
   limitada pela validade do JWT e rechecagem do servidor.
7. **P1 — operação:** resposta a incidentes, retenção sem prazo legal inventado,
   rotação, monitoramento e critérios de liberação independente.

## Restrições observadas antes da execução

Auth público tinha cadastro fechado nas verificações anteriores. As quatro tabelas
clínicas possuem RLS. Storage não possui buckets nem políticas de objeto observadas.
Nenhum fator TOTP estava cadastrado inicialmente. O advisor reportou proteção de
senha vazada desativada e duas funções SECURITY DEFINER intencionais; estas
precisam continuar restritas, com `search_path` fixo e autorização interna.
Não há Docker, psql ou pg_dump no PATH. A conexão disponível não permite consultar
plano/backups/PITR ou modificar configuração de Auth. Essas limitações não serão
supridas com credenciais inventadas, acesso a outros projetos ou serviços pagos.

## Decisões sobre criptografia e dados locais

HTTPS com validação TLS é usado para Auth/PostgREST. HTTP loopback não demonstra
TLS de um futuro ingresso. O provedor declara AES-256 em repouso e TLS em trânsito:
[Supabase Security](https://supabase.com/security). Isso não prova configuração,
chaves externas, residência, contrato ou adequação do projeto à instituição.

Criptografia de campos com KMS externo deve ser considerada para identificação e
texto clínico diante de comprometimento administrativo, incluindo quem consegue
descriptografar, rotação, busca e recuperação. Não será criada criptografia própria
nem colocada chave ao lado do banco. Não há vínculo de paciente no esquema atual.
Dados reais continuam proibidos em IndexedDB e exportações; não há política
institucional de retenção, proteção de dispositivos ou eliminação aprovada.

## Backups e restauração

[Backups Supabase](https://supabase.com/docs/guides/platform/backups) descreve
capacidades dependentes do plano. O plano, disponibilidade de backups e PITR deste
projeto ainda não foram observados pelo conector; não presumir cobertura.
Uma restauração local sintética verificará o mecanismo disponível separadamente.
Ela não equivale à restauração de um backup hospedado completo, incluindo Auth e
Storage, nem demonstra RPO/RTO de produção.

## Pendências externas e liberação futura

- Revisão independente de segurança e testes de intrusão.
- Instituição/controlador, governança clínica, privacidade/LGPD, base legal,
  contratos, operadores/suboperadores, residência e resposta a titulares.
- Identificação explícita de paciente e vínculo autorizado ao episódio; nenhum
  preenchimento pelo leito ou migração automática de rascunhos.
- SSO/MFA institucional e administrativo, gestão de dispositivos e revisão de acesso.
- Política aprovada de retenção por categoria, expiração local e proteção de exportações.
- KMS e cópias criptografadas isoladas, proteção contra exclusão, restauração completa
  medida e RPO/RTO aprovados; nenhum plano ou armazenamento pago contratado aqui.
- Logs externos com retenção/acesso controlados e alertas; auditoria no próprio
  banco não é armazenamento imutável independente contra seu administrador.
- Anexos somente após Storage privado, autorização de objetos, URLs temporárias,
  limites, quarentena e verificação. Upload remoto continua ausente.
- Validação institucional/clínica e autorização explícita antes de qualquer dado real.

## Implementações e evidências desta execução

| Controle | Estado e evidência |
| --- | --- |
| Cadastro fechado | Observado via Auth HTTPS antes dos testes; nenhuma chamada de signup adicionada |
| Renovação | Ativa na API/UI de desenvolvimento; refresh token só no servidor, rotação/coalescência, teto técnico de 2h e descarte após logout/reinício |
| MFA TOTP | Fluxo oficial e UI testados com código inválido e válido; AAL2 observado em token emitido pelo Auth; fatores temporários removidos |
| Exigência MFA no banco | **Aplicada e validada no desenvolvimento em 2026-11-02**; novas unidades e papel admin exigem AAL2 e sessão ativa; somente duas fixtures legadas continuam AAL1 sintético |
| Instituição | FK e escopo sintético aplicados; não é identidade de paciente nem IAM institucional completo |
| RLS/grants | Estado inicial hospedado observado; REST/RPC atuais e bloqueio do leitor testados; regras adicionais testadas no PostgreSQL isolado |
| Correção append-only | RPC/API e vínculos aplicados e testados no remoto; original preservado, reason code, autor, retry e bloqueio após fechamento |
| Auditoria de mutação | Triggers ativos em schema privado; cliente não escreve, somente admin AAL2 consulta sua unidade; guardas de alteração também testadas em registros novos |
| Auditoria de acesso API | Ativa no servidor iniciado por `server/index.js`, JSON com request ID, horário, método, rota normalizada, status e ator autenticado; sem corpo/query/tokens |
| Limites | Corpo de 16 KiB, timeouts, schemas, origem exata, allowlist de Host loopback contra DNS rebinding, páginas de até 100, offset máximo 100000, ordenação estável, rate limit por IP/token |
| Navegador | CSP sem script inline, conexões apenas same-origin, headers de isolamento/referrer/frame; 33 handlers movidos para JS estático |
| Cadeia de fornecimento | Lockfile com versões exatas, instalação sem scripts; 20 ativos locais com inventário SHA-256; `npm audit` retornou zero vulnerabilidades conhecidas |
| OCR/áudio | Worker, WASM e modelo português locais; imagem sintética reconhecida sob CSP; áudio de dispositivo simulado gravado localmente; nenhum envio de bytes para terceiros |
| Exportação/importação | Confirmação explícita, limite de 5 MiB, estrutura/protótipos/profundidade validados antes de alterar drafts; JSON exportado continua sem criptografia e apenas sintético |
| Storage | Inicialmente sem buckets/políticas de objeto; upload direto para bucket não configurado rejeitado; anexos continuam desabilitados |
| Testes hospedados | Auth/MFA/renovação, navegador, dois leitos iguais em unidades distintas, replay após recarga, leitor, idempotência e corrida append/close passaram |
| Dados existentes | Não foram apagados, migrados ou reclassificados como dados de paciente; limpeza só encerra episódios novos do teste e remove fatores/perfil temporários próprios |

### Resultado da restauração isolada

`node scripts/test-restore.js` executou todas as migrações locais, os testes de RLS,
MFA insuficiente/admin, revogação da sessão, correções e proteção da auditoria;
criou um snapshot em memória e abriu outro PostgreSQL WASM a partir dele.
Na medição registrada na preparação inicial: preparação 4430 ms, snapshot 146 ms, restauração e
verificação 705 ms, zero registros comprometidos antes da cópia perdidos.
O RPO observado é **zero registros desse conjunto sintético sem gravações
concorrentes durante o snapshot**; não é um RPO temporal de operação contínua.
O RTO local observado de restauração e consulta foi **705 ms**, sem download,
infraestrutura remota, Auth real ou Storage. O relatório gerado fica em
`.test-artifacts/restore-report.json`, ignorado pelo Git. Snapshot e chaves reais
não são gravados no repositório; nenhuma cópia externa criptografada foi testada.

### Migrações e reconexão administrativa — bloqueio resolvido

A tentativa anterior falhou com `OAuth token refresh failed` e não foi presumida
como aplicada. Em 2026-11-02, após reconexão do proprietário, o MCP confirmou
`otnwkxchugsovtjdanyu`. O histórico ainda tinha somente as cinco migrações antigas;
o schema privado, as novas tabelas/coluna/RPCs/triggers estavam ausentes e a função
de acesso ainda tinha a definição antiga. Não havia vestígio de aplicação parcial.

Somente a migração ausente foi aplicada. O provedor registrou a versão
`20261102142059`, e o arquivo foi renomeado para
`20261102142059_security_audit_mfa_corrections.sql`, preservando o SQL. Histórico e
schema foram conferidos depois, inclusive RLS, triggers habilitados, grants e as
duas exceções sintéticas AAL1 já previstas. As seis versões locais correspondem
ao histórico remoto observado.

Comparações de contagens, IDs e hashes antes/depois preservaram os campos originais
das 2 unidades, 26 episódios e 29 observações que já existiam. As associações
anteriores foram preservadas; a coluna institucional é uma adição explícita de
schema, não um vínculo de paciente. Nenhuma observação antiga foi sobrescrita.

`scripts/test-hosted-protected.js` passou com três contas sintéticas e duas novas
unidades protegidas, com associações exclusivas da execução. Validou AAL1 negado,
AAL2 real permitido, papéis leitor/clínico/admin, correção e vínculo imutáveis,
idempotência, auditoria minimizada por unidade e revogação de acesso no banco após
logout. Foram mantidos 3 novos eventos (incluindo a correção), 1 vínculo e seus
eventos de auditoria. Os 2 episódios novos foram encerrados e os 3 fatores TOTP
temporários foram removidos. Não foram apagadas unidades, eventos ou auditorias.

Os fatores são efêmeros para teste: isso não habilita MFA permanente das contas
ou da organização. As duas unidades legadas são exceções sintéticas explícitas,
não uma autorização para dados reais. O servidor de teste foi apenas loopback.

Após a aplicação, os 41 testes locais, a restauração isolada, a suíte de gravação
hospedada e o navegador real passaram novamente. A restauração local repetida
mediu 4188 ms de preparação, 166 ms de snapshot e 692 ms de restauração/verificação,
sem perda dos registros comprometidos antes da cópia; continuam válidas as
limitações dessa medição local. A comparação final, após todas as regressões,
confirmou novamente os hashes/contagens dos registros antigos e das 3 associações
anteriores. O episódio antigo que estava aberto permaneceu aberto.

O advisor posterior informa ausência de políticas nas duas tabelas privadas:
[RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Isso é intencional para negar acesso cliente, além de não haver USAGE no schema.
As quatro funções públicas SECURITY DEFINER autorizadas continuam sinalizadas
pelo [advisor de funções](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable);
as verificações internas de unidade, função, MFA e sessão foram exercitadas, sem
ampliar grants para silenciar o aviso. A [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
continua desativada e é uma pendência de configuração do provedor.

### Matriz final de testes

| Execução | Resultado |
| --- | --- |
| `node --test tests/*.test.js` | 41 aprovados, zero falhos/ignorados nessa suíte |
| `node scripts/test-restore.js` | Aprovado: migrações locais, RLS, AAL1/AAL2, admin, sessão removida, correções, auditoria, snapshot e restauração |
| `node --env-file=.env.test scripts/test-auth-security.js` | Aprovado contra Auth real: renovação, MFA inválido/válido, AAL2, Storage não configurado e limpeza |
| `node --env-file=.env.test scripts/test-hosted-writes.js` | Aprovado no esquema remoto anterior: leitor, duas unidades, gravação, idempotência, fechamento e concorrência append/close |
| `node --env-file=.env.test scripts/test-remote-browser.js` | Aprovado em Chrome real, inclusive OCR local, áudio simulado, backup local, MFA/renovação, recarga e isolamento |
| `npm audit --audit-level=high` | Zero vulnerabilidades conhecidas no resultado consultado; não é garantia de ausência de vulnerabilidades |
| TLS do cliente | Verificação não desativada no ambiente; npm strict-ssl=true; requests hospedados concluídos com TLS normal |
| Banco nativo via Docker | Aprovado no GitHub Actions: PostgreSQL 17, migrações locais, testes básicos/avançados e persistência após restart. Não executado localmente porque Docker está ausente |
| Migração administrativa e novos controles no projeto | Aplicada como `20261102142059` e validada com testes Auth/HTTP/RPC/RLS reais após inspeção prévia sem vestígios parciais |
| `node --env-file=.env.test scripts/test-hosted-protected.js` | Aprovado: AAL1/AAL2 de três papéis, correções, autoria, auditoria, isolamento, fechamento, logout e limpeza de fatores próprios |
| Backup/PITR e restauração hospedada completa | Ainda não comprovados: o MCP SQL foi restabelecido, mas não expõe configuração de plano/backups nem destino isolado de restauração |
| Cópia externa criptografada, KMS e retenção institucional | Não testados/configurados: dependem de capacidade/decisão externa, sem contratação ou custo novo |
| GitHub Actions | Jobs `test` e `database` aprovados para o commit `8f1fd4c548a9257667842547af85b818eef58a2f`; instalação, build, audit, secret check, testes e restauração passaram |
| Integração Vercel | Status de falha retornado pelo provedor; descrição genérica requer logs autenticados. Nenhum deploy foi acionado pelo agente nem houve alteração de produção |

Evidência externa de CI: [execução de push 41365409863](https://github.com/lmaximo123/icu_mind/actions/runs/41365409863).
A execução do evento de pull request para o mesmo SHA também terminou com sucesso
(41365413539). Não foi criado nem feito merge de pull request nesta execução.
A falha de Vercel não foi ignorada ou convertida em teste aprovado; o acesso a
logs e configuração dessa integração é uma pendência separada, sem tentativa de
publicar ou alterar sua configuração.

Uma execução intermediária do navegador encontrou falha na limpeza após MFA:
vários JWTs representavam a mesma sessão Auth. O rastreamento e a limpeza foram
corrigidos por `session_id`, e a suíte completa passou novamente. Não se ignorou
erro de logout nem se reduziu assert para obter aprovação. O cofre do servidor
também descarta material associado à sessão após logout aceito pelo Auth, e há
teste para corrida entre renovação em andamento e encerramento da sessão.

## Limites e tarefas remanescentes por prioridade

- **Resolvido em 2026-11-02:** conexão administrativa recuperada, schema/histórico
  inspecionados, migração ausente aplicada e controles novos testados no banco
  hospedado. A liberação de dados reais continua bloqueada pelos itens seguintes.
- **P0:** comprovar plano/backups/PITR, restauração completa hospedada em destino
  isolado, cópias criptografadas fora do domínio administrativo da aplicação e
  proteção contra exclusão/ransomware. O provedor e o app não são a mesma fronteira.
- **P0:** SSO/MFA obrigatório e recuperação institucional, MFA dos administradores
  do projeto, revisão de acesso privilegiado e proteção de senhas vazadas. O advisor
  detectou esta última desativada; o conector não expõe sua configuração.
- **P0:** autorização institucional de identificação de paciente, dispositivos,
  retenção, exportações e eventual criptografia de campos com KMS externo.
- **P1:** persistir/monitorar logs em destino externo com acesso/retensão aprovados.
  O sink atual é stdout minimizado e best-effort; não garante entrega durável.
  Leituras diretas via PostgREST não passam pelo audit logger da API: sua auditoria
  depende dos logs do provedor/configuração ainda não verificados.
- **P1:** rate limiting distribuído e ingresso HTTPS/HSTS com origem explicitamente
  configurada antes de qualquer exposição pública. O limitador atual é por processo,
  não confia em X-Forwarded-For e não substitui proteção de borda contra DDoS.
- **P1:** política de retenção/eliminações em todos os armazenamentos. Não há job
  destrutivo automático nem prazo legal/institucional inventado. A memória de sessão
  tem teto técnico de 2h; dados sintéticos persistentes e logs exigem decisão própria.
- **P1:** UI de correções e histórico de vínculos; hoje a rota/RPC
  está ativa no desenvolvimento. Correção após encerramento é negada; adendo clínico exigirá desenho
  explícito. A proposta de escores remotos continua sem implementação.

## Operação e resposta a incidentes

1. Conter: manter o serviço em loopback, desativar a opção de UI remota quando
   necessário e bloquear o ingresso comprometido. Preservar evidências sem copiar
   credenciais, imagens ou prontuários para logs ou repositórios.
2. Revogar: remover memberships comprometidas por administração confiável;
   sessões/tokens devem ser encerrados no Auth. Na política nova, remover a sessão
   bloqueia o acesso protegido por verificação no banco; nas fixtures legadas, JWT
   já emitido pode continuar aceito até expiração. Não declarar revogação imediata
   global sem verificar o caminho de acesso.
3. Rotacionar: chaves secret/service_role somente no gerenciador de segredos do
   ambiente confiável, invalidar conexões afetadas, revisar grants e administradores.
   A aplicação não utiliza nem recebe essas chaves; nenhuma foi criada ou exposta.
4. Monitorar: usar eventos de 401/403/429/5xx, falhas de MFA, mudanças de memberships,
   mudanças de configuração de segurança e exportações. Exportações locais exigem
   confirmação mas ainda não têm trilha central durável; não inferir inexistência
   de exportação pela ausência de log de servidor.
5. Recuperar: usar cópia isolada verificada, validar contagens, autoria, vínculos e
   RLS antes de reabrir acesso. Uma tabela append-only no mesmo banco não resiste
   a um administrador que possa desabilitar triggers, alterar SQL ou apagar o banco.
6. Escalar para governança/privacidade/segurança institucional para análise de
   impacto, comunicações e critérios de retorno; não inventar prazos legais aqui.

## Checklist de liberação futura

- [x] Migração aplicada e testes hospedados sintéticos de AAL1/AAL2/admin aprovados.
- [ ] Revisão independente de código, dependências, infraestrutura e pentest.
- [ ] Identidade institucional, MFA/recuperação, IAM e segregação administrativa aprovados.
- [ ] Restauração completa, cópias isoladas criptografadas e RPO/RTO aprovados.
- [ ] TLS do ingresso, HSTS, origem e limites distribuídos verificados.
- [ ] Auditoria externa, alertas e limites contra adulteração demonstrados.
- [ ] Retenção, dispositivos e exportações autorizados; nenhum dado real em drafts atuais.
- [ ] Privacidade/LGPD, contratos e governança clínica revisados pela instituição.
- [ ] Validação clínica e operacional e autorização explícita de uso real.
