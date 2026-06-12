// One-off: resize the personal header photo to a light web banner. Run from repo root.
import sharp from "sharp";

// Manual band crop: keep the lit structure (top) AND the faces (bottom)
await sharp("C:/Users/user/Downloads/20240826_055611.jpg")
  .extract({ left: 0, top: 130, width: 2000, height: 995 })
  .resize(1600, 800)
  .webp({ quality: 80 })
  .toFile("web/us.webp");
console.log("web/us.webp written");
