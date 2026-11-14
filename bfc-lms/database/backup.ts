import { runBackup } from '../server/src/utils/backup';

async function main(): Promise<void> {
  console.log('[backup] starting logical database backup ...');
  const result = await runBackup();
  const mb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`[backup] done — ${result.fileName} (${mb} MB) in ${result.durationMs} ms`);
  console.log(`[backup] stored at storage/${result.relativePath}`);
}

main().catch((error) => {
  console.error('[backup] failed', error);
  process.exit(1);
});