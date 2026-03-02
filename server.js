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

async function drawSignatureSeal(pdfDoc, signerName, validTo, dateStr) {
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let displayName = signerName || 'Assinante';
  let docNumber = '';
  if (signerName && signerName.includes(':')) {
    const parts = signerName.split(':');
    displayName = parts[0].trim();
    const raw = (parts[1] || '').trim();
    if (raw.length === 14) {
      docNumber = 'CNPJ: ' + raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    } else if (raw.length === 11) {
      docNumber = 'CPF: ' + raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else {
      docNumber = raw;
    }
  }

  const sealX = 20;
  const sealY = 10;
  const sealW = width - 40;
  const sealH = 110;

  // === FUNDO BRANCO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    color: rgb(1, 1, 1),
  });

  // === BORDA AZUL ESCURA ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    borderColor: rgb(0.0, 0.20, 0.45),
    borderWidth: 2,
    color: rgb(1, 1, 1),
  });

  // === FAIXA AZUL ESCURA NO TOPO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 24,
    width: sealW, height: 24,
    color: rgb(0.0, 0.20, 0.45),
  });

  // Titulo na faixa
  lastPage.drawText('DOCUMENTO ASSINADO DIGITALMENTE', {
    x: sealX + 12, y: sealY + sealH - 16,
    size: 9, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Badge ICP-Brasil verde
  lastPage.drawRectangle({
    x: sealX + sealW - 82, y: sealY + sealH - 22,
    width: 78, height: 20,
    color: rgb(0.0, 0.52, 0.24),
  });
  lastPage.drawText('ICP-Brasil', {
    x: sealX + sealW - 67, y: sealY + sealH - 14,
    size: 8, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // === LINHA DOURADA ===
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 26,
    width: sealW, height: 2,
    color: rgb(0.75, 0.60, 0.10),
  });

  // === COLUNA ESQUERDA - DADOS DO SIGNATARIO ===
  lastPage.drawText('Assinado por:', {
    x: sealX + 12, y: sealY + 78,
    size: 7, font: fontBold,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawText(displayName, {
    x: sealX + 12, y: sealY + 65,
    size: 8.5, font: fontBold,
    color: rgb(0.0, 0.20, 0.45),
  });
  if (docNumber) {
    lastPage.drawText(docNumber, {
      x: sealX + 12, y: sealY + 53,
      size: 7, font,
      color: rgb(0.15, 0.15, 0.15),
    });
  }
  lastPage.drawText('Data e hora: ' + (dateStr || ''), {
    x: sealX + 12, y: sealY + 41,
    size: 7, font,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Certificado valido ate: ' + (validTo || ''), {
    x: sealX + 12, y: sealY + 29,
    size: 7, font,
    color: rgb(0.15, 0.15, 0.15),
  });

  // === LINHA DIVISORIA VERTICAL ===
  lastPage.drawRectangle({
    x: sealX + sealW - 170, y: sealY + 20,
    width: 1, height: sealH - 46,
    color: rgb(0.80, 0.80, 0.80),
  });

  // === COLUNA DIREITA - COMO VERIFICAR ===
  lastPage.drawText('Como verificar:', {
    x: sealX + sealW - 162, y: sealY + 78,
    size: 7, font: fontBold,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawText('Acesse o portal oficial do ITI', {
    x: sealX + sealW - 162, y: sealY + 65,
    size: 7, font,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('e valide este documento:', {
    x: sealX + sealW - 162, y: sealY + 53,
    size: 7, font,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('validar.iti.gov.br', {
    x: sealX + sealW - 162, y: sealY + 38,
    size: 8.5, font: fontBold,
    color: rgb(0.0, 0.35, 0.70),
  });

  // === LINHA DIVISORIA HORIZONTAL ANTES DO RODAPE ===
  lastPage.drawRectangle({
    x: sealX, y: sealY + 18,
    width: sealW, height: 0.8,
    color: rgb(0.75, 0.75, 0.75),
  });

  // === RODAPE CINZA CLARO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: 18,
    color: rgb(0.95, 0.95, 0.95),
  });
  lastPage.drawText('Conforme MP 2.200-2/2001 e Lei 14.063/2020 - Infraestrutura de Chaves Publicas Brasileira (ICP-Brasil)', {
    x: sealX + 12, y: sealY + 6,
    size: 5.5, font,
    color: rgb(0.40, 0.40, 0.40),
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

    await drawSignatureSeal(pdfDoc, signerName, validTo, dateStr);

    await pdflibAddPlaceholder({
      pdfDoc,
      reason: 'Assinado digitalmente com certificado ICP-Brasil',
      contactInfo: '',
      name: signerName,
      location: 'Brasil',
      signatureLength: 32768,
    });

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
