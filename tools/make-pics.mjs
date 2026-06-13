// Convert all photos in Pic/ to light web banners (web/pics/hero-NNN.webp, in
// filename order) + a manifest the site uses to rotate daily. Re-run after
// adding photos to Pic/, then commit web/pics/.
import sharp from "sharp";
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";

const SRC = "Pic";
const OUT = "web/pics";
mkdirSync(OUT, { recursive: true });

const photos = readdirSync(SRC)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) // HEIC not supported — convert those manually
  .sort();

// The hero shows the whole photo at its natural height (no crop). To keep the
// banner from getting too tall, portrait-ish photos are skipped entirely.
const MAX_RATIO = 0.8; // drop anything taller than 4:5 (height > 80% of width)

const files = [];
let n = 0;
for (const name of photos) {
  try {
    const img = sharp(`${SRC}/${name}`).rotate(); // honor EXIF orientation
    const meta = await img.metadata();
    if (meta.height / meta.width > MAX_RATIO) {
      console.log(`SKIP (too tall ${(meta.height / meta.width).toFixed(2)})  ${name}`);
      continue;
    }
    const out = `hero-${String(++n).padStart(3, "0")}.webp`;
    await img.resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(`${OUT}/${out}`);
    files.push(out);
    console.log(`${out}  <-  ${name}`);
  } catch (e) {
    console.error(`SKIP ${name}: ${e.message}`);
  }
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ count: files.length, v: Date.now(), files }, null, 2));
console.log(`manifest.json: ${files.length} pictures`);
