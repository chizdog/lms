import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const thumbnailsDir = path.resolve(__dirname, '../storage/uploads/thumbnails');

async function main(): Promise<void> {
  const files = fs.readdirSync(thumbnailsDir).filter((f) => f.endsWith('.png'));
  for (const file of files) {
    const source = path.join(thumbnailsDir, file);
    const target = path.join(thumbnailsDir, file.replace(/\.png$/, '.jpg'));
    await sharp(source)
      .resize({ width: 960, height: 540, fit: 'cover' })
      .jpeg({ quality: 82, progressive: true })
      .toFile(target);
    fs.unlinkSync(source);
    const kb = Math.round(fs.statSync(target).size / 1024);
    console.log(`[assets] ${path.basename(target)} ${kb}KB`);
  }
}

main().catch((error) => {
  console.error('[assets] failed', error);
  process.exit(1);
});