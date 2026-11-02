# Especificações verificadas e limites dos instrumentos

Somente desenvolvimento sintético. Um núcleo testado não equivale a validação
clínica. Catálogo `clinical-catalog.js` 1.1.0; cores e adaptadores têm versões
próprias. Não converter pontos em probabilidades ou horizontes novos.

## Cockcroft–Gault

Fonte original: [Cockcroft/Gault, 1976](https://doi.org/10.1159/000180580), fórmula
verificada no resumo do editor. Estimativa em mL/min; não prescrição de dose.
Adulto, idade/peso/creatinina nas unidades declaradas, coeficiente original por
sexo explicitamente selecionado, ausência de AKI/diálise, peso representativo,
estabilidade renal e compatibilidade temporal precisam de revisão própria.
Faixas no código são limites técnicos, não extensão da validação original.

O adaptador remoto exige snapshot completo dos registros armazenados, janela
explícita dentro do episódio, ausência de conflitos nas fontes escolhidas e
cobertura clínica confirmada separadamente. Cada suplemento tem ID, campo,
valor/unidade, referência sintética, instante efetivo e de revisão, revisor e
contexto. Tudo fica em memória; isso é rastreabilidade de uma prévia, não auditoria
durável de decisão clínica. Não inferir identidade de paciente nem admissão à UTI.

## Correções e cobertura

`engine_snapshot` usa SECURITY INVOKER, RLS, search_path vazio e STABLE. A
[semântica MVCC documentada pelo PostgreSQL](https://www.postgresql.org/docs/current/xfunc-volatility.html)
mantém as consultas internas no snapshot da instrução chamadora. Recebe UUIDs e
janela, devolve todos os eventos/vínculos do episódio até limite de 1000 de cada,
contagens completas, intervalo e instante do banco. Nenhuma política existente foi
afrouxada; só authenticated pode executar. Limite de 31 dias é técnico.

Decisão: usar leitura única limitada e consistente em vez de juntar páginas de
instantes diferentes. Exceder o limite impede cálculo. A janela não filtra os
vínculos: uma correção pode deslocar a medição para fora dela. Cadeias lineares
preservam ancestrais; originais substituídos ficam visíveis e indisponíveis para
seleção. Ramos, ciclos ou links inválidos não elegem automaticamente um vencedor.
Ausência de registros não significa ausência clínica de achados. Não há escolha
automática de extremos, último valor ou cobertura clínica por contagem.

O resultado descreve o estado consultado no instante indicado; não acompanha
automaticamente gravações feitas depois por outro usuário. Nova consulta,
refresh, mudança/erro/expiração de sessão ou contexto invalidam a revisão. O
cliente rejeita resposta de intervalo/contexto anterior. A RPC não grava auditoria
de leitura: a API registra metadados mínimos, enquanto leituras diretas ainda
dependem da auditoria externa do provedor, pendência de segurança já registrada.

## RASS

Fonte primária verificada: [Ely et al., JAMA 2003, tabela 1 e sequência de exame](https://jamanetwork.com/journals/jama/fullarticle/196696).
O núcleo exige população adulta e exame revisado. Primeiro usa a observação
espontânea; somente quando falta alerta avança às respostas à voz e depois à
avaliação física. Produz ordinal de −5 a +4; não propõe alvo nem dose de sedação.
Não usa notas, OCR ou áudio para inferir respostas.

Bloqueio concreto: os sinais estritos da tabela consultada deixam exatamente
10 segundos sem regra inequívoca. O núcleo se abstém nesse valor. Responsável
clínico deve indicar um protocolo primário/institucional aprovado que resolva a
fronteira; custo: tempo de revisão, sem serviço contratado. Não foi inventada
convenção ≥10. UI remota de exame permanece desabilitada: estes são testes de
núcleo isolado, não validação de examinadores ou protocolo operacional.

## KDIGO AKI — via creatinina

Fonte primária: [KDIGO 2012](https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf),
recomendação 2.1.1, tabela 2 e exemplos construídos A–E da tabela 10, página
impressa 30. O núcleo adulto usa creatinina em mg/dL, medição atual selecionada e
basal identificada; não inventa basal. Compara intervalos reais de 48 h/7 dias,
incluindo fronteiras e preservando IDs de evidência. Creatinina alta e estável
isoladamente não demonstra evento agudo. Tolerância numérica é apenas de erro
de ponto flutuante, não uma margem clínica adicional.

O retorno é **parcial**, com limite inferior de estágio pela via creatinina e
`overallStage:null`. Zero não exclui AKI. Diurese e RRT podem aumentar estágio;
não se fornece classificação global ou recomendação terapêutica. Os casos F–H
não foram usados para aprovar imputação de basal desconhecida.

Bloqueios para integrar KDIGO completo: não há contrato revisado de diurese por
intervalo (volume, duração, completude, peso aplicável e sua origem), nem registro
estruturado do início de RRT distinguindo terapia crônica. Governança clínica deve
aprovar esse contrato e seleção de peso/intervalos; desenvolvimento então poderá
adicioná-lo com proveniência e testes. Custo: revisão profissional e implementação,
sem contratação automática. Basais de outros episódios exigem identificação de
paciente autorizada, ausente hoje; nunca associar pelo leito. UI remota KDIGO
permanece desabilitada; o núcleo recebe somente séries sintéticas estruturadas.

## SOFA original e demais candidatos

O [artigo original de 1996](https://link.springer.com/article/10.1007/BF01709751)
expõe apenas prévia sob o acesso disponível. Tabela completa, igualdade nas
fronteiras, suporte, exposição a vasoativos e regras temporais precisam ser
verificadas antes de implementar a versão original na nova engine. Não copiar
tabelas secundárias divergentes nem declarar a versão de 2016 equivalente sem
essa conferência. As funções locais legadas foram preservadas e não recebem
dados remotos por esse caminho.

Ação externa exata: biblioteca/revisor institucional obter legalmente o texto
integral DOI `10.1007/BF01709751`, páginas 707–710, e fornecer referência local
autorizada para revisão; nenhum login pelo chat. Pode não haver custo adicional
com assinatura institucional. A página do editor consultada em 2026-11-02 mostra
compra avulsa de US$ 39,95 antes de impostos; não foi comprada. Enquanto faltar
acesso/especificação, SOFA novo permanece bloqueado, sem bloquear os outros cores.

SAPS 3 permanece candidato prognóstico não habilitado; requer especificação e
validação da população/modelo com mortalidade hospitalar explícita. qSOFA não foi
habilitado para prognóstico na UTI. Nenhum algoritmo de decisão terapêutica entrou.

## Avaliação probabilística preparada, sem previsões

`synthetic-model-evaluation.js` avalia números sintéticos fornecidos, sem carregar,
treinar, recalibrar ou executar modelos. Exige desfecho, horizonte, versão,
follow-up completo e instantes explícitos; rejeita censura/labels fora do horizonte.
Calcula Brier e pontos de confiabilidade por bins; Brier não mede apenas
calibração, conforme [documentação técnica primária](https://scikit-learn.org/stable/modules/calibration.html).
Inclinação/intercepto, incerteza e discriminação ficam não estimados. Bins e tamanho
de amostra limitam interpretação. O marcador syntheticOnly é restrição de uso,
não detector automático de dados reais.

Verificação estrutural de splits rejeita sobreposição temporal, sujeitos/IDs entre
conjuntos e sites compartilhados em avaliação externa. Isso não constitui estudo
externo/temporal clínico. O registry continua sempre desabilitado, inclusive com
metadados completos. Aprovação exige dados/estudo autorizados, revisão independente,
monitoramento, calibração/validação e rollback formal. Concordância entre modelos
não é critério de correção. Nenhum aprendizado online ou previsão clínica foi criado.
