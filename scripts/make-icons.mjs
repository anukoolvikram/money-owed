// Generates the app's original icon (plain geometric ledger mark) as PNGs with no dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const BG = [31, 95, 74, 255], FG = [246, 246, 243, 255], ACC = [127, 207, 175, 255];
// Full-bleed square (iOS rounds corners itself; maskable-safe content within the centre 60%).
function icon(u, v) {
  const inX = u > 0.27 && u < 0.73;
  const bar = (y0, w) => v > y0 && v < y0 + 0.07 && u > 0.27 && u < 0.27 + w;
  if (bar(0.3, 0.46) || bar(0.45, 0.46) || bar(0.6, 0.3)) return FG;
  if (inX && v > 0.6 && v < 0.67 && u > 0.6) return ACC;
  return BG;
}
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`public/icons/${name}`, png(size, icon));
}
writeFileSync("src/app/icon.png", png(64, icon));
console.log("icons written");
