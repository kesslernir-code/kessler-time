// One-off: resize the personal header photo to a light web banner. Run from repo root.
import sharp from "sharp";

// Band keeping the structure's dome AND both faces (thin spire tips sacrificed)
await sharp("C:/Users/user/Downloads/20240826_055611.jpg")
  .extract({ left: 0, top: 690, width: 3968, height: 1400 })
  .resize(1600, 565)
  .webp({ quality: 80 })
  .toFile("web/us.webp");
console.log("web/us.webp written");
