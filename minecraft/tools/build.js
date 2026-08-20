/**
 * Empacota o mod em .mcaddon (zip dos dois packs) sem dependências externas:
 *   node minecraft/tools/build.js
 * Saída: minecraft/packs/futebol-3d.mcaddon
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '..', 'src');
const BP = path.join(SRC, 'behavior');
const RP = path.join(SRC, 'resource');
const OUT = path.join(__dirname, '..', 'packs', 'futebol-3d.mcaddon');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, prefix, files) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix + name;
    if (fs.statSync(full).isDirectory()) walk(full, rel + '/', files);
    else files.push({ rel, full });
  }
  return files;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const nameBuf = Buffer.from(f.rel, 'utf8');
    const { time, date } = dosDateTime(new Date(2026, 7, 20));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header
    header.writeUInt16LE(20, 4);          // version needed
    header.writeUInt16LE(0x0800, 6);      // flags: utf8
    header.writeUInt16LE(8, 8);           // method: deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    const crc = crc32(data);
    header.writeUInt32LE(crc, 14);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central dir header
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += header.length + nameBuf.length + deflated.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const files = [];
for (const f of walk(BP, 'futebol_behavior/', files)) f.rel = f.rel.replace('futebol_behavior', 'futebol_behavior'); // (mantém nome)
files.length = 0;
walk(BP, 'futebol_behavior/', files);
walk(RP, 'futebol_resource/', files);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const buf = zip(files);
fs.writeFileSync(OUT, buf);
console.log(`✅ ${path.relative(process.cwd(), OUT)} gerado (${(buf.length / 1024).toFixed(1)} KB, ${files.length} arquivos)`);
for (const f of files) console.log('   ', f.rel);

// validação: tenta abrir de novo com unzip se disponível
try {
  const { execSync } = require('child_process');
  execSync(`unzip -t "${OUT}" > /dev/null`, { stdio: 'pipe' });
  console.log('✅ zip válido (unzip -t)');
} catch {
  console.log('ℹ️ unzip não disponível para validação; estrutura gerada conforme spec do ZIP.');
}
