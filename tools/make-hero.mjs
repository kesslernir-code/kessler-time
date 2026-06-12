// One-off: resize the personal header photo to a light web banner. Run from repo root.
import sharp from "sharp";

await sharp("C:/Users/user/Downloads/20251205_125936.jpg")
  .resize(1600, 640, { fit: "cover", position: "attention" }) // keep the faces
  .webp({ quality: 80 })
  .toFile("web/us.webp");
console.log("web/us.webp written");
