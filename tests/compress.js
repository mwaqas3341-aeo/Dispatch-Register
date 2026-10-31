// Runs the REAL compression.js (image path) in Node with a canvas shim. Run: npm i @napi-rs/canvas && node tests/compress.js
const fs = require('fs'), vm = require('vm');
const { createCanvas, Image } = require('@napi-rs/canvas');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + (x || ''))); };

const win = { Image, URL: { createObjectURL: (f) => f._buf, revokeObjectURL() {} }, FileReader: class { readAsArrayBuffer(f) { f.arrayBuffer().then(ab => { this.result = ab; this.onload(); }, e => { this.error = e; this.onerror(); }); } },
  File, Blob, Promise, setTimeout, console, Uint8Array, ArrayBuffer, Math };
win.window = win;
win.document = { head: { appendChild(el) { win.PDFLib = require('pdf-lib'); setTimeout(() => el.onload && el.onload(), 0); } }, createElement: (t) => { if (t === 'script') return {}; const c = createCanvas(1, 1);
  c.toBlob = (cb, mime, q) => { const type = mime || 'image/png'; const buf = type === 'image/png' ? c.toBuffer('image/png') : c.toBuffer(type, Math.round((q || 0.92) * 100)); cb(new Blob([buf], { type })); }; return c; } };
vm.createContext(win); vm.runInContext(fs.readFileSync(__dirname + '/../compression.js', 'utf8'), win);
const D = win.DRCompress;

function photo(w, h) {   // noisy "photo-like" picture so JPEG has real work to do
  const c = createCanvas(w, h), x = c.getContext('2d');
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgb(${(i * 37) % 255},${(i * 91) % 255},${(i * 17) % 255})`; x.fillRect((i * 53) % w, (i * 29) % h, 400 + (i % 300), 300 + (i % 200)); }
  const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.sin(i * 0.37) * 40) | 0; d.data[i] += n; d.data[i + 1] -= n; d.data[i + 2] += n >> 1; } x.putImageData(d, 0, 0);
  return c;
}
const mkFile = (buf, name, type) => { const f = new File([buf], name, { type }); f._buf = buf; return f; };

(async () => {
  const jpg = photo(4000, 3000).toBuffer('image/jpeg', 98);
  const f1 = mkFile(jpg, 'scan.jpg', 'image/jpeg');
  const r1 = await D.compressFile(f1, () => {});
  ok(`big JPEG shrinks (${(jpg.length / 1048576).toFixed(1)} MB -> ${(r1.file.size / 1048576).toFixed(2)} MB)`, r1.report.didCompress && r1.file.size < jpg.length * 0.5);
  const img = new Image(); img.src = Buffer.from(await r1.file.arrayBuffer());
  await new Promise(r => { img.onload = r; });
  ok('long edge capped at 2000 px and stays readable (>= 900)', Math.max(img.width, img.height) <= 2000 && Math.max(img.width, img.height) >= 900, img.width + 'x' + img.height);
  ok('still a JPEG with the same name', r1.file.type === 'image/jpeg' && r1.file.name === 'scan.jpg');

  const png = photo(3000, 2000).toBuffer('image/png');
  const r2 = await D.compressFile(mkFile(png, 'page.png', 'image/png'), () => {});
  ok(`opaque PNG scan shrinks (${(png.length / 1048576).toFixed(1)} MB -> ${(r2.file.size / 1048576).toFixed(2)} MB)`, r2.file.size < png.length * 0.5 && /\.(jpg|png)$/.test(r2.file.name), r2.file.name);

  const tiny = createCanvas(100, 100).toBuffer('image/jpeg', 80);
  const r3 = await D.compressFile(mkFile(tiny, 'tiny.jpg', 'image/jpeg'), () => {});
  ok('tiny file passes through unchanged', r3.file.size === tiny.length && !r3.report.didCompress);

  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create(); for (let i = 0; i < 400; i++) { const pg = doc.addPage(); for (let j = 0; j < 30; j++) pg.drawText('Dispatch register line ' + i + '-' + j, { x: 40, y: 800 - j * 20, size: 10 }); }
  const pdfBytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const pdf = new File([pdfBytes], 'a.pdf', { type: 'application/pdf' });
  const r4 = await D.compressFile(pdf, () => {});
  ok(`PDF is re-saved smaller or unchanged, never bigger (${pdfBytes.length} -> ${r4.file.size} bytes)`, r4.file.size <= pdf.size && r4.file.type === 'application/pdf');
  const reopened = await PDFDocument.load(Buffer.from(await r4.file.arrayBuffer()));
  ok('compressed PDF still opens with all 400 pages', reopened.getPageCount() === 400);

  const bad = mkFile(Buffer.from('not an image at all, just text '.repeat(5000)), 'broken.jpg', 'image/jpeg');
  const r5 = await D.compressFile(bad, () => {});
  ok('a corrupt image falls back to the original instead of failing', r5.file.size === bad.size);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
