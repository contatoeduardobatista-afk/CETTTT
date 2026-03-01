const express = require('express');
const forge = require('node-forge');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { SignPdf } = require('@signpdf/signpdf');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

  // Adicionar placeholder de assinatura no PDF
  await pdflibAddPlaceholder({
    pdfDoc,
    reason: 'Assinado digitalmente com certificado ICP-Brasil',
    contactInfo: '',
    name: signerName,
    location: 'Brasil',
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

    // Criar signer com P12 usando node-forge diretamente
    const signPdf = new SignPdf();

    // Signer customizado usando node-forge
    const pfxDer = forge.util.createBuffer(pfxBuffer.toString('binary'));
    const pfxAsn1 = forge.asn1.fromDer(pfxDer);
    const pfxObj = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);

    const keyBags = pfxObj.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
    const certBags = pfxObj.getBags({ bagType: forge.pki.oids.certBag });
    const certs = certBags[forge.pki.oids.certBag].map(b => b.cert);

    // Classe signer compativel com @signpdf/signpdf
    class ForgeSigner {
      async sign(pdfBuffer, placeholderLength) {
        const md = forge.md.sha256.create();
        md.update(pdfBuffer.toString('binary'));

        const p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'));

        certs.forEach(cert => p7.addCertificate(cert));

        p7.addSigner({
          key: privateKey,
          certificate: certs[0],
          digestAlgorithm: forge.pki.oids.sha256,
          authenticatedAttributes: [
            { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
            { type: forge.pki.oids.messageDigest },
            { type: forge.pki.oids.signingTime, value: new Date() },
          ],
        });

        p7.sign({ detached: true });
        const p7Der = forge.asn1.toDer(p7.toAsn1()).getBytes();
        return Buffer.from(p7Der, 'binary');
      }
    }

    const signer = new ForgeSigner();
    const signedPdf = await signPdf.sign(preparedPdf, signer);

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
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
