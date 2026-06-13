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

const files = [];
for (const [i, name] of photos.entries()) {
  const out = `hero-${String(i + 1).padStart(3, "0")}.webp`;
  try {
    await sharp(`${SRC}/${name}`)
      .rotate() // honor EXIF orientation
      // keep the WHOLE photo (no face-cutting crop); the page shows it complete
      // over a blurred fill, so any aspect ratio looks good and nothing is cut
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
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
