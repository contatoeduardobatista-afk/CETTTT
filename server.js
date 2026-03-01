const express = require('express');
const forge = require('node-forge');
const { PDFDocument, rgb } = require('pdf-lib');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =============================================
// ROTA: Assinar PDF com certificado .pfx
// =============================================
app.post('/sign-pdf', upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'pfx', maxCount: 1 }
]), async (req, res) => {
  try {
    const pdfBuffer = req.files['pdf'][0].buffer;
    const pfxBuffer = req.files['pfx'] ? req.files['pfx'][0].buffer : null;
    const pfxBase64 = req.body.pfxBase64 || null;
    const pfxPassword = req.body.pfxPassword || '';

    // Carregar o .pfx
    let pfxBytes;
    if (pfxBuffer) {
      pfxBytes = pfxBuffer;
    } else if (pfxBase64) {
      pfxBytes = Buffer.from(pfxBase64, 'base64');
    } else {
      return res.status(400).json({ error: 'Certificado .pfx não fornecido' });
    }

    // Parsear o .pfx com node-forge
    const pfxDer = forge.util.createBuffer(pfxBytes.toString('binary'));
    const pfxAsn1 = forge.asn1.fromDer(pfxDer);
    
    let pfxObj;
    try {
      pfxObj = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, pfxPassword);
    } catch (e) {
      return res.status(400).json({ error: 'Senha do certificado incorreta ou arquivo .pfx inválido' });
    }

    // Extrair chave privada
    const keyBags = pfxObj.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0];
    if (!keyBag) {
      return res.status(400).json({ error: 'Chave privada não encontrada no certificado' });
    }
    const privateKey = keyBag.key;

    // Extrair todos os certificados da cadeia
    const certBags = pfxObj.getBags({ bagType: forge.pki.oids.certBag });
    const certBagList = certBags[forge.pki.oids.certBag];
    if (!certBagList || certBagList.length === 0) {
      return res.status(400).json({ error: 'Certificado não encontrado no arquivo .pfx' });
    }

    // Encontrar o certificado do assinante (que corresponde à chave privada)
    let signerCert = null;
    let chainCerts = [];
    
    for (const bag of certBagList) {
      const cert = bag.cert;
      try {
        const publicKey = cert.publicKey;
        // Comparar chave pública do cert com a chave privada
        const pubKeyPem = forge.pki.publicKeyToPem(publicKey);
        const privKeyPem = forge.pki.privateKeyToPem(privateKey);
        // Verifica se o par de chaves é compatível
        const testMsg = 'test';
        const md = forge.md.sha256.create();
        md.update(testMsg);
        const sig = privateKey.sign(md);
        const md2 = forge.md.sha256.create();
        md2.update(testMsg);
        if (publicKey.verify(md2.digest().bytes(), sig)) {
          signerCert = cert;
        } else {
          chainCerts.push(cert);
        }
      } catch (e) {
        chainCerts.push(cert);
      }
    }

    if (!signerCert) {
      signerCert = certBagList[0].cert;
      chainCerts = certBagList.slice(1).map(b => b.cert);
    }

    // Informações do titular
    const subject = signerCert.subject;
    const cn = subject.getField('CN')?.value || 'Assinante';
    const validTo = signerCert.validity.notAfter;

    // Verificar validade do certificado
    const now = new Date();
    if (now > validTo) {
      return res.status(400).json({ error: `Certificado expirado em ${validTo.toLocaleDateString('pt-BR')}` });
    }

    // =============================================
    // Preparar o PDF para assinatura PAdES
    // =============================================
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // Adicionar campo de assinatura visual na última página
    const signatureText = `Assinado digitalmente por: ${cn}\nData: ${now.toLocaleString('pt-BR')}\nCertificado ICP-Brasil válido até: ${validTo.toLocaleDateString('pt-BR')}`;
    
    lastPage.drawRectangle({
      x: 30,
      y: 20,
      width: width - 60,
      height: 60,
      borderColor: rgb(0, 0.3, 0.6),
      borderWidth: 1,
      color: rgb(0.95, 0.97, 1),
    });

    lastPage.drawText(`ASSINADO DIGITALMENTE - ICP-Brasil`, {
      x: 40,
      y: 60,
      size: 8,
      color: rgb(0, 0.3, 0.6),
    });

    lastPage.drawText(`Titular: ${cn}`, {
      x: 40,
      y: 48,
      size: 7,
      color: rgb(0.2, 0.2, 0.2),
    });

    lastPage.drawText(`Data/Hora: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, {
      x: 40,
      y: 37,
      size: 7,
      color: rgb(0.2, 0.2, 0.2),
    });

    lastPage.drawText(`Certificado válido até: ${validTo.toLocaleDateString('pt-BR')}`, {
      x: 40,
      y: 26,
      size: 7,
      color: rgb(0.2, 0.2, 0.2),
    });

    // Serializar o PDF modificado
    const modifiedPdfBytes = await pdfDoc.save();

    // =============================================
    // Criar assinatura PKCS#7 / PAdES
    // =============================================
    const pdfToSign = Buffer.from(modifiedPdfBytes);
    
    // Calcular hash SHA-256 do PDF
    const md = forge.md.sha256.create();
    md.update(forge.util.createBuffer(pdfToSign.toString('binary')).bytes());
    
    // Criar estrutura PKCS#7 SignedData
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(pdfToSign.toString('binary'));
    
    // Adicionar todos os certificados da cadeia
    p7.addCertificate(signerCert);
    for (const cert of chainCerts) {
      p7.addCertificate(cert);
    }

    // Adicionar assinante
    p7.addSigner({
      key: privateKey,
      certificate: signerCert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        {
          type: forge.pki.oids.contentType,
          value: forge.pki.oids.data,
        },
        {
          type: forge.pki.oids.messageDigest,
        },
        {
          type: forge.pki.oids.signingTime,
          value: now,
        },
      ],
    });

    // Assinar
    p7.sign({ detached: true });

    // Converter assinatura para DER
    const p7Asn1 = p7.toAsn1();
    const p7Der = forge.asn1.toDer(p7Asn1).getBytes();
    const p7Buffer = Buffer.from(p7Der, 'binary');

    // Retornar o PDF com a assinatura embutida
    // Como o PAdES completo requer manipulação binária complexa do PDF,
    // retornamos o PDF modificado + a assinatura PKCS#7 separada
    // e incluímos as informações do certificado
    
    res.json({
      success: true,
      signedPdfBase64: Buffer.from(modifiedPdfBytes).toString('base64'),
      signatureBase64: p7Buffer.toString('base64'),
      signerInfo: {
        name: cn,
        validTo: validTo.toLocaleDateString('pt-BR'),
        signedAt: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      }
    });

  } catch (error) {
    console.error('Erro ao assinar PDF:', error);
    res.status(500).json({ error: 'Erro interno ao assinar PDF: ' + error.message });
  }
});

// =============================================
// ROTA: Verificar saúde do servidor
// =============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor de assinatura digital funcionando' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor de assinatura digital rodando na porta ${PORT}`);
});
