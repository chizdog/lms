import { query, execute, pool, type RowDataPacket } from '../server/src/config/db';
import { writeCertificatePdf } from '../server/src/utils/certificate-pdf';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

async function main() {
  const rows = await query<RowDataPacket & {
    id: number; certificate_number: string; completion_date: string; score: string | null; signatory_name: string | null;
    first_name: string; last_name: string; employee_no: string; course_title: string; course_code: string; duration_minutes: number;
  }>(
    `SELECT cert.id, cert.certificate_number, cert.completion_date, cert.score, cert.signatory_name,
            e.first_name, e.last_name, e.employee_no,
            c.title AS course_title, c.code AS course_code, c.duration_minutes
     FROM certificates cert
     JOIN employees e ON e.id = cert.employee_id
     JOIN courses c ON c.id = cert.course_id
     WHERE cert.file_path IS NULL`,
  );
  console.log(`[backfill] generating PDFs for ${rows.length} certificates ...`);
  for (const r of rows) {
    const filePath = await writeCertificatePdf({
      certificateNumber: r.certificate_number,
      employeeName: `${r.first_name} ${r.last_name}`,
      employeeNo: r.employee_no,
      courseTitle: r.course_title,
      courseCode: r.course_code,
      completionDate: longDate(r.completion_date),
      score: r.score === null ? null : Number(r.score),
      signatoryName: r.signatory_name ?? 'Maria Santos, L&D Manager',
      durationMinutes: Number(r.duration_minutes),
    });
    await execute('UPDATE certificates SET file_path = ? WHERE id = ?', [filePath, r.id]);
    console.log(`  ${r.certificate_number} -> ${filePath}`);
  }
  await pool.end();
  console.log('[backfill] done.');
}

main().catch((e) => { console.error(e); process.exit(1); });