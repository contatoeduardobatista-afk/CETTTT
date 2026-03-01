# Servidor de Assinatura Digital ICP-Brasil

## Como hospedar no Railway (gratuito)

### Passo 1 — Criar conta
Acesse https://railway.app e crie uma conta gratuita com seu GitHub.

### Passo 2 — Criar novo projeto
1. Clique em "New Project"
2. Escolha "Deploy from GitHub repo"
3. Faça upload dos arquivos server.js e package.json para um repositório GitHub
4. Selecione o repositório

### Passo 3 — Deploy automático
O Railway detecta automaticamente o Node.js e faz o deploy.
Após o deploy, você receberá uma URL como:
https://seu-projeto.up.railway.app

### Passo 4 — Configurar no Lovable
Cole este prompt no Lovable:

"Na edge function de assinatura do orçamento, troque a lógica atual para:
1. Buscar o .pfx salvo no storage e converter para base64
2. Buscar a senha descriptografada do banco
3. Fazer POST para https://SEU-SERVIDOR.up.railway.app/sign-pdf com:
   - pfxBase64: [certificado em base64]
   - pfxPassword: [senha do certificado]
   - pdf: [arquivo PDF do orçamento]
4. Receber o PDF assinado em base64 e disponibilizar para download"

## Rotas disponíveis

### POST /sign-pdf
Assina um PDF com o certificado .pfx

Parâmetros (multipart/form-data):
- pdf: arquivo PDF (obrigatório)
- pfx: arquivo .pfx (opcional se usar pfxBase64)
- pfxBase64: certificado em base64 (opcional se usar pfx)
- pfxPassword: senha do certificado

Retorno:
{
  "success": true,
  "signedPdfBase64": "...",
  "signatureBase64": "...",
  "signerInfo": {
    "name": "Nome do Titular",
    "validTo": "31/12/2025",
    "signedAt": "01/03/2026 17:30:00"
  }
}

### GET /health
Verifica se o servidor está funcionando.

## Segurança
- O servidor nunca armazena o certificado ou senha
- Cada requisição processa e descarta os dados
- Use HTTPS (Railway fornece automaticamente)
- Recomenda-se adicionar uma variável de ambiente API_SECRET
  e validar em todas as requisições
