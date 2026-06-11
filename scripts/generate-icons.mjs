/**
 * Icon generation pipeline.
 *
 * Reads `resources/icons/source.png` (the artwork delivered by the user, which
 * contains the main rounded-square camel icon plus extra preview thumbnails
 * and color swatches), crops out just the main icon area, and emits:
 *   - resources/icons/app-512.png .. app-16.png  (PNG ladder)
 *   - resources/icons/app.png                    (alias for the 512px)
 *   - resources/icons/tray.png                   (24px transparent-friendly)
 *   - resources/icons/app.ico                    (multi-size Windows icon)
 *
 * The crop area is computed dynamically: we trim transparent/near-white
 * padding, then keep only the top "icon" half of what remains. That keeps the
 * pipeline robust if the source image is re-rendered at a different size.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'resources', 'icons');
const SOURCE = path.join(ICON_DIR, 'source.png');

const PNG_SIZES = [512, 256, 128, 96, 64, 48, 32, 24, 16];
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

async function main() {
  const exists = await fs.stat(SOURCE).catch(() => null);
  if (!exists) {
    throw new Error(`Source artwork not found at ${SOURCE}`);
  }

  const trimmed = await sharp(SOURCE)
    .trim({ threshold: 12 })
    .toBuffer({ resolveWithObject: true });

  const { width, height } = trimmed.info;
  // Source layout: top ~70% is the main rounded-square icon, bottom is a
  // strip of preview thumbnails + color swatches. Keep the top portion only.
  const ICON_REGION_RATIO = 0.7;
  const region = {
    left: 0,
    top: 0,
    width,
    height: Math.round(height * ICON_REGION_RATIO),
  };

  const topPart = sharp(trimmed.data, { density: 300 })
    .extract(region);

  // Tight-trim the cropped top region again so the rounded square fills the
  // canvas with minimal whitespace.
  const topBuf = await topPart.png().toBuffer();
  const square = await squareCrop(topBuf);

  // Master 1024px master for downstream resizing.
  const master = await sharp(square)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const pngPaths = [];
  for (const size of PNG_SIZES) {
    const out = path.join(ICON_DIR, `app-${size}.png`);
    await sharp(master)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    pngPaths.push({ size, out });
    console.log(`  → ${path.relative(ROOT, out)}`);
  }

  // Aliases used by main.ts / tray.ts.
  await fs.copyFile(path.join(ICON_DIR, 'app-512.png'), path.join(ICON_DIR, 'app.png'));
  console.log(`  → ${path.relative(ROOT, path.join(ICON_DIR, 'app.png'))}`);
  await fs.copyFile(path.join(ICON_DIR, 'app-24.png'), path.join(ICON_DIR, 'tray.png'));
  console.log(`  → ${path.relative(ROOT, path.join(ICON_DIR, 'tray.png'))}`);

  // Windows .ico (multi-size container).
  const icoSources = ICO_SIZES.map(
    (s) => pngPaths.find((p) => p.size === s)?.out,
  ).filter(Boolean);
  const icoBuf = await pngToIco(icoSources);
  const icoPath = path.join(ICON_DIR, 'app.ico');
  await fs.writeFile(icoPath, icoBuf);
  console.log(`  → ${path.relative(ROOT, icoPath)}`);

  // Renderer favicon: Vite serves `src/public/` at the renderer root.
  const publicDir = path.join(ROOT, 'src', 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.copyFile(
    path.join(ICON_DIR, 'app-32.png'),
    path.join(publicDir, 'favicon.png'),
  );
  console.log(`  → ${path.relative(ROOT, path.join(publicDir, 'favicon.png'))}`);

  console.log('\nAll icons generated.');
}

/**
 * Take a roughly-rectangular image of the icon canvas, find its bounding box
 * inside a near-white sea, and pad to a square.
 */
async function squareCrop(buf) {
  const trimmed = await sharp(buf).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.max(width, height);
  // Re-canvas onto a square with the same beige background as the rounded
  // square art so the seams disappear.
  return sharp(trimmed.data)
    .resize({
      width: side,
      height: side,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
