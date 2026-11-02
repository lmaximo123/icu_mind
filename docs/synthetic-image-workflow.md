# Imagem sintética → observações remotas → instrumentos

Somente `develop/osler-secure-foundation` e Supabase de desenvolvimento
`otnwkxchugsovtjdanyu`. Não usar documentos clínicos reais. OCR bem-sucedido,
faixas plausíveis e testes de software não comprovam validade clínica.

## Abrir a versão local

No PowerShell, na pasta do repositório, com o `.env.test` sintético já configurado
localmente e ignorado pelo Git:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
$env:OSLER_ENABLE_REMOTE_UI='1'
node --env-file=.env.test server/index.js
```

Abrir **http://127.0.0.1:3000/** no Chrome. O servidor fica somente em loopback;
não houve deploy. Abrir o painel remoto e entrar com uma conta sintética já
provisionada (credenciais somente no mecanismo local, nunca no chat). Unidades
protegidas continuam exigindo o MFA existente; não foram removidas exceções
sintéticas nem reaberto cadastro público. Não expor esse servidor na rede para
tentar acessar por telefone.

## Experimentar o fluxo

1. No painel **Imagem sintética → OCR local → revisão → episódio remoto**, usar
   arquivo PNG/JPEG/WebP ou **Carregar exemplo**. Os exemplos são gerados pelo
   próprio navegador, sem serviço externo. **Baixar exemplo** permite usar o
   seletor de arquivo. **Abrir câmera** solicita permissão explícita; capturar
   quadro encerra os tracks. Cancelar/fechar interrompe a câmera.
2. Ajustar rotação em passos de 90°. Para recortar, preencher coordenadas em pixels
   da imagem girada ou arrastar um retângulo e clicar **Aplicar recorte**. Alterar
   ajuste invalida o OCR/revisão anterior. **Restaurar original** desfaz os ajustes.
3. Clicar **Executar OCR local**. Worker, WASM e modelo português são os mesmos
   ativos fixados e locais do OCR existente. Há progresso real do motor e
   cancelamento; pode haver espera pelo carregamento local dos ativos. Nenhum
   candidato fica marcado automaticamente. Conferir a imagem e os trechos fonte.
4. Escolher explicitamente unidade e episódio remoto. Se preciso, abrir novo
   episódio sintético pelo formulário existente. Essa mudança invalida confirmações
   e horários de medição já preenchidos. O leito local não é usado como destino.
5. Para o exemplo laboratory, revisar **Peso 72 kg** e **Creatinina 1.00 mg/dL**.
   Informar o horário próprio de cada medição e marcar cada item desejado. O horário
   precisa pertencer ao episódio autorizado; não se retrodata o episódio para
   acomodar documento anterior. Não selecionar pH se não for necessário ao teste.
   Grandeza sem unidade ou unidade omitida exige conferência explícita; alterações
   de valor/unidade e preenchimento de unidade antes ausente exigem justificativa.
6. Foto e documento têm campos de horário separados, opcionais e inicialmente
   vazios. Não preencher se desconhecidos. Captura pela câmera registra somente
   o instante do quadro no navegador, não o instante da foto/documento/medição.
   Arquivos não usam EXIF nem lastModified para inferir esses horários. Datas lidas
   no texto não são promovidas automaticamente a horário de medição.
7. Confirmar o destino/conteúdo e clicar **Persistir campos revisados**. Somente
   campos marcados, unidades, horários e proveniência mínima são enviados. Não vão
   pixels, arquivo, nome do arquivo, texto OCR integral, URLs da imagem ou tokens.
   A proveniência contém o trecho fonte explicitamente revisado, valores/unidades
   brutos, justificativa de alteração, hashes, ajuste, IDs e versão do OCR.
8. Conferir os estados individuais do lote. Falha/timeout pode ocorrer depois do
   commit. **Verificar confirmações sem reenviar** consulta comprovantes sob RLS;
   presença confirma, ausência não prova que a escrita falhou. **Retomar com os
   mesmos IDs** exige nova confirmação do destino fixo e repete exatamente os itens
   ainda não confirmados. Nunca gere outro ID para resolver resposta perdida.
9. Quando tudo estiver confirmado, imagem original/ajustada e texto são removidos
   da revisão. **Consultar proveniência** recupera até 100 origens do episódio
   autorizado; não comprova completude de todo o histórico. Sair/expirar ou mudar
   conta também remove a imagem e invalida revisão. Registros remotos permanecem.
10. Usar **Ir para seleção e prévia dos instrumentos**. Informar intervalo explícito,
    consultar snapshot, selecionar os eventos e revisar aplicabilidade/suplementos.
    Só peso/creatinina não bastam para CG: a engine se abstém até a revisão das
    entradas necessárias. Os bloqueios de SOFA, RASS e KDIGO permanecem. Nenhuma
    imagem ou rascunho alimenta o escore automaticamente; o resultado fica em memória.

## Semântica de falhas e retenção

- A transação é por campo: evento e proveniência são gravados juntos pela RPC
  `append_document_observation`, herdando unidade/função/MFA e o relógio/limites da
  gravação existente. O lote inteiro pode ficar parcial; não há sucesso global
  enquanto houver item não confirmado. Originais/eventos não são sobrescritos.
- Estado `uncertain` preserva payload e ID. Estado `rejected` é uma resposta de
  recusa explícita; o lote mostra confirmações anteriores separadamente. Pausar
  interrompe somente os próximos itens; a solicitação atual ainda pode confirmar.
  Encerrar itens nunca enviados/recusados não apaga os confirmados e não é permitido
  enquanto restar item ambíguo.
- A fila vive **somente nesta aba**. Logout permite retomar a mesma fila para a
  mesma conta, com confirmação explícita do destino original e nova autorização.
  Outra conta não pode retomar a fila. **Recarregar/fechar perde a fila**: há aviso
  antes de sair, mas não há garantia de navegador/OS respeitá-lo. Após recarga,
  consultar proveniência antes de reenviar a imagem. Não há deduplicação global
  entre uma nova importação intencional e um lote perdido. Essa limitação fica
  explícita; não se guardam imagens/tokens/filas em IndexedDB para contorná-la.
- Hashes vinculam os bytes e ajustes usados, mas não comprovam autenticidade do
  documento nem precisão clínica. Sem imagem remota, não é possível reconstruí-la
  a partir do registro. Não há promessa de apagamento seguro de memória/OS.
- O OCR novo não usa rascunhos locais. O OCR legado continua com seu fluxo local
  original, agora usando o mesmo helper de worker; não houve migração automática.
- Apenas PNG/JPEG/WebP, até 10 MB, lado até 8000 px e 16 MP após decodificação.
  Limites não equivalem a scanner de arquivos hostis. No máximo 20 candidatos
  conservadores por OCR; duplicatas ficam separadas, unidades não são convertidas,
  campos omitidos continuam pendentes. PDF, HEIC, manuscrito e EXIF não suportados
  nesta entrega. Ruído/fotografia real podem produzir erros adicionais.
- Câmera usa permissão do usuário e `camera=(self)`, nunca origem externa. Requer
  suporte/contexto seguro; loopback foi o contexto testado. Câmera física, iOS/Safari
  e Android não foram verificados. Negação/falta de dispositivo orienta usar arquivo.

## Implementação e segurança

Migração aditiva `20261102233142_document_observations.sql`: tabela de proveniência
com RLS, sem INSERT/UPDATE/DELETE do cliente, guardas de alteração/truncate e
auditoria minimizada. RPC com search_path vazio, autorização explícita e retry
comparando todo o payload/proveniência; não permite anexar metadados retroativamente
a evento manual existente. Histórico remoto inspecionado antes da aplicação;
oito versões locais/remotas correspondem. Nenhum bucket criado; imagens não passam
pela API. `source_type=document` sozinho não comprova proveniência: a referência
persistida está vinculada pelo UUID em `document_observation_sources`.

Antes/depois da migração: preservados 71 eventos, 50 episódios e hash dos eventos
`caf86e7a9770e6727939ebcaef7c2761`. Não houve escrita em dados antigos. Auditoria
continua no mesmo banco, sem resistência a superadmin/exclusão de projeto; os
bloqueios de backup hospedado, MFA institucional, revisão independente e governança
de [security-foundation.md](security-foundation.md) permanecem obrigatórios.

## Testes reais versus mocks

- `node --test tests/*.test.js`: parser/validação puros, cancelamento de worker com
  **mock**, API com store **mock** e fila com falha/resposta perdida **mockadas**.
  Esses testes não demonstram precisão do OCR. O teste novo também encontrou e
  corrigiu exposição potencial de mensagens internas ApiError; respostas públicas
  agora usam uma lista fixa por status, sem detalhes de origem.
- `node scripts/test-restore.js`: banco PostgreSQL WASM isolado, migrações e SQL de
  RLS/MFA/imutabilidade/rollback/retry. Não é backup/restauração hospedada.
- `node --env-file=.env.test scripts/test-hosted-protected.js`: Auth/MFA/RPC reais
  do desenvolvimento com fontes de metadados sintéticas (hashes de fixture,
  **sem OCR nesse teste**). Testa anônimo/AAL1/AAL2/leitor/clínico/admin, isolamento,
  mutação direta negada, fechamento e retry após fechamento.
- `node --env-file=.env.test scripts/test-remote-browser.js`: **Chrome e Tesseract
  5.1.1/por reais**, canvas e arquivos reais, Auth/API/RPC reais. O helper
  `test-document-browser-flow.js` gera e guarda imagens apenas sintéticas sob pasta
  única `.test-artifacts/ocr-fixtures-*`, ignorada pelo Git. Relatório sanitizado em
  `.test-artifacts/document-ocr-report.json`. Perda da resposta HTTP após commit e
  uma falha de leitura são injetadas. Em testes separados, inicialização do worker
  e permissão de câmera são mockadas para falhar; nos oito casos de extração e no
  fluxo persistido, OCR e banco são reais.
- Câmera: API nativa com **dispositivo sintético do Chrome**, captura de quadro e
  encerramento de tracks reais desse dispositivo virtual. Não foi câmera física.
  Mobile: viewport Chrome de 390×844, não dispositivo móvel físico.
  Ambiente efetivamente observado: Chrome headless **155.0.8059.85**, Windows
  (`win32`). Não há evidência de execução física em Android/iOS ou Safari/Firefox.

| Imagem efetivamente exercitada | Formato | Resultado observado |
| --- | --- | --- |
| Laudo limpo com peso, creatinina e pH | PNG/JPEG/WebP | Três candidatos; peso 72 kg e creatinina 1.00 mg/dL conferidos, horários vazios |
| Painel de monitor sintético escuro | PNG | Dois candidatos de três rótulos; PAS 120 mmHg conferida. Extração parcial, não foi preenchido o ausente |
| Creatinina em umol/L e peso em g | PNG | Valores/unidades preservados; nenhuma conversão automática |
| Unidade ausente e exame sem resultado | PNG | Um candidato com unidade pendente; creatinina não inventada |
| Imagem reduzida, borrada e com ruído determinístico | JPEG | Três candidatos; valores conhecidos de peso/creatinina recuperados nesta imagem, sem garantia para outros ruídos |
| Laudo girado 90°, corrigido e recortado | PNG | Três candidatos após ajuste; rotação/crop registrados na proveniência |

O navegador verifica ainda cancelamento, PNG inválido, revisão invalidada por
contexto, envio parcial, retry sem duplicação, imagens descartadas, proveniência
recuperada por outra sessão autorizada, leitor sem escrita, isolamento entre
unidades, drafts inalterados, ausência de HTTP externo/log de conteúdo e CG remoto
somente após revisão completa. OCR bem-sucedido não é um teste clínico aprovado.

### Evidência registrada em 2026-11-02

- **76 unitários/integração local aprovados**, zero falhos/ignorados na suíte Node.
- SQL/restore WASM aprovado: preparação 5615 ms, snapshot 130 ms,
  restauração/verificação 1575 ms; zero registros comprometidos antes da cópia
  perdidos. Não é backup hospedado.
- Suíte hospedada de MFA/RLS/documento/correções/auditoria aprovada; somente novos
  episódios/fatores próprios usados e encerrados/removidos, eventos sintéticos mantidos.
- Suíte Chrome completa aprovada. Gravação final usou realmente a imagem girada e
  recortada: proveniência persistiu rotação 270°, recorte x=20/y=90/1160×290 e hashes
  distintos do original/ajustado. Unidades incompatíveis e unidade omitida foram
  bloqueadas na UI antes de qualquer gravação. Retry de resposta perdida não duplicou
  as duas observações ou as duas origens.
- Os oito arquivos de fixture foram efetivamente gerados em
  `.test-artifacts/ocr-fixtures-*` (pasta única indicada no relatório da execução).
  São artefatos locais ignorados; o gerador versionado permite reproduzi-los.
- Leitura do monitor foi parcial: FC/PAS viraram candidatos, SpO₂ não virou
  candidato. Isso foi registrado como limitação de extração, sem inventar o campo.
- Falhas operacionais de OCR, rejeição de arquivo, indisponibilidade de leitura e
  perda de resposta foram exercitadas; testes reais não substituem validação clínica.
