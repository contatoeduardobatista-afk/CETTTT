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
  const { width, height } = lastPage.getSize();
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
  const sealY = 8;
  const sealW = width - 40;
  const sealH = 105;

  // === MARCA DAGUA DIAGONAL ===
  const wmTexts = ['ASSINADO DIGITALMENTE', 'ICP-BRASIL', 'DOCUMENTO OFICIAL'];
  for (let wx = 30; wx < width + 100; wx += 110) {
    for (let wy = -10; wy < height + 20; wy += 50) {
      const idx = Math.abs(Math.floor(wx / 110 + wy / 50) % 3);
      lastPage.drawText(wmTexts[idx], {
        x: wx, y: wy, size: 6, font,
        color: rgb(0.82, 0.88, 0.95),
        rotate: { type: 'degrees', angle: 35 },
        opacity: 0.15,
      });
    }
  }

  // === SOMBRA ===
  lastPage.drawRectangle({
    x: sealX + 3, y: sealY - 3,
    width: sealW, height: sealH,
    color: rgb(0.50, 0.50, 0.55),
    opacity: 0.20,
  });

  // === FUNDO BRANCO SOLIDO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    color: rgb(0.97, 0.98, 1.0),
  });

  // === FAIXA LATERAL ESQUERDA AZUL (decorativa) ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: 6, height: sealH,
    color: rgb(0.0, 0.18, 0.42),
  });

  // === PADRAO GUILLOCHE SUTIL (linhas finas no fundo) ===
  for (let row = 0; row < 10; row++) {
    const baseY = sealY + 14 + row * 8;
    for (let col = 0; col < 80; col++) {
      const wave = Math.sin((col + row * 2.5) * 0.35) * 1.8;
      lastPage.drawRectangle({
        x: sealX + 8 + col * (sealW - 16) / 80,
        y: baseY + wave,
        width: (sealW - 16) / 80 + 0.3,
        height: 0.35,
        color: rgb(0.70, 0.78, 0.90),
        opacity: 0.25,
      });
    }
  }

  // === BORDA EXTERNA AZUL ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    borderColor: rgb(0.0, 0.18, 0.42),
    borderWidth: 2.0,
    color: rgb(0, 0, 0, 0),
  });

  // === BORDA INTERNA DOURADA ===
  lastPage.drawRectangle({
    x: sealX + 8, y: sealY + 14,
    width: sealW - 16, height: sealH - 30,
    borderColor: rgb(0.72, 0.58, 0.08),
    borderWidth: 0.6,
    color: rgb(0, 0, 0, 0),
    opacity: 0.5,
  });

  // === CANTOS DECORATIVOS DOURADOS ===
  const corners = [
    [sealX + 2, sealY + sealH - 12],
    [sealX + sealW - 16, sealY + sealH - 12],
  ];
  for (const [cx, cy] of corners) {
    for (let i = 0; i < 4; i++) {
      lastPage.drawRectangle({ x: cx + i*3, y: cy, width: 2, height: 5, color: rgb(0.72, 0.58, 0.08), opacity: 0.6 });
      lastPage.drawRectangle({ x: cx, y: cy - i*3, width: 5, height: 2, color: rgb(0.72, 0.58, 0.08), opacity: 0.6 });
    }
  }

  // === HEADER AZUL ESCURO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 22,
    width: sealW, height: 22,
    color: rgb(0.0, 0.18, 0.42),
  });
  lastPage.drawText('DOCUMENTO ASSINADO DIGITALMENTE', {
    x: sealX + 14, y: sealY + sealH - 14,
    size: 8.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // === BADGE ICP-BRASIL ===
  lastPage.drawRectangle({
    x: sealX + sealW - 76, y: sealY + sealH - 20,
    width: 72, height: 18,
    color: rgb(0.0, 0.48, 0.22),
  });
  lastPage.drawText('ICP-Brasil', {
    x: sealX + sealW - 61, y: sealY + sealH - 13,
    size: 7.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // === LINHA DOURADA SEPARADORA ===
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 23,
    width: sealW, height: 1.5,
    color: rgb(0.80, 0.65, 0.10),
  });

  // === ESCUDO DECORATIVO ===
  lastPage.drawRectangle({
    x: sealX + 14, y: sealY + 50,
    width: 20, height: 22,
    color: rgb(0.0, 0.18, 0.42),
    borderColor: rgb(0.72, 0.58, 0.08),
    borderWidth: 0.8,
  });
  lastPage.drawRectangle({
    x: sealX + 18, y: sealY + 44,
    width: 12, height: 8,
    color: rgb(0.0, 0.18, 0.42),
  });
  lastPage.drawText('OK', {
    x: sealX + 17, y: sealY + 57,
    size: 8, font: fontBold,
    color: rgb(0.60, 0.95, 0.30),
  });

  // === DADOS DO SIGNATARIO ===
  lastPage.drawText('Assinado por:', {
    x: sealX + 42, y: sealY + 78,
    size: 6, font: fontBold,
    color: rgb(0.40, 0.40, 0.40),
  });
  lastPage.drawText(displayName, {
    x: sealX + 42, y: sealY + 67,
    size: 8, font: fontBold,
    color: rgb(0.0, 0.18, 0.42),
  });
  if (docNumber) {
    lastPage.drawText(docNumber, {
      x: sealX + 42, y: sealY + 56,
      size: 6.5, font,
      color: rgb(0.20, 0.20, 0.20),
    });
  }
  lastPage.drawText('Data e hora: ' + (dateStr || ''), {
    x: sealX + 42, y: sealY + 45,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });
  lastPage.drawText('Certificado valido ate: ' + (validTo || ''), {
    x: sealX + 42, y: sealY + 35,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });

  // === DIVISOR VERTICAL ===
  lastPage.drawRectangle({
    x: sealX + sealW - 158, y: sealY + 26,
    width: 1.2, height: sealH - 52,
    color: rgb(0.72, 0.58, 0.08),
    opacity: 0.45,
  });

  // === COLUNA VERIFICACAO ===
  lastPage.drawText('Como verificar:', {
    x: sealX + sealW - 150, y: sealY + 78,
    size: 6, font: fontBold,
    color: rgb(0.40, 0.40, 0.40),
  });
  lastPage.drawText('Acesse o portal oficial do ITI', {
    x: sealX + sealW - 150, y: sealY + 67,
    size: 6, font,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawText('e valide este documento em:', {
    x: sealX + sealW - 150, y: sealY + 57,
    size: 6, font,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawRectangle({
    x: sealX + sealW - 151, y: sealY + 42,
    width: 112, height: 14,
    color: rgb(0.0, 0.18, 0.42),
  });
  lastPage.drawText('validar.iti.gov.br', {
    x: sealX + sealW - 143, y: sealY + 46,
    size: 7.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // === MICROPONTILHADO NOS CANTOS ===
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 3; j++) {
      lastPage.drawRectangle({
        x: sealX + 10 + i * 4.5, y: sealY + 17 + j * 4,
        width: 1.2, height: 1.2,
        color: rgb(0.72, 0.58, 0.08), opacity: 0.20,
      });
      lastPage.drawRectangle({
        x: sealX + sealW - 55 + i * 4.5, y: sealY + 17 + j * 4,
        width: 1.2, height: 1.2,
        color: rgb(0.72, 0.58, 0.08), opacity: 0.20,
      });
    }
  }

  // === LINHA DOURADA ANTES DO RODAPE ===
  lastPage.drawRectangle({
    x: sealX + 6, y: sealY + 13,
    width: sealW - 12, height: 0.6,
    color: rgb(0.72, 0.58, 0.08), opacity: 0.55,
  });

  // === RODAPE ESCURO ===
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: 12,
    color: rgb(0.05, 0.10, 0.22),
  });
  lastPage.drawText('Conforme MP 2.200-2/2001 e Lei 14.063/2020  |  Infraestrutura de Chaves Publicas Brasileira (ICP-Brasil)  |  Validade juridica garantida', {
    x: sealX + 12, y: sealY + 4,
    size: 5, font,
    color: rgb(0.72, 0.78, 0.90),
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
