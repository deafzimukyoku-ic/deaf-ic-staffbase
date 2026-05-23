#!/usr/bin/env node
/*
 * PWA アイコン生成スクリプト (一度走らせて成果物を commit する想定)。
 *
 * 元画像: public/phone_logo.jpg (手話「ろう」「みみ」モチーフ、約 18KB の小サイズ JPG)
 * 出力先: public/icons/
 *   - icon-192.png         : Android Chrome / 標準 PWA アイコン
 *   - icon-512.png         : Android Chrome / Splash screen
 *   - icon-maskable-512.png: Android maskable (safe zone 内に縮小して透明背景で囲む)
 *   - icon-180-apple.png   : iOS apple-touch-icon (Safari ホーム画面)
 *   - favicon-32.png       : ブラウザタブ favicon フォールバック
 *
 * Why maskable: Android のアダプティブアイコンは中央 80% を確保する safe zone を要求するため、
 *   元画像を 80% に縮小して周囲を beige 背景でパディングしないと一部が切れる。
 *
 * 実行: node scripts/generate-pwa-icons.mjs
 * 必要: sharp (Next.js 内部依存で既に node_modules に存在する想定)
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'public', 'phone_logo.jpg');
const OUT_DIR = join(ROOT, 'public', 'icons');

const BG = { r: 248, g: 244, b: 235, alpha: 1 }; // brand-beige 相当 #F8F4EB

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  /* 標準アイコン (full bleed): 元画像を background beige でパディングして正方形化してからリサイズ */
  const meta = await sharp(SRC).metadata();
  const baseSize = Math.max(meta.width ?? 512, meta.height ?? 512);
  const squareBuffer = await sharp(SRC)
    .resize({
      width: baseSize,
      height: baseSize,
      fit: 'contain',
      background: BG,
    })
    .png()
    .toBuffer();

  await sharp(squareBuffer).resize(192, 192).png().toFile(join(OUT_DIR, 'icon-192.png'));
  await sharp(squareBuffer).resize(512, 512).png().toFile(join(OUT_DIR, 'icon-512.png'));
  await sharp(squareBuffer).resize(180, 180).png().toFile(join(OUT_DIR, 'icon-180-apple.png'));
  await sharp(squareBuffer).resize(32, 32).png().toFile(join(OUT_DIR, 'favicon-32.png'));

  /* maskable: safe zone 内 (中央 80%) に縮小 + 周囲 beige パディング。
     Android adaptive icon の launcher が円・四角・葉っぱ等で切り抜くため、
     縁ギリギリに置くと欠ける。 */
  const safeSize = 512;
  const innerSize = Math.round(safeSize * 0.8); // 410
  const innerBuffer = await sharp(SRC)
    .resize({
      width: innerSize,
      height: innerSize,
      fit: 'contain',
      background: BG,
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: safeSize,
      height: safeSize,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: innerBuffer, gravity: 'center' }])
    .png()
    .toFile(join(OUT_DIR, 'icon-maskable-512.png'));

  console.log('Generated:');
  console.log('  public/icons/icon-192.png');
  console.log('  public/icons/icon-512.png');
  console.log('  public/icons/icon-maskable-512.png');
  console.log('  public/icons/icon-180-apple.png');
  console.log('  public/icons/favicon-32.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
