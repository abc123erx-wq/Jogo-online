/**
 * Gera as texturas do mod de Futebol 3D:
 *  - textures/entity/bola.png   (16x16) padrão clássico da bola para a entidade 3D
 *  - textures/items/bola.png    (16x16) ícone do item
 *  - textures/items/trofeu.png  (16x16) ícone do troféu de hat-trick
 *  - pack_icon.png              (256x256) ícone dos packs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./lib-png');

const ROOT = path.join(__dirname, '..', 'src', 'resource');
const BP_ROOT = path.join(__dirname, '..', 'src', 'behavior');

function dir(p) { fs.mkdirSync(p, { recursive: true }); }

/** Desenha o padrão clássico da bola (pentágono central + cantos) em qualquer canvas,
 *  ocupando a região [ox,oy,ox+size,oy+size]. */
function ballPattern(c, ox, oy, size, opts = {}) {
  const u = size / 16; // unidade
  const white = opts.white || '#ffffff';
  const black = opts.black || '#1a1a1a';
  // base branca
  c.fillRect(ox, oy, Math.ceil(size), Math.ceil(size), white);
  const cx = ox + size / 2, cy = oy + size / 2;
  // pentágono central (borda plana em cima — leitura correta de bola)
  c.pentagon(cx, cy, 3.5 * u, -54, black);
  // manchas nos cantos (clipeia na borda do cubo)
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const bx = ox + fx * size, by = oy + fy * size;
    c.circle(bx, by, 2.5 * u, black);
  }
  // meias manchas nos meios das bordas (continuam na face vizinha)
  c.circle(ox, cy, 2.1 * u, black);
  c.circle(ox + size, cy, 2.1 * u, black);
  c.circle(cx, oy, 2.1 * u, black);
  c.circle(cx, oy + size, 2.1 * u, black);
  // sombra sutil na borda inferior (sensação de esfera)
  const shade = 'rgba(0,0,0,40)';
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < Math.ceil(size); i++) {
      const t = i / size;
      if (0.12 + 0.76 * t * t < 1) c.px(ox + i, oy + Math.ceil(size) - 1 - j, shade);
    }
  }
}

// ---------- 1) Textura da entidade (cubo 3D) ----------
{
  const c = new Canvas(16, 16);
  ballPattern(c, 0, 0, 16, { white: '#f4f4f4', black: '#151515' });
  dir(path.join(ROOT, 'textures', 'entity'));
  const n = c.toPNG(path.join(ROOT, 'textures', 'entity', 'bola.png'));
  console.log('entity/bola.png ->', n, 'bytes');
}

// ---------- 2) Ícone do item bola ----------
{
  const c = new Canvas(16, 16);
  ballPattern(c, 1, 1, 14, { white: '#ffffff', black: '#111111' });
  dir(path.join(ROOT, 'textures', 'items'));
  const n = c.toPNG(path.join(ROOT, 'textures', 'items', 'bola.png'));
  console.log('items/bola.png ->', n, 'bytes');
}

// ---------- 3) Ícone do troféu ----------
{
  const c = new Canvas(16, 16);
  const gold = '#ffc800', dark = '#9a6b00', light = '#ffe98a';
  // taça
  c.fillRect(4, 2, 8, 6, gold);
  c.fillRect(4, 2, 8, 1, light);
  c.fillRect(4, 7, 8, 1, dark);
  c.fillRect(5, 3, 6, 4, gold);
  c.fillRect(5, 3, 1, 4, light);
  // alças
  c.fillRect(2, 2, 2, 1, dark); c.fillRect(1, 3, 1, 3, dark); c.fillRect(2, 5, 2, 1, dark);
  c.fillRect(12, 2, 2, 1, dark); c.fillRect(14, 3, 1, 3, dark); c.fillRect(12, 5, 2, 1, dark);
  // haste e base
  c.fillRect(7, 8, 2, 3, gold);
  c.fillRect(6, 11, 4, 1, gold);
  c.fillRect(5, 12, 6, 1, dark);
  c.fillRect(4, 13, 8, 1, gold);
  c.fillRect(4, 14, 8, 1, dark);
  // brilho
  c.px(5, 4, '#ffffff'); c.px(5, 5, '#ffffff');
  dir(path.join(ROOT, 'textures', 'items'));
  const n = c.toPNG(path.join(ROOT, 'textures', 'items', 'trofeu.png'));
  console.log('items/trofeu.png ->', n, 'bytes');
}

// ---------- 4) Pack icon (256x256) ----------
{
  const S = 256;
  const c = new Canvas(S, S);
  // gramado com faixas
  const g1 = '#3d9e3d', g2 = '#348b34';
  for (let i = 0; i < 8; i++) c.fillRect((i * S) / 8, 0, Math.ceil(S / 8), S, i % 2 ? g1 : g2);
  const white = '#f2f2f2';
  // linhas de contorno
  c.fillRect(14, 14, S - 28, 5, white);
  c.fillRect(14, S - 19, S - 28, 5, white);
  c.fillRect(14, 14, 5, S - 28, white);
  c.fillRect(S - 19, 14, 5, S - 28, white);
  // linha do meio (vertical, gols nas laterais)
  c.fillRect(S / 2 - 2, 19, 5, S - 38, white);
  // círculo central
  c.ellipse(S / 2, S / 2, 46, 46, { r: 242, g: 242, b: 242, a: 255 });
  c.ellipse(S / 2, S / 2, 40, 40, g1);
  c.ellipse(S / 2, S / 2, 8, 8, white);
  // áreas
  c.fillRect(19, S / 2 - 52, 30, 104, white); c.fillRect(26, S / 2 - 45, 23, 90, g2);
  c.fillRect(S - 49, S / 2 - 52, 30, 104, white); c.fillRect(S - 49, S / 2 - 45, 23, 90, g2);
  // bola 3D no centro (escala 6x da textura 16x16)
  const ball = new Canvas(16, 16);
  ballPattern(ball, 0, 0, 16, { white: '#f6f6f6', black: '#141414' });
  // sombra
  c.ellipse(S / 2, S / 2 + 52, 52, 14, { r: 0, g: 0, b: 0, a: 90 });
  c.blitScaled(ball, 0, 0, 16, 16, S / 2 - 48, S / 2 - 48, 6);
  dir(ROOT);
  const n = c.toPNG(path.join(ROOT, 'pack_icon.png'));
  dir(BP_ROOT);
  fs.copyFileSync(path.join(ROOT, 'pack_icon.png'), path.join(BP_ROOT, 'pack_icon.png'));
  console.log('pack_icon.png ->', n, 'bytes');
}

console.log('✅ Texturas geradas.');
