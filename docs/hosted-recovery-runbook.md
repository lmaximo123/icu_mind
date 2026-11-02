# Ensaio hospedado de recuperação — pendente de acesso, destino e orçamento

Origem única autorizada: `otnwkxchugsovtjdanyu`, exclusivamente sintética.
Não restaurar sobre a origem, excluir dados existentes, contratar plano ou criar
outro projeto com a autorização atual. O MCP conectado não expõe consulta de
backups/plano nem restauração; o ensaio local não substitui este procedimento.

1. **Proprietário Supabase/infra:** conferir projeto e organização no painel,
   consultar plano/faturamento e Database → Backups. Registrar tipo, último sucesso,
   pontos disponíveis, retenção técnica e janela PITR, sem copiar segredos. Se não
   houver backup, registrar a lacuna e obter orçamento antes de habilitar serviço.
2. **Responsável institucional/orçamento:** autorizar explicitamente destino
   isolado e custo máximo. A opção Restore to a New Project depende de plano pago
   e backups físicos; cria outro projeto e pode cobrar recursos. Não clicar na
   restauração da origem. Confirmar preço mostrado, região e isolamento antes de
   executar. A documentação do provedor é referência de capacidade, não prova do
   plano contratado. [Backups](https://supabase.com/docs/guides/platform/backups),
   [restauração para novo projeto](https://supabase.com/docs/guides/platform/clone-project).
3. **Infra/segurança:** restringir o destino, desabilitar integrações de saída,
   emails, jobs e webhooks; não reutilizar credenciais de produção. Preparar
   credenciais sintéticas por mecanismo local seguro. Registrar manifesto mínimo
   de IDs, contagens, hashes e timestamps de eventos sintéticos; nunca conteúdo
   clínico, senhas, tokens ou hashes de senha em relatórios.
4. **Infra:** escolher backup/ponto de recuperação e registrar início/fim reais.
   O clone inclui dados Auth, mas exige reconfiguração de Auth/API keys, funções
   e outros serviços. Objetos Storage não fazem parte do backup do banco; hoje
   não há buckets, mas anexos futuros exigem cópia e restauração próprias.
   Não considerar o término do job como sucesso da aplicação.
5. **Desenvolvimento/segurança:** comparar histórico de migrações, schema, RLS,
   grants e manifesto; executar testes sintéticos de login/MFA, REST/RPC, isolamento,
   leitor, correções, idempotência, fechamento, auditoria e persistência. Validar
   configuração de sessão, rejeição de tokens da origem e ausência de saídas
   externas; não exportar fatores/segredos em evidências.
6. **Custodiante independente:** preparar cópia cifrada com gestão de chaves
   separada e proteção contra exclusão/alteração. Backup do mesmo projeto pode ser
   perdido com exclusão administrativa do projeto. Testar negação de exclusão com
   identidade da aplicação apenas sobre recurso descartável criado pelo ensaio,
   sem tentar apagar origem/cópias existentes. Testar recuperação de chaves e
   restauração da cópia isolada; RLS e triggers não protegem contra superadmin.
7. **Operações/revisor:** registrar ponto recuperado, último evento confirmado na
   origem, IDs sintéticos perdidos, RPO observado e sua fórmula; registrar RTO desde
   início do incidente simulado até aplicação validada. Distinguir duração do job,
   indisponibilidade e tempo de validação. Instituição define metas RPO/RTO e
   retenção; não inventar prazos legais. Guardar relatório sem segredos e tratar
   desvios. Remover somente recursos descartáveis inequivocamente criados pelo
   ensaio, com identificação e autorização adequadas ao destino.

Critério de conclusão: evidência hospedada reproduzível, recuperação funcional,
negações de acesso/exclusão, dependências Auth/configuração/Storage verificadas e
revisão independente. Hoje não há RPO/RTO hospedados medidos. Custo pendente:
plano/add-ons, compute/disco do destino, armazenamento independente/KMS e tráfego;
o proprietário consulta valores efetivos e solicita orçamento antes de contratar.
