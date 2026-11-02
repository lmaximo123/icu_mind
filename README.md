# Osler (antigo ICU-Mind)

Projeto de apoio clínico para ambiente de UTI.

## Desenvolvimento

Instale dependências fixadas e gere os ativos locais antes de servir a interface:
`npm ci --ignore-scripts` e `npm run build`. CSS, ícones, worker/modelo OCR e WASM
são servidos pela própria aplicação; não há carregamento de scripts por CDN.
Modelo de ameaças, controles e limitações: [docs/security-foundation.md](docs/security-foundation.md).

Frontend estático: `python3 -m http.server 8000 --bind 127.0.0.1`.
Testes JavaScript (Node.js >=22): `node --test tests/*.test.js`.
Testes PostgreSQL/RLS (Docker): `bash scripts/test-db.sh`.
Infraestrutura Supabase, API autenticada e integração optativa:
[supabase/README.md](supabase/README.md).

## Publicação
Este repositório será conectado à Vercel para gerar uma prévia web.

## Aviso importante
Protótipo em desenvolvimento. Não utilizar para decisões clínicas reais nem inserir dados identificáveis de pacientes. Antes de uso clínico, são necessários validação clínica, autenticação, controle de acesso, armazenamento seguro e testes completos.
