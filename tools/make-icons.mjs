// Render web/icon.svg to the PNG sizes phones need. Run: node tools/make-icons.mjs
import sharp from "sharp";

for (const size of [512, 192, 180]) {
  await sharp("web/icon.svg", { density: 300 })
    .resize(size, size)
    .png()
    .toFile(`web/icon-${size}.png`);
  console.log(`icon-${size}.png`);
}
