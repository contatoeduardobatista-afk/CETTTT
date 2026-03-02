const express = require('express');
const forge = require('node-forge');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { SignPdf } = require('@signpdf/signpdf');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const { P12Signer } = require('@signpdf/signer-p12');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Desenha o selo institucional ICP-Brasil
async function drawSignatureSeal(pdfDoc, signerName, validTo, dateStr) {
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Extrair nome limpo e CNPJ/CPF do signerName
  // Ex: "EB PRODUCAO E SOLUCOES INTEGRADAS LTDA:33033746000150"
  let displayName = signerName;
  let docNumber = '';
  if (signerName.includes(':')) {
    const parts = signerName.split(':');
    displayName = parts[0].trim();
    const raw = parts[1].trim();
    // Formatar CNPJ ou CPF
    if (raw.length === 14) {
      docNumber = 'CNPJ: ' + raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    } else if (raw.length === 11) {
      docNumber = 'CPF: ' + raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else {
      docNumber = raw;
    }
  }

  const sealX = 25;
  const sealY = 10;
  const sealW = width - 50;
  const sealH = 90;

  // --- Sombra sutil ---
  lastPage.drawRectangle({
    x: sealX + 2, y: sealY - 2,
    width: sealW, height: sealH,
    color: rgb(0.80, 0.80, 0.80),
    opacity: 0.4,
  });

  // --- Fundo principal branco ---
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.0, 0.20, 0.45),
    borderWidth: 1.5,
  });

  // --- Faixa azul escura no topo ---
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 20,
    width: sealW, height: 20,
    color: rgb(0.0, 0.20, 0.45),
  });

  // --- Titulo na faixa azul ---
  lastPage.drawText('DOCUMENTO ASSINADO DIGITALMENTE', {
    x: sealX + 12, y: sealY + sealH - 14,
    size: 8, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // --- Badge ICP-Brasil (canto direito da faixa) ---
  lastPage.drawRectangle({
    x: sealX + sealW - 80, y: sealY + sealH - 18,
    width: 76, height: 16,
    color: rgb(0.0, 0.55, 0.27),
  });
  lastPage.drawText('ICP-Brasil', {
    x: sealX + sealW - 64, y: sealY + sealH - 12,
    size: 7, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // --- Linha dourada separadora ---
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 22,
    width: sealW, height: 2,
    color: rgb(0.75, 0.60, 0.10),
  });

  // --- Coluna esquerda: dados do signatario ---
  lastPage.drawText('Assinado por:', {
    x: sealX + 12, y: sealY + 57,
    size: 6.5, font: fontBold,
    color: rgb(0.30, 0.30, 0.30),
  });
  lastPage.drawText(displayName, {
    x: sealX + 12, y: sealY + 47,
    size: 7.5, font: fontBold,
    color: rgb(0.0, 0.20, 0.45),
  });

  if (docNumber) {
    lastPage.drawText(docNumber, {
      x: sealX + 12, y: sealY + 37,
      size: 6.5, font,
      color: rgb(0.20, 0.20, 0.20),
    });
  }

  lastPage.drawText('Data e hora: ' + dateStr, {
    x: sealX + 12, y: sealY + 26,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });

  lastPage.drawText('Certificado valido ate: ' + validTo, {
    x: sealX + 12, y: sealY + 16,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });

  // --- Linha vertical divisoria ---
  lastPage.drawRectangle({
    x: sealX + sealW - 155, y: sealY + 8,
    width: 1, height: sealH - 30,
    color: rgb(0.80, 0.80, 0.80),
  });

  // --- Coluna direita: instrucoes de verificacao ---
  lastPage.drawText('Como verificar:', {
    x: sealX + sealW - 148, y: sealY + 57,
    size: 6.5, font: fontBold,
    color: rgb(0.30, 0.30, 0.30),
  });
  lastPage.drawText('Acesse o portal oficial do ITI', {
    x: sealX + sealW - 148, y: sealY + 47,
    size: 6, font,
    color: rgb(0.20, 0.20, 0.20),
  });
  lastPage.drawText('e valide este documento:', {
    x: sealX + sealW - 148, y: sealY + 38,
    size: 6, font,
    color: rgb(0.20, 0.20, 0.20),
  });
  lastPage.drawText('validar.iti.gov.br', {
    x: sealX + sealW - 148, y: sealY + 26,
    size: 7, font: fontBold,
    color: rgb(0.0, 0.35, 0.70),
  });

  // --- Rodape do selo ---
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: 10,
    color: rgb(0.95, 0.95, 0.95),
  });
  lastPage.drawText('Conforme MP 2.200-2/2001 e Lei 14.063/2020 - Infraestrutura de Chaves Publicas Brasileira (ICP-Brasil)', {
    x: sealX + 12, y: sealY + 3,
    size: 5, font,
    color: rgb(0.45, 0.45, 0.45),
  });
}

app.post('/sign-pdf', upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'pfx', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files['pdf']) {
      return res.status(400).json({ error: 'Arquivo PDF nao fornecido' });
    }
    const pdfBuffer = req.files['pdf'][0].buffer;

    let pfxBuffer;
    if (req.files['pfx']) {
      pfxBuffer = req.files['pfx'][0].buffer;
    } else if (req.body.pfxBase64) {
      pfxBuffer = Buffer.from(req.body.pfxBase64, 'base64');
    } else {
      return res.status(400).json({ error: 'Certificado .pfx nao fornecido' });
    }

    const password = req.body.pfxPassword || '';
    let signerName = 'Assinante';
    let validTo = '';

    try {
      const pfxDer = forge.util.createBuffer(pfxBuffer.toString('binary'));
      const pfxAsn1 = forge.asn1.fromDer(pfxDer);
      const pfxObj = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);
      const certBags = pfxObj.getBags({ bagType: forge.pki.oids.certBag });
      const certBagList = certBags[forge.pki.oids.certBag];
      if (certBagList && certBagList.length > 0) {
        const cert = certBagList[0].cert;
        signerName = cert.subject.getField('CN')?.value || 'Assinante';
        validTo = cert.validity.notAfter.toLocaleDateString('pt-BR');
        if (new Date() > cert.validity.notAfter) {
          return res.status(400).json({ error: 'Certificado expirado em ' + validTo });
        }
      }
    } catch (e) {
      return res.status(400).json({ error: 'Senha incorreta ou .pfx invalido: ' + e.message });
    }

    const dateStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Desenhar selo institucional
    await drawSignatureSeal(pdfDoc, signerName, validTo, dateStr);

    // Adicionar placeholder de assinatura
    await pdflibAddPlaceholder({
      pdfDoc,
      reason: 'Assinado digitalmente com certificado ICP-Brasil',
      contactInfo: '',
      name: signerName,
      location: 'Brasil',
      signatureLength: 32768,
    });

    // Salvar e assinar
    const pdfWithPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    const signPdf = new SignPdf();
    const signer = new P12Signer(pfxBuffer, { passphrase: password });
    const signedPdf = await signPdf.sign(pdfWithPlaceholder, signer);

    res.json({
      success: true,
      signedPdfBase64: Buffer.from(signedPdf).toString('base64'),
      signerInfo: {
        name: signerName,
        validTo,
        signedAt: dateStr,
      },
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao assinar: ' + error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
