const express = require('express');
const forge = require('node-forge');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Carrega os modulos signpdf de forma segura
let signpdfLib, placeholderLib, P12SignerLib;
try {
  signpdfLib = require('@signpdf/signpdf');
  placeholderLib = require('@signpdf/placeholder-pdf-lib');
  P12SignerLib = require('@signpdf/signer-p12');
  console.log('Modulos signpdf carregados com sucesso');
  console.log('signpdf keys:', Object.keys(signpdfLib));
  console.log('placeholder keys:', Object.keys(placeholderLib));
  console.log('P12Signer keys:', Object.keys(P12SignerLib));
} catch(e) {
  console.error('Erro ao carregar modulos signpdf:', e.message);
}

async function preparePdfForSigning(pdfBuffer, signerName, validTo) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dateStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  lastPage.drawRectangle({
    x: 30, y: 15, width: width - 60, height: 65,
    borderColor: rgb(0, 0.27, 0.55), borderWidth: 1.5,
    color: rgb(0.94, 0.97, 1),
  });
  lastPage.drawText('ASSINADO DIGITALMENTE - ICP-Brasil', {
    x: 40, y: 63, size: 8, font: fontBold, color: rgb(0, 0.27, 0.55),
  });
  lastPage.drawText('Titular: ' + signerName, {
    x: 40, y: 50, size: 7, font, color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Data/Hora: ' + dateStr, {
    x: 40, y: 39, size: 7, font, color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Certificado valido ate: ' + validTo, {
    x: 40, y: 28, size: 7, font, color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText('Verifique em: validar.iti.gov.br', {
    x: 40, y: 18, size: 7, font, color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
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

    const preparedPdf = await preparePdfForSigning(pdfBuffer, signerName, validTo);

    // Detectar funcoes disponiveis nos modulos
    const addPlaceholder = placeholderLib.plainAddPlaceholder 
      || placeholderLib.default?.plainAddPlaceholder
      || placeholderLib.addPlaceholder
      || placeholderLib.default?.addPlaceholder;

    if (!addPlaceholder) {
      console.error('Funcoes disponiveis em placeholder:', Object.keys(placeholderLib));
      return res.status(500).json({ error: 'Funcao addPlaceholder nao encontrada. Keys: ' + Object.keys(placeholderLib).join(', ') });
    }

    const P12Signer = P12SignerLib.P12Signer || P12SignerLib.default?.P12Signer || P12SignerLib.default;
    if (!P12Signer) {
      return res.status(500).json({ error: 'P12Signer nao encontrado. Keys: ' + Object.keys(P12SignerLib).join(', ') });
    }

    const signFn = signpdfLib.signpdf || signpdfLib.default?.signpdf || signpdfLib.sign || signpdfLib.default?.sign || signpdfLib.default;
    if (!signFn) {
      return res.status(500).json({ error: 'Funcao sign nao encontrada. Keys: ' + Object.keys(signpdfLib).join(', ') });
    }

    const pdfWithPlaceholder = addPlaceholder({
      pdfBuffer: preparedPdf,
      reason: 'Assinado digitalmente com certificado ICP-Brasil',
      contactInfo: '',
      name: signerName,
      location: 'Brasil',
    });

    const signer = new P12Signer(pfxBuffer, { passphrase: password });
    const signedPdf = typeof signFn === 'function' 
      ? await signFn(pdfWithPlaceholder, signer)
      : await signFn.sign(pdfWithPlaceholder, signer);

    res.json({
      success: true,
      signedPdfBase64: Buffer.from(signedPdf).toString('base64'),
      signerInfo: {
        name: signerName,
        validTo,
        signedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      },
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao assinar: ' + error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', modules: {
    signpdf: Object.keys(signpdfLib || {}),
    placeholder: Object.keys(placeholderLib || {}),
    p12signer: Object.keys(P12SignerLib || {})
  }});
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
