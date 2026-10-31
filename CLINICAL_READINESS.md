# Osler — implantação segura e critérios de aceite

## Estado atual (não validado para uso assistencial)
Frontend estático, IndexedDB por navegador, OCR local Tesseract, cálculos determinísticos e revisão manual. Não existe servidor autenticado, banco central, agente multimodal ou monitoramento contínuo. Não carregar dados identificáveis de pacientes nesta versão.

## Arquitetura alvo
1. Autenticação institucional (SSO/OIDC + MFA), RBAC por unidade e profissional; sessões curtas.
2. API backend autenticada com autorização por hospital/unidade/leito em cada requisição; criptografia em trânsito e repouso; backups com restauração testada; logs de auditoria imutáveis.
3. Modelo de eventos clínicos append-only: unidade, leito, episódio, instante da medição, instante da entrada, variável, valor, unidade UCUM, origem (equipamento/documento/usuário), imagem de evidência, modelo/versão, confiança, status de revisão e autor. Nunca substituir silenciosamente medidas anteriores.
4. Pipeline de imagem: upload seguro -> triagem de PHI -> identificação de equipamento/documento -> detecção de regiões -> extração estruturada -> validação de unidades/faixas/tempos -> reconciliação com dados anteriores -> confirmação profissional -> publicação no prontuário de trabalho. Não alimentar escores com extração não revisada.
5. Motor clínico versionado: fórmulas determinísticas com referências, janelas temporais explícitas, critérios de exclusão, testes independentes e explicação da origem de cada termo. Divergências geram pendência, nunca correção automática.
6. Motor de vigilância: regras auditáveis com latência, limiares, sensibilidade, especificidade, taxa de falsos alertas e análise de deriva; sem prescrições automáticas. Alertas exigem contexto e reconhecimento humano.
7. Painel da unidade: tarefas pendentes, histórico e tendências por episódio, filtros de prioridade, resumo SBAR com referências para os dados originais.
8. Avaliação: conjunto de teste independente por modelo de ventilador/bomba, iluminação, ângulo, OCR manuscrito, unidade, idioma e condições de UTI. Separar treino, validação e teste por paciente/instituição/tempo; avaliação prospectiva silenciosa e aprovação institucional antes de uso clínico.

## Critérios mínimos antes de produção
- Sem vazamento de informações entre leitos e episódios, incluindo após troca de leito, refresh e múltiplas sessões.
- Persistência transacional e restauração de backups testadas; nenhuma perda silenciosa de registros.
- Extração com rastreabilidade por região da imagem e verificação humana; dados ausentes continuam ausentes.
- Testes de unidade e integração para fórmulas clínicas com casos conhecidos, fronteiras, unidades e valores faltantes; revisão médica independente.
- Testes de segurança (autenticação, autorização, isolamento de tenant, auditoria, upload, retenção, exclusão, LGPD).
- Métricas de qualidade clínica predefinidas, calibradas por população e cenário; plano de monitoramento e rollback.
- Procedimentos de resposta a incidentes, governança de modelo e análise regulatória/ética.

## Testes disponíveis
Execute `node --test tests/osler-validation.test.js` em ambiente Node.js >=18. Esses testes cobrem apenas o módulo de validação conservadora e não demonstram segurança ou eficácia clínica do produto.

## Limitações matemáticas
Repetição da mesma fórmula não produz verificações independentes. Erros correlacionados, viés de extração, mudança de população e dados de origem errados persistem mesmo quando múltiplos algoritmos concordam. Não é possível demonstrar erro clínico nulo; mensurar desempenho, intervalos de confiança, calibração e taxa de abstenção em dados independentes.
