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

  // Extrair nome e documento
  let displayName = signerName;
  let docNumber = '';
  if (signerName.includes(':')) {
    const parts = signerName.split(':');
    displayName = parts[0].trim();
    const raw = parts[1].trim();
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
  const sealH = 110;

  // =============================================
  // MARCA DAGUA DIAGONAL - fundo de seguranca
  // =============================================
  const watermarkTexts = ['ASSINADO DIGITALMENTE', 'ICP-BRASIL', 'DOCUMENTO OFICIAL'];
  let wx = 40;
  while (wx < width + 100) {
    let wy = -20;
    while (wy < height + 20) {
      const idx = Math.abs(Math.floor((wx * wy) % 3)); const txt = watermarkTexts[idx] || 'ICP-BRASIL';
      lastPage.drawText(txt, {
        x: wx, y: wy,
        size: 6, font,
        color: rgb(0.88, 0.92, 0.97),
        rotate: { type: 'degrees', angle: 35 },
        opacity: 0.18,
      });
      wy += 55;
    }
    wx += 120;
  }

  // =============================================
  // SOMBRA EXTERNA
  // =============================================
  lastPage.drawRectangle({
    x: sealX + 3, y: sealY - 3,
    width: sealW, height: sealH,
    color: rgb(0.55, 0.55, 0.60),
    opacity: 0.25,
  });

  // =============================================
  // FUNDO PRINCIPAL com gradiente simulado
  // =============================================
  // Camadas de gradiente (escuro para claro de baixo para cima)
  const gradLayers = 18;
  for (let i = 0; i < gradLayers; i++) {
    const t = i / gradLayers;
    const r = 0.94 + t * 0.05;
    const g = 0.96 + t * 0.03;
    const b2 = 1.0;
    lastPage.drawRectangle({
      x: sealX, y: sealY + (i * sealH / gradLayers),
      width: sealW, height: sealH / gradLayers + 1,
      color: rgb(r, g, b2),
    });
  }

  // =============================================
  // PADRAO GUILLOCHE (linhas onduladas de seguranca)
  // =============================================
  // Linhas horizontais onduladas simuladas com pequenos retangulos
  for (let row = 0; row < 8; row++) {
    const baseY = sealY + 12 + row * 11;
    for (let col = 0; col < 60; col++) {
      const wave = Math.sin((col + row * 3) * 0.4) * 2.5;
      lastPage.drawRectangle({
        x: sealX + 5 + col * (sealW - 10) / 60,
        y: baseY + wave,
        width: (sealW - 10) / 60 + 0.5,
        height: 0.4,
        color: rgb(0.75, 0.82, 0.92),
        opacity: 0.35,
      });
    }
  }

  // =============================================
  // BORDA EXTERNA DUPLA
  // =============================================
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    borderColor: rgb(0.0, 0.18, 0.42),
    borderWidth: 2.5,
    color: rgb(0, 0, 0, 0),
  });
  lastPage.drawRectangle({
    x: sealX + 4, y: sealY + 4,
    width: sealW - 8, height: sealH - 8,
    borderColor: rgb(0.72, 0.58, 0.08),
    borderWidth: 0.8,
    color: rgb(0, 0, 0, 0),
  });

  // =============================================
  // BORDA COM PADRAO GEOMETRICO (cantos decorativos)
  // =============================================
  // Canto superior esquerdo
  for (let i = 0; i < 5; i++) {
    lastPage.drawRectangle({
      x: sealX + 6 + i * 3, y: sealY + sealH - 10,
      width: 2, height: 6,
      color: rgb(0.72, 0.58, 0.08),
      opacity: 0.7,
    });
    lastPage.drawRectangle({
      x: sealX + 6, y: sealY + sealH - 10 - i * 3,
      width: 6, height: 2,
      color: rgb(0.72, 0.58, 0.08),
      opacity: 0.7,
    });
  }
  // Canto superior direito
  for (let i = 0; i < 5; i++) {
    lastPage.drawRectangle({
      x: sealX + sealW - 20 + i * 3, y: sealY + sealH - 10,
      width: 2, height: 6,
      color: rgb(0.72, 0.58, 0.08),
      opacity: 0.7,
    });
    lastPage.drawRectangle({
      x: sealX + sealW - 14, y: sealY + sealH - 10 - i * 3,
      width: 6, height: 2,
      color: rgb(0.72, 0.58, 0.08),
      opacity: 0.7,
    });
  }

  // =============================================
  // FAIXA HEADER - azul escuro premium
  // =============================================
  // Gradiente da faixa (camadas)
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    lastPage.drawRectangle({
      x: sealX, y: sealY + sealH - 22 + i * 2.2,
      width: sealW, height: 2.5,
      color: rgb(0.0 + t * 0.05, 0.18 + t * 0.08, 0.42 + t * 0.10),
    });
  }

  // Texto titulo
  lastPage.drawText('DOCUMENTO ASSINADO DIGITALMENTE', {
    x: sealX + 14, y: sealY + sealH - 15,
    size: 8.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // =============================================
  // BADGE ICP-BRASIL (canto direito premium)
  // =============================================
  // Sombra do badge
  lastPage.drawRectangle({
    x: sealX + sealW - 78, y: sealY + sealH - 21,
    width: 74, height: 19,
    color: rgb(0.0, 0.25, 0.10),
    opacity: 0.4,
  });
  // Badge verde escuro
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    lastPage.drawRectangle({
      x: sealX + sealW - 77, y: sealY + sealH - 20 + i * 3.6,
      width: 73, height: 4,
      color: rgb(0.0, 0.42 + t * 0.13, 0.20 + t * 0.07),
    });
  }
  lastPage.drawText('ICP-Brasil', {
    x: sealX + sealW - 62, y: sealY + sealH - 13,
    size: 7.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // =============================================
  // LINHA DOURADA SEPARADORA (tripla)
  // =============================================
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 24,
    width: sealW, height: 1.0,
    color: rgb(0.85, 0.70, 0.12),
  });
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 25.5,
    width: sealW, height: 0.5,
    color: rgb(0.95, 0.85, 0.30),
    opacity: 0.6,
  });
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 27,
    width: sealW, height: 0.4,
    color: rgb(0.72, 0.55, 0.05),
    opacity: 0.4,
  });

  // =============================================
  // ICONE DE ESCUDO (simulado com geometria)
  // =============================================
  const shieldX = sealX + 14;
  const shieldY = sealY + 52;
  // Corpo do escudo
  lastPage.drawRectangle({
    x: shieldX, y: shieldY,
    width: 18, height: 20,
    color: rgb(0.0, 0.18, 0.42),
    borderColor: rgb(0.72, 0.58, 0.08),
    borderWidth: 0.8,
  });
  // Ponta inferior do escudo
  lastPage.drawRectangle({
    x: shieldX + 4, y: shieldY - 6,
    width: 10, height: 8,
    color: rgb(0.0, 0.18, 0.42),
  });
  // Letra V no escudo (checkmark simulado)
  lastPage.drawText('OK', {
    x: shieldX + 3, y: shieldY + 7,
    size: 8, font: fontBold,
    color: rgb(0.72, 0.90, 0.30),
  });

  // =============================================
  // DADOS DO SIGNATARIO
  // =============================================
  lastPage.drawText('Assinado por:', {
    x: sealX + 40, y: sealY + 78,
    size: 6, font: fontBold,
    color: rgb(0.35, 0.35, 0.35),
  });
  lastPage.drawText(displayName || 'Assinante', {
    x: sealX + 40, y: sealY + 67,
    size: 8, font: fontBold,
    color: rgb(0.0, 0.18, 0.42),
  });
  if (docNumber) {
    lastPage.drawText(docNumber || '', {
      x: sealX + 40, y: sealY + 56,
      size: 6.5, font,
      color: rgb(0.20, 0.20, 0.20),
    });
  }
  lastPage.drawText('Data e hora: ' + (dateStr || ''), {
    x: sealX + 40, y: sealY + 45,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });
  lastPage.drawText('Certificado valido ate: ' + (validTo || ''), {
    x: sealX + 40, y: sealY + 35,
    size: 6.5, font,
    color: rgb(0.20, 0.20, 0.20),
  });

  // =============================================
  // DIVISOR VERTICAL DOURADO
  // =============================================
  lastPage.drawRectangle({
    x: sealX + sealW - 160, y: sealY + 28,
    width: 1.5, height: sealH - 58,
    color: rgb(0.72, 0.58, 0.08),
    opacity: 0.5,
  });

  // =============================================
  // COLUNA VERIFICACAO
  // =============================================
  lastPage.drawText('Como verificar:', {
    x: sealX + sealW - 152, y: sealY + 78,
    size: 6, font: fontBold,
    color: rgb(0.35, 0.35, 0.35),
  });
  lastPage.drawText('Acesse o portal oficial do ITI', {
    x: sealX + sealW - 152, y: sealY + 67,
    size: 6, font,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawText('e valide este documento em:', {
    x: sealX + sealW - 152, y: sealY + 57,
    size: 6, font,
    color: rgb(0.25, 0.25, 0.25),
  });
  // Link destacado
  lastPage.drawRectangle({
    x: sealX + sealW - 153, y: sealY + 43,
    width: 110, height: 14,
    color: rgb(0.0, 0.18, 0.42),
    borderColor: rgb(0.72, 0.58, 0.08),
    borderWidth: 0.5,
  });
  lastPage.drawText('validar.iti.gov.br', {
    x: sealX + sealW - 145, y: sealY + 47,
    size: 7.5, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // =============================================
  // LINHA DOURADA ANTES DO RODAPE
  // =============================================
  lastPage.drawRectangle({
    x: sealX + 4, y: sealY + 14,
    width: sealW - 8, height: 0.6,
    color: rgb(0.72, 0.58, 0.08),
    opacity: 0.6,
  });

  // =============================================
  // RODAPE COM REFERENCIA LEGAL
  // =============================================
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: 13,
    color: rgb(0.06, 0.10, 0.22),
  });
  lastPage.drawText('Conforme MP 2.200-2/2001 e Lei 14.063/2020  |  Infraestrutura de Chaves Publicas Brasileira (ICP-Brasil)  |  Validade juridica garantida', {
    x: sealX + 12, y: sealY + 4,
    size: 5, font,
    color: rgb(0.75, 0.80, 0.90),
  });

  // =============================================
  // MICROPONTILHADO DE SEGURANCA nos cantos
  // =============================================
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 4; j++) {
      lastPage.drawRectangle({
        x: sealX + 8 + i * 4, y: sealY + 16 + j * 4,
        width: 1, height: 1,
        color: rgb(0.72, 0.58, 0.08),
        opacity: 0.15,
      });
      lastPage.drawRectangle({
        x: sealX + sealW - 56 + i * 4, y: sealY + 16 + j * 4,
        width: 1, height: 1,
        color: rgb(0.72, 0.58, 0.08),
        opacity: 0.15,
      });
    }
  }
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
