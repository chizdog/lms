import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { uploadDirs } from '../config/env';

export interface CertificateData {
  certificateNumber: string;
  employeeName: string;
  employeeNo: string;
  courseTitle: string;
  courseCode: string;
  completionDate: string;
  score: number | null;
  signatoryName: string;
  durationMinutes: number;
}

export async function renderCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;

    // Background and frame
    doc.rect(0, 0, W, H).fill('#FBF9F5');
    doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke('#111111');
    doc.rect(32, 32, W - 64, H - 64).lineWidth(0.75).stroke('#C8952F');

    // Corner accents
    for (const [cx, cy] of [[32, 32], [W - 32, 32], [32, H - 32], [W - 32, H - 32]] as const) {
      doc.rect(cx - 4, cy - 4, 8, 8).fill('#C8952F');
    }

    // Brand header
    doc.fillColor('#C8952F').font('Helvetica-Bold').fontSize(13)
      .text('BUT FIRST, COFFEE', 0, 62, { width: W, align: 'center', characterSpacing: 3 });
    doc.fillColor('#666666').font('Helvetica').fontSize(9)
      .text('LEARNING & DEVELOPMENT', 0, 82, { width: W, align: 'center', characterSpacing: 2 });

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(34)
      .text('Certificate of Completion', 0, 116, { width: W, align: 'center' });

    doc.moveTo(W / 2 - 90, 162).lineTo(W / 2 + 90, 162).lineWidth(1.5).stroke('#C8952F');

    doc.fillColor('#555555').font('Helvetica').fontSize(11)
      .text('This certifies that', 0, 182, { width: W, align: 'center' });

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(28)
      .text(data.employeeName, 60, 202, { width: W - 120, align: 'center' });

    doc.fillColor('#888888').font('Helvetica').fontSize(9)
      .text(`Employee No. ${data.employeeNo}`, 0, 238, { width: W, align: 'center' });

    doc.fillColor('#555555').font('Helvetica').fontSize(11)
      .text('has successfully completed the training course', 0, 262, { width: W, align: 'center' });

    doc.fillColor('#8C6A24').font('Helvetica-Bold').fontSize(20)
      .text(data.courseTitle, 80, 282, { width: W - 160, align: 'center' });

    doc.fillColor('#888888').font('Helvetica').fontSize(9)
      .text(`${data.courseCode}  ·  ${data.durationMinutes} minutes of instruction`, 0, 312, { width: W, align: 'center' });

    const scoreLine = data.score === null ? '' : `  ·  Assessment score ${data.score.toFixed(1)}%`;
    doc.fillColor('#555555').font('Helvetica').fontSize(10)
      .text(`Completed on ${data.completionDate}${scoreLine}`, 0, 334, { width: W, align: 'center' });

    // Signature block
    const sigY = H - 130;
    doc.moveTo(W / 2 - 130, sigY).lineTo(W / 2 + 130, sigY).lineWidth(0.75).stroke('#333333');
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11)
      .text(data.signatoryName, 0, sigY + 8, { width: W, align: 'center' });
    doc.fillColor('#888888').font('Helvetica').fontSize(8.5)
      .text('Authorized Signatory', 0, sigY + 24, { width: W, align: 'center' });

    // Certificate number footer
    doc.fillColor('#999999').font('Helvetica').fontSize(8)
      .text(`Certificate No. ${data.certificateNumber}`, 48, H - 52, { width: W - 96, align: 'left' });
    doc.text('Verify through the BFC Learning Management System', 48, H - 52, { width: W - 96, align: 'right' });

    doc.end();
  });
}

export function certificateFilePath(certificateNumber: string): { absolute: string; relative: string } {
  const fileName = `${certificateNumber}.pdf`;
  return {
    absolute: path.join(uploadDirs.certificates, fileName),
    relative: `uploads/certificates/${fileName}`,
  };
}

export async function writeCertificatePdf(data: CertificateData): Promise<string> {
  const buffer = await renderCertificatePdf(data);
  const { absolute, relative } = certificateFilePath(data.certificateNumber);
  fs.mkdirSync(uploadDirs.certificates, { recursive: true });
  fs.writeFileSync(absolute, buffer);
  return relative;
}