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

  const sealX = 30;
  const sealY = 15;
  const sealW = width - 60;
  const sealH = 65;

  // Fundo azul claro
  lastPage.drawRectangle({
    x: sealX, y: sealY,
    width: sealW, height: sealH,
    color: rgb(0.94, 0.97, 1),
    borderColor: rgb(0, 0.27, 0.55),
    borderWidth: 1.5,
  });

  // Faixa azul no topo
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 18,
    width: sealW, height: 18,
    color: rgb(0, 0.27, 0.55),
  });

  lastPage.drawText('ASSINADO DIGITALMENTE - ICP-Brasil', {
    x: sealX + 10, y: sealY + sealH - 12,
    size: 8, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Badge verde ICP-Brasil
  lastPage.drawRectangle({
    x: sealX + sealW - 78, y: sealY + sealH - 16,
    width: 74, height: 14,
    color: rgb(0, 0.50, 0.22),
  });
  lastPage.drawText('ICP-Brasil', {
    x: sealX + sealW - 63, y: sealY + sealH - 10,
    size: 7, font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Linha dourada
  lastPage.drawRectangle({
    x: sealX, y: sealY + sealH - 20,
    width: sealW, height: 1.5,
    color: rgb(0.75, 0.60, 0.10),
  });

  // Dados
  lastPage.drawText('Titular: ' + displayName, {
    x: sealX + 10, y: sealY + 50,
    size: 7, font: fontBold,
    color: rgb(0, 0.27, 0.55),
  });
  if (docNumber) {
    lastPage.drawText(docNumber, {
      x: sealX + 10, y: sealY + 40,
      size: 6.5, font,
      color: rgb(0.15, 0.15, 0.15),
    });
  }
  lastPage.drawText('Data e hora: ' + (dateStr || ''), {
    x: sealX + 10, y: sealY + 30,
    size: 6.5, font,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Certificado valido ate: ' + (validTo || ''), {
    x: sealX + 10, y: sealY + 20,
    size: 6.5, font,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Verifique em: validar.iti.gov.br', {
    x: sealX + 10, y: sealY + 10,
    size: 6.5, font,
    color: rgb(0.30, 0.30, 0.30),
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
