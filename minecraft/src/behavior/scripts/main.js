/**
 * ⚽ FUTEBOL 3D — Mod para Minecraft Bedrock 1.26.44
 * ---------------------------------------------------
 * Bola 3D com física própria (gravidade, quique, spin), campo automático com
 * gols, partidas com cronômetro, times, placar persistente, estatísticas,
 * HAT-TRICK com fanfarra e troféu, menu por formulário, sons e partículas.
 *
 * API: @minecraft/server 2.10.0-beta.1.26.44-stable
 */
import {
  world,
  system,
  ItemStack,
  BlockPermutation,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import * as C from './core.js';

// ---------------------------------------------------------------- constantes
const BALL_ID = 'futebol:bola';
const TROPHY_ID = 'futebol:trofeu';
const OBJ_ID = 'fute_placar';
const ENTRY_AZUL = 'Azul';
const ENTRY_VERMELHO = 'Vermelho';

const KEY_FIELD = 'fute.field';
const KEY_MATCH = 'fute.match';
const KEY_STATS = 'fute.stats';
const KEY_HATS = 'fute.hats';
const KEY_TEAMS = 'fute.teams';

const BR = 0.21;         // raio da bola (blocos)
const GRAVITY = 0.0245;  // blocos/tick^2
const BOUNCE = 0.5;      // restituição no chão
const MAX_V = 0.95;      // velocidade máxima (blocos/tick)
const MAX_BALLS = 8;
const GOAL_FREEZE_TICKS = 240; // 12 s até a bola voltar ao centro após gol

// ---------------------------------------------------------------- estado
/** id da entidade -> estado da física da bola */
const balls = new Map();
let field = null;      // {cx, cz, y}
let match = freshMatch();
let stats = {};        // nome -> {g, k, hats}
let hats = [];         // [{name, goals, at}]
let teams = { azul: [], vermelho: [] };
let lastKicker = null; // nome de quem tocou a bola por último
let uiTick = 0;

function freshMatch() {
  return { active: false, paused: false, endsAt: 0, remainMs: 0, score: { azul: 0, vermelho: 0 } };
}

// ---------------------------------------------------------------- persistência
function loadJSON(key, fallback) {
  try {
    const v = world.getDynamicProperty(key);
    if (v === undefined || v === null || v === '') return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try { world.setDynamicProperty(key, JSON.stringify(value)); } catch { /* ignora */ }
}

function loadAll() {
  field = loadJSON(KEY_FIELD, null);
  match = Object.assign(freshMatch(), loadJSON(KEY_MATCH, {}));
  stats = loadJSON(KEY_STATS, {});
  hats = loadJSON(KEY_HATS, []);
  teams = Object.assign({ azul: [], vermelho: [] }, loadJSON(KEY_TEAMS, {}));
}

// ---------------------------------------------------------------- mensagens
function T(text, color) {
  const o = { text };
  if (color) o.color = color;
  return o;
}
function R(...parts) {
  return { rawtext: parts };
}
function say(player, ...parts) {
  if (player) { try { player.sendMessage(R(...parts)); } catch { /* player pode ter saído */ } }
}
function broadcast(...parts) {
  for (const p of world.getAllPlayers()) say(p, ...parts);
}
function toast(player, msg, color = 'green') {
  if (player) {
    try {
      player.onScreenDisplay.setActionBar(R(T(msg, color)));
    } catch { /* ignora */ }
  }
}

// ---------------------------------------------------------------- efeitos
function fx(particleId, pos) {
  try {
    world.getDimension('overworld').spawnParticle(particleId, pos);
  } catch { /* partículas desconhecidas não devem derrubar o jogo */ }
}
function sound(id, pos, opts) {
  try {
    world.getDimension('overworld').playSound(id, pos, opts);
  } catch { /* ignora */ }
}
function fireworks(pos, count) {
  const dim = world.getDimension('overworld');
  for (let i = 0; i < count; i++) {
    try {
      dim.spawnEntity('minecraft:firework_rocket', {
        x: pos.x + (Math.random() - 0.5) * 4,
        y: pos.y + 1,
        z: pos.z + (Math.random() - 0.5) * 4,
      });
    } catch { /* fogos são opcionais */ }
  }
}

// ---------------------------------------------------------------- placar (scoreboard vanilla)
function ensureScoreboard() {
  const dim = world.getDimension('overworld');
  try { dim.runCommand(`scoreboard objectives add ${OBJ_ID} dummy`); } catch { /* já existe */ }
}
function setTeamScore(team, value) {
  const obj = world.scoreboard.getObjective(OBJ_ID);
  if (!obj) return;
  try { obj.setScore(team === 'azul' ? ENTRY_AZUL : ENTRY_VERMELHO, value); } catch { /* ignora */ }
}
function showSidebar() {
  try { world.getDimension('overworld').runCommand(`scoreboard objectives setdisplay sidebar ${OBJ_ID}`); } catch { /* ignora */ }
}
function hideSidebar() {
  try { world.getDimension('overworld').runCommand('scoreboard objectives setdisplay sidebar'); } catch { /* ignora */ }
}

// ---------------------------------------------------------------- campo
function resolvePermutation(name) {
  try { return BlockPermutation.resolve(name); } catch { return undefined; }
}
function placeBlock(dim, x, y, z, perm, replaceableOnly) {
  try {
    const b = dim.getBlock({ x, y, z });
    if (!b || !b.isValid) return;
    if (replaceableOnly) {
      // substitui só a superfície: ar ou qualquer bloco não sólido (grama alta, flores...)
      if (!b.isAir && b.isSolid) return;
    } else if (!b.isAir) {
      return;
    }
    if (perm) b.setPermutation(perm);
  } catch { /* bloco ausente */ }
}
function removeBlockIf(dim, x, y, z, allowed) {
  try {
    const b = dim.getBlock({ x, y, z });
    if (b && b.isValid && allowed.includes(b.typeId)) {
      b.setPermutation(BlockPermutation.resolve('minecraft:air'));
    }
  } catch { /* ignora */ }
}

function buildField(player) {
  const dim = player.dimension;
  const cx = Math.floor(player.location.x);
  const cz = Math.floor(player.location.z);
  const y = Math.floor(player.location.y);
  const F = C.FIELD;
  const halfW = F.W / 2, halfL = F.L / 2;

  const carpet = resolvePermutation('minecraft:white_carpet');
  const concrete = resolvePermutation('minecraft:white_concrete');
  const pane = resolvePermutation('minecraft:white_stained_glass_pane');
  const blueWool = resolvePermutation('minecraft:blue_wool');
  const redWool = resolvePermutation('minecraft:red_wool');

  // linhas de contorno
  for (let x = cx - halfW; x <= cx + halfW; x++) {
    placeBlock(dim, x, y, cz - halfL, carpet, true);
    placeBlock(dim, x, y, cz + halfL, carpet, true);
  }
  for (let z = cz - halfL; z <= cz + halfL; z++) {
    placeBlock(dim, cx - halfW, y, z, carpet, true);
    placeBlock(dim, cx + halfW, y, z, carpet, true);
  }
  // linha do meio
  for (let z = cz - halfL + 1; z <= cz + halfL - 1; z++) placeBlock(dim, cx, y, z, carpet, true);
  // círculo central (raio 4)
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    placeBlock(dim, Math.round(cx + Math.cos(t) * 4), y, Math.round(cz + Math.sin(t) * 4), carpet, true);
  }
  placeBlock(dim, cx, y, cz, carpet, true);

  // grandes áreas + pênaltis
  for (const side of [-1, 1]) {
    const Lx = cx + side * halfW;
    for (let z = cz - F.BOX_W / 2; z <= cz + F.BOX_W / 2; z++) placeBlock(dim, Lx + side * F.BOX_D, y, z, carpet, true);
    for (let dx = 1; dx <= F.BOX_D; dx++) {
      placeBlock(dim, Lx + side * dx, y, cz - F.BOX_W / 2, carpet, true);
      placeBlock(dim, Lx + side * dx, y, cz + F.BOX_W / 2, carpet, true);
    }
    placeBlock(dim, Lx + side * 4, y, cz, carpet, true); // marca do pênalti
  }

  // gols: postes, trave, rede e bandeirinhas (tudo apoiado no chão, nível y)
  for (const side of [-1, 1]) {
    const Lx = cx + side * halfW;
    for (const zs of [-F.GOAL_HALF, F.GOAL_HALF]) {
      for (let h = 0; h < F.POST_H; h++) placeBlock(dim, Lx, y + h, cz + zs, concrete, false);
    }
    for (let z = cz - F.GOAL_HALF + 1; z <= cz + F.GOAL_HALF - 1; z++) placeBlock(dim, Lx, y + F.POST_H - 1, z, concrete, false);
    // rede: fundo completo + laterais + topo
    for (let dx = 1; dx <= F.NET_D; dx++) {
      for (let h = 0; h < F.POST_H; h++) {
        for (let z = cz - F.GOAL_HALF; z <= cz + F.GOAL_HALF; z++) placeBlock(dim, Lx + side * dx, y + h, z, pane, false);
      }
      for (let z = cz - F.GOAL_HALF; z <= cz + F.GOAL_HALF; z++) placeBlock(dim, Lx + side * dx, y + F.POST_H - 1, z, pane, false);
    }
    // bandeirinhas nos cantos
    const flagWool = side === -1 ? blueWool : redWool;
    for (const zs of [-halfL, halfL]) {
      placeBlock(dim, cx + side * halfW, y, cz + zs, concrete, false);
      placeBlock(dim, cx + side * halfW, y + 1, cz + zs, flagWool, false);
    }
  }

  field = { cx, cz, y };
  saveJSON(KEY_FIELD, field);
  sound('fute_count', { x: cx, y: y + 2, z: cz }, { volume: 1 });
  player.onScreenDisplay.setTitle(
    R(T('🏟️ Campo construído!', 'green')),
    { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10, subtitle: R(T('Azul ataca o gol leste. /fute inicio para jogar!', 'yellow')) },
  );
  say(player, T('🏟️ ', 'green'), T('Campo de futebol pronto! Use ', 'white'), T('/fute inicio', 'yellow'), T(' para começar a partida.', 'white'));
}

function destroyField(player) {
  if (!field) { say(player, T('⚠️ Nenhum campo construído.', 'yellow')); return; }
  const dim = player.dimension;
  const { cx, cz, y } = field;
  const F = C.FIELD;
  const halfW = F.W / 2, halfL = F.L / 2;
  const ourBlocks = [
    'minecraft:white_carpet', 'minecraft:white_concrete', 'minecraft:white_stained_glass_pane',
    'minecraft:blue_wool', 'minecraft:red_wool',
  ];
  const strip = (x, z) => removeBlockIf(dim, x, y, z, ourBlocks);
  for (let x = cx - halfW; x <= cx + halfW; x++) { strip(x, cz - halfL); strip(x, cz + halfL); }
  for (let z = cz - halfL; z <= cz + halfL; z++) { strip(cx - halfW, z); strip(cx + halfW, z); }
  for (let z = cz - halfL + 1; z <= cz + halfL - 1; z++) strip(cx, z);
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    strip(Math.round(cx + Math.cos(t) * 4), Math.round(cz + Math.sin(t) * 4));
  }
  for (const side of [-1, 1]) {
    const Lx = cx + side * halfW;
    for (let z = cz - F.BOX_W / 2; z <= cz + F.BOX_W / 2; z++) strip(Lx + side * F.BOX_D, z);
    for (let dx = 1; dx <= F.BOX_D; dx++) { strip(Lx + side * dx, cz - F.BOX_W / 2); strip(Lx + side * dx, cz + F.BOX_W / 2); }
    strip(Lx + side * 4, cz);
    for (const zs of [-F.GOAL_HALF, F.GOAL_HALF]) for (let h = 0; h < F.POST_H; h++) removeBlockIf(dim, Lx, y + h, cz + zs, ourBlocks);
    for (let z = cz - F.GOAL_HALF + 1; z <= cz + F.GOAL_HALF - 1; z++) removeBlockIf(dim, Lx, y + F.POST_H - 1, z, ourBlocks);
    for (let dx = 1; dx <= F.NET_D; dx++) {
      for (let h = 0; h < F.POST_H; h++) {
        for (let z = cz - F.GOAL_HALF; z <= cz + F.GOAL_HALF; z++) removeBlockIf(dim, Lx + side * dx, y + h, z, ourBlocks);
      }
      for (let z = cz - F.GOAL_HALF; z <= cz + F.GOAL_HALF; z++) removeBlockIf(dim, Lx + side * dx, y + F.POST_H - 1, z, ourBlocks);
    }
    for (const zs of [-halfL, halfL]) {
      removeBlockIf(dim, cx + side * halfW, y, cz + zs, ourBlocks);
      removeBlockIf(dim, cx + side * halfW, y + 1, cz + zs, ourBlocks);
    }
  }
  field = null;
  saveJSON(KEY_FIELD, field);
  say(player, T('🧱 Campo removido.', 'yellow'));
}

// ---------------------------------------------------------------- bola
function ballCount() {
  return world.getDimension('overworld').getEntities({ type: BALL_ID }).length;
}

function spawnBall(pos, vel) {
  if (ballCount() >= MAX_BALLS) {
    broadcast(T(`⚠️ Máximo de ${MAX_BALLS} bolas no campo!`, 'yellow'));
    return null;
  }
  const dim = world.getDimension('overworld');
  const e = dim.spawnEntity(BALL_ID, { x: pos.x, y: pos.y, z: pos.z });
  balls.set(e.id, {
    v: { x: vel.x, y: vel.y, z: vel.z },
    lastKick: 0,
    idleTicks: 0,
    goalLock: 0,
    bounceSnd: 0,
    prev: { x: pos.x, y: pos.y, z: pos.z },
  });
  return e;
}

function removeBall(entity) {
  try { entity.kill(); } catch { /* já removida */ }
  balls.delete(entity.id);
}

function playerInventory(player) {
  try { return player.getComponent('inventory')?.container; } catch { return undefined; }
}
function findBolaSlot(container) {
  if (!container) return -1;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && it.typeId === BALL_ID) return i;
  }
  return -1;
}

/** Chute: socar a bola. Sprint = chute forte. */
function kickBall(player, ball) {
  const st = balls.get(ball.id);
  if (!st) return;
  const view = player.getViewDirection();
  const v = C.kickVel(view, player.isSprinting);
  const pos = {
    x: ball.location.x + view.x * 0.3,
    y: ball.location.y + C.clamp(view.y * 0.15 + 0.05, 0, 0.4),
    z: ball.location.z + view.z * 0.3,
  };
  ball.teleport(pos);
  st.v = v;
  st.prev = { ...pos };
  st.lastKick = 10;
  st.idleTicks = 0;
  lastKicker = player.name;
  bumpKicks(player.name);
  sound('fute_kick', pos, { volume: 1, pitch: 0.85 + Math.random() * 0.3 });
  fx('minecraft:critical_hit_particle', pos);
  if (player.isSprinting) strongKickTrail(ball.id); // rastro de luz no chute forte
}

function strongKickTrail(ballId) {
  let count = 0;
  const job = system.runInterval(() => {
    const e = world.getDimension('overworld').getEntities({ type: BALL_ID }).find((x) => x.id === ballId);
    if (!e || ++count > 6) { system.clearJob(job); return; }
    fx('minecraft:glow', e.location);
  }, 2);
}

/** Arremesso: usar o item da bola (clique direito). */
function throwBall(player) {
  const container = playerInventory(player);
  if (!container) return;
  const sel = player.selectedSlotIndex;
  const main = container.getItem(sel);
  if (main && main.typeId === BALL_ID) {
    container.setItem(sel);
  } else {
    const idx = findBolaSlot(container);
    if (idx === -1) return;
    container.setItem(idx);
  }
  const view = player.getViewDirection();
  const v = C.throwVel(view);
  const pos = {
    x: player.location.x + view.x * 0.9,
    y: player.location.y + 1.3 + view.y * 0.9,
    z: player.location.z + view.z * 0.9,
  };
  const b = spawnBall(pos, v);
  if (b) {
    lastKicker = player.name;
    bumpKicks(player.name);
    sound('fute_kick', pos, { volume: 0.8, pitch: 1.1 });
  }
}

/** Pegar a bola: clique direito na bola. */
function pickupBall(player, ball) {
  const container = playerInventory(player);
  if (!container) return;
  const sel = player.selectedSlotIndex;
  const main = container.getItem(sel);
  if (main && main.typeId !== BALL_ID) {
    say(player, T('⚠️ Solte o item da mão para pegar a bola!', 'red'));
    return;
  }
  removeBall(ball);
  if (main && main.typeId === BALL_ID) return; // já estava com a bola
  const left = container.addItem(new ItemStack(BALL_ID, 1));
  sound('fute_pickup', player.location, { volume: 0.8 });
  if (left) {
    try { player.dimension.spawnEntity(BALL_ID, player.location); } catch { /* ignora */ }
  }
}

function giveBall(player) {
  const container = playerInventory(player);
  if (!container) return;
  if (findBolaSlot(container) !== -1) {
    say(player, T('ℹ️ Você já está com uma bola.', 'yellow'));
    return;
  }
  const left = container.addItem(new ItemStack(BALL_ID, 1));
  if (!left) {
    sound('fute_pickup', player.location, { volume: 0.8 });
    say(player, T('⚽ ', 'white'), T('Você recebeu uma bola! Clique direito para jogar, soco para chutar.', 'green'));
  }
}

// ---------------------------------------------------------------- física da bola
function stepBallPhysics(dim, entity, st) {
  const pos = { ...entity.location };
  st.prev = { ...pos };
  const v = st.v;

  v.y -= GRAVITY;
  v.x *= 0.9995; v.y *= 0.9995; v.z *= 0.9995;
  const sp = C.len(v.x, v.y, v.z);
  if (sp > MAX_V) {
    const f = MAX_V / sp;
    v.x *= f; v.y *= f; v.z *= f;
  }

  const solidAt = (px, py, pz) => {
    try {
      const b = dim.getBlock({ x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz) });
      return !!b && b.isSolid;
    } catch { return false; }
  };

  // eixo X
  if (v.x !== 0) {
    const nx = pos.x + v.x;
    if (solidAt(nx + Math.sign(v.x) * BR * 0.7, pos.y, pos.z)) {
      v.x *= -BOUNCE;
    } else pos.x = nx;
  }
  // eixo Z
  if (v.z !== 0) {
    const nz = pos.z + v.z;
    if (solidAt(pos.x, pos.y, nz + Math.sign(v.z) * BR * 0.7)) {
      v.z *= -BOUNCE;
    } else pos.z = nz;
  }
  // eixo Y
  let grounded = false;
  if (v.y !== 0) {
    const ny = pos.y + v.y;
    if (v.y < 0) {
      if (solidAt(pos.x, ny - BR, pos.z)) {
        pos.y = Math.floor(ny - BR) + 1 + BR;
        const impact = -v.y;
        v.y = -v.y * BOUNCE;
        if (Math.abs(v.y) < 0.05) v.y = 0;
        if (impact > 0.09 && st.bounceSnd <= 0) {
          sound('fute_bounce', pos, { volume: Math.min(1, impact * 6), pitch: 0.8 + Math.random() * 0.4 });
          st.bounceSnd = 8;
          if (impact > 0.25) fx('minecraft:critical_hit_particle', pos);
        }
      } else pos.y = ny;
    } else if (solidAt(pos.x, ny + BR, pos.z)) {
      pos.y = Math.floor(ny + BR) - 1 - BR;
      v.y *= -0.4;
    } else pos.y = ny;
  }
  // chão: atrito
  if (solidAt(pos.x, pos.y - BR - 0.02, pos.z)) {
    grounded = true;
    v.x *= 0.985; v.z *= 0.985;
    if (Math.hypot(v.x, v.z) < 0.012) { v.x = 0; v.z = 0; }
  }
  // desvio pelo corpo de jogadores (contenção de bola)
  try {
    for (const p of dim.getEntities({ type: 'minecraft:player', location: pos, maxDistance: 1.3 })) {
      const dx = pos.x - p.location.x;
      const dz = pos.z - p.location.z;
      const dy = pos.y - (p.location.y + 0.9);
      const d = Math.hypot(dx, dz);
      if (Math.abs(dy) < 1.0 && d < 0.5) {
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        pos.x = p.location.x + nx * 0.5;
        pos.z = p.location.z + nz * 0.5;
        const dot = v.x * nx + v.z * nz;
        if (dot < 0) {
          v.x -= 1.6 * dot * nx;
          v.z -= 1.6 * dot * nz;
        }
        v.x *= 0.92; v.z *= 0.92;
      }
    }
  } catch { /* ignora */ }

  entity.teleport(pos);

  if (st.bounceSnd > 0) st.bounceSnd--;
}

function ballTick() {
  const dim = world.getDimension('overworld');
  for (const e of dim.getEntities({ type: BALL_ID })) {
    let st = balls.get(e.id);
    if (!st) {
      st = { v: { x: 0, y: 0, z: 0 }, lastKick: 0, idleTicks: 0, goalLock: 0, bounceSnd: 0, prev: { ...e.location } };
      balls.set(e.id, st);
    }
    const prev = { ...st.prev };
    stepBallPhysics(dim, e, st);

    // queda livre / fora do mapa
    if (e.location.y < -25) {
      const center = field ? { x: field.cx, y: field.y + BR + 0.2, z: field.cz } : { x: e.location.x, y: 100, z: e.location.z };
      e.teleport(center);
      st.v = { x: 0, y: 0, z: 0 };
      continue;
    }

    // gol? (só conta a travessia em direção à rede, evita "gol fantasma" na volta)
    if (match.active && field && st.goalLock <= 0) {
      for (const L of C.goalLines(field)) {
        if (C.crossedLine(prev.x, e.location.x, L.x) && Math.sign(e.location.x - prev.x) === L.dir) {
          const t = (L.x - prev.x) / (e.location.x - prev.x);
          const zy = prev.z + (e.location.z - prev.z) * t;
          const yz = prev.y + (e.location.y - prev.y) * t;
          if (C.inGoalMouth(zy, yz, field)) {
            st.goalLock = 60; // evita gol duplo enquanto a bola está na rede
            onGoal(C.scoringTeam(L.x, field), e.location, e, st);
          }
        }
      }
    }
    if (st.goalLock > 0) st.goalLock--;

    // bola parada
    const sp = C.len(st.v.x, st.v.y, st.v.z);
    if (sp < 0.02) st.idleTicks++; else st.idleTicks = 0;
    if (st.idleTicks === 60 * 120) {
      broadcast(T('⚽ A bola ficou parada demais e desapareceu. /fute bola', 'gray'));
      removeBall(e);
    }
  }
}

// ---------------------------------------------------------------- gol + hat-trick
function bumpKicks(name) {
  stats[name] = stats[name] || { g: 0, k: 0, hats: 0 };
  stats[name].k++;
  saveJSON(KEY_STATS, stats);
}

function onGoal(team, pos, ball, st) {
  match.score[team] = (match.score[team] || 0) + 1;
  saveJSON(KEY_MATCH, match);
  setTeamScore(team, match.score[team]);

  const dim = world.getDimension('overworld');
  const { azul, vermelho } = match.score;
  const teamName = team === 'azul' ? 'AZUL' : 'VERMELHO';
  const teamColor = team === 'azul' ? 'blue' : 'red';

  sound('fute_goal', pos, { volume: 1 });
  sound('fute_whistle', pos, { volume: 0.7, pitch: 1.15 });
  fireworks(pos, 4);
  for (let i = 0; i < 14; i++) {
    fx('minecraft:totem_particle', { x: pos.x + (Math.random() - 0.5) * 3, y: pos.y + 1 + Math.random() * 2, z: pos.z + (Math.random() - 0.5) * 3 });
  }
  for (let i = 0; i < 10; i++) {
    fx('minecraft:endrod', { x: pos.x + (Math.random() - 0.5) * 2, y: pos.y + 1 + Math.random() * 2.5, z: pos.z + (Math.random() - 0.5) * 2 });
  }

  const scorer = lastKicker;
  if (scorer) bumpGoal(scorer);

  for (const p of world.getAllPlayers()) {
    try {
      p.onScreenDisplay.setTitle(
        R(T('⚽ GOOOL!', 'light_purple')),
        {
          fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 14,
          subtitle: R(
            T('Gol do time ', 'white'), T(teamName, teamColor), T(` — ${azul} x ${vermelho}`, 'yellow'),
            scorer ? T(` (gol de ${scorer})`, 'gray') : T('', 'white'),
          ),
        },
      );
    } catch { /* ignora */ }
  }
  broadcast(
    T('⚽ GOOOL! ', 'light_purple'),
    T(`Time ${teamName} marcou! Placar: `, 'white'),
    T(`${azul} x ${vermelho}`, 'yellow'),
    scorer ? T(` — gol de ${scorer}`, 'gray') : T('', 'white'),
  );

  // hat-trick com pequeno atraso (deixa o "GOOOL" aparecer antes)
  if (scorer) {
    const name = scorer;
    system.runTimeout(() => checkHatTrick(name), 30);
  }

  // a bola volta ao centro depois da comemoração
  const ballId = ball.id;
  const center = field;
  system.runTimeout(() => {
    try {
      const e = world.getDimension('overworld').getEntities({ type: BALL_ID }).find((x) => x.id === ballId);
      if (!e || !center) return;
      e.teleport({ x: center.cx, y: center.y + BR + 0.2, z: center.cz });
      const s = balls.get(e.id);
      if (s) { s.v = { x: 0, y: 0, z: 0 }; s.idleTicks = 0; s.goalLock = 20; s.prev = { x: center.cx, y: center.y + BR + 0.2, z: center.cz }; }
      sound('fute_whistle', { x: center.cx, y: center.y + 2, z: center.cz }, { volume: 0.9 });
    } catch { /* ignora */ }
  }, GOAL_FREEZE_TICKS);
}

function bumpGoal(name) {
  stats[name] = stats[name] || { g: 0, k: 0, hats: 0 };
  stats[name].g++;
  saveJSON(KEY_STATS, stats);
}

function checkHatTrick(name) {
  const st = stats[name];
  if (!st || !C.isHatTrick(st.g)) return;
  const goals = st.g;
  st.hats = (st.hats || 0) + 1;
  saveJSON(KEY_STATS, stats);
  hats.push({ name, goals, at: Date.now() });
  saveJSON(KEY_HATS, hats);

  const dim = world.getDimension('overworld');
  const player = world.getAllPlayers().find((p) => p.name === name);
  const at = player ? player.location : { x: 0, y: 70, z: 0 };

  sound('fute_hat', at, { volume: 1 });
  fireworks(at, 5);
  for (let i = 0; i < 10; i++) {
    fx('minecraft:heart_particle', { x: at.x + (Math.random() - 0.5) * 3, y: at.y + 1 + Math.random() * 1.5, z: at.z + (Math.random() - 0.5) * 3 });
  }
  for (let i = 0; i < 8; i++) {
    fx('minecraft:totem_particle', { x: at.x + (Math.random() - 0.5) * 2, y: at.y + 1 + Math.random() * 2, z: at.z + (Math.random() - 0.5) * 2 });
  }

  for (const p of world.getAllPlayers()) {
    try {
      p.onScreenDisplay.setTitle(
        R(T('🎩 HAT-TRICK — ', 'gold'), T(name, 'yellow'), T('!', 'gold')),
        {
          fadeInDuration: 6, stayDuration: 50, fadeOutDuration: 16,
          subtitle: R(T(`${goals} gols! ${C.hatTitle(goals)}`, 'gold')),
        },
      );
    } catch { /* ignora */ }
  }
  broadcast(T('🎩 HAT-TRICK! ', 'gold'), T(name, 'yellow'), T(` fez ${goals} gols!`, 'white'));

  if (player && st.hats === 1) {
    const container = playerInventory(player);
    if (container) {
      try {
        const left = container.addItem(new ItemStack(TROPHY_ID, 1));
        if (left) say(player, T('🏆 Troféu de Hat-Trick! (inventário cheio — /fute hat)', 'gold'));
        else say(player, T('🏆 Você recebeu o Troféu de Hat-Trick!', 'gold'));
      } catch { /* ignora */ }
    }
  }
}

// ---------------------------------------------------------------- partida
function startMatch(player, minutes) {
  if (match.active) {
    say(player, T('ℹ️ Já existe uma partida em andamento. Use /fute fim para encerrar.', 'yellow'));
    return { status: CustomCommandStatus.Failure, message: 'Partida já em andamento.' };
  }
  if (!field) {
    say(player, T('⚠️ Construa o campo primeiro: ', 'yellow'), T('/fute campo', 'aqua'));
    return { status: CustomCommandStatus.Failure, message: 'Construa o campo antes (/fute campo).' };
  }
  minutes = C.clamp(Math.floor(minutes) || 10, 1, 120);

  // time automático para quem não tem time
  for (const p of world.getAllPlayers()) {
    if (!teams.azul.includes(p.name) && !teams.vermelho.includes(p.name)) {
      if (teams.azul.length <= teams.vermelho.length) teams.azul.push(p.name);
      else teams.vermelho.push(p.name);
    }
  }
  saveJSON(KEY_TEAMS, teams);

  if (teams.azul.length < 1 || teams.vermelho.length < 1) {
    say(player, T('⚠️ Cada time precisa de ao menos 1 jogador (/fute time azul ou vermelho).', 'yellow'));
    return { status: CustomCommandStatus.Failure, message: 'Times incompletos.' };
  }

  match = freshMatch();
  match.active = true;
  match.endsAt = Date.now() + minutes * 60000;
  saveJSON(KEY_MATCH, match);
  ensureScoreboard();
  setTeamScore('azul', 0);
  setTeamScore('vermelho', 0);
  showSidebar();

  const pos = { x: field.cx, y: field.y + 2, z: field.cz };
  sound('fute_whistle', pos, { volume: 1 });
  for (const p of world.getAllPlayers()) {
    try {
      p.onScreenDisplay.setTitle(
        R(T('🏁 Partida iniciada!', 'green')),
        {
          fadeInDuration: 6, stayDuration: 50, fadeOutDuration: 14,
          subtitle: R(T(`${minutes} minutos — Azul ataca o gol leste`, 'yellow')),
        },
      );
    } catch { /* ignora */ }
  }
  broadcast(
    T('🏁 Partida de ', 'green'), T(`${minutes} min`, 'yellow'), T(' começou!', 'green'),
    T(' | Azul: ', 'white'), T(teams.azul.join(', ') || '-', 'blue'),
    T(' | Vermelho: ', 'white'), T(teams.vermelho.join(', ') || '-', 'red'),
  );
  return { status: CustomCommandStatus.Success };
}

function pauseMatch(player) {
  if (!match.active) { say(player, T('ℹ️ Nenhuma partida em andamento.', 'yellow')); return; }
  if (match.paused) { resumeMatch(player); return; }
  match.paused = true;
  match.remainMs = Math.max(0, match.endsAt - Date.now());
  saveJSON(KEY_MATCH, match);
  broadcast(T('⏸ Partida pausada. /fute continua', 'yellow'));
}

function resumeMatch(player) {
  if (!match.active || !match.paused) { say(player, T('ℹ️ Nenhuma partida pausada.', 'yellow')); return; }
  match.paused = false;
  match.endsAt = Date.now() + match.remainMs;
  saveJSON(KEY_MATCH, match);
  broadcast(T('▶️ Partida retomada!', 'green'));
}

function endMatch(player, natural) {
  if (!match.active) { say(player, T('ℹ️ Nenhuma partida em andamento.', 'yellow')); return; }
  match.active = false;
  match.paused = false;
  saveJSON(KEY_MATCH, match);
  hideSidebar();

  const pos = field ? { x: field.cx, y: field.y + 2, z: field.cz } : { x: 0, y: 70, z: 0 };
  sound('fute_end', pos, { volume: 1 });

  const res = C.resultText(match.score);
  const top = C.topScorer(stats);
  const hatList = hats.filter((h) => h.goals >= 3);

  const lines = [
    R(T('🏁 FIM DE JOGO — ', 'gold'), T(res.text, res.winner ? (res.winner === 'azul' ? 'blue' : 'red') : 'yellow')),
  ];
  if (top) lines.push(R(T('👑 Artilheiro: ', 'white'), T(`${top[0]} (${top[1]})`, 'gold')));
  if (hatList.length) {
    lines.push(R(T('🎩 Hat-tricks: ', 'white'), T(hatList.map((h) => `${h.name} (${h.goals})`).join(', '), 'gold')));
  }
  if (!natural && player) lines.push(R(T('Partida encerrada por ' + player.name + '.', 'gray')));
  lines.push(R(T('/fute inicio ', 'aqua'), T('para uma nova partida.', 'gray')));
  for (const p of world.getAllPlayers()) {
    for (const l of lines) say(p, l);
    try { p.onScreenDisplay.setActionBar(R(T('', 'white'))); } catch { /* ignora */ }
  }
  if (player) {
    try {
      player.onScreenDisplay.setTitle(
        R(T('🏁 FIM DE JOGO', 'gold')),
        { fadeInDuration: 8, stayDuration: 60, fadeOutDuration: 20, subtitle: R(T(res.text, 'yellow')) },
      );
    } catch { /* ignora */ }
  }
}

function matchTick() {
  if (!match.active) return;
  uiTick++;
  if (match.paused) return;

  const now = Date.now();
  const remainMs = match.endsAt - now;
  if (remainMs <= 0) {
    endMatch(null, true);
    return;
  }

  // aviso aos 60s
  if (Math.ceil(remainMs / 1000) <= 60 && uiTick % 60 === 0) {
    for (const p of world.getAllPlayers()) {
      try { p.onScreenDisplay.setActionBar(R(T('⏱ Último minuto! ', 'red'), T(C.fmtTime(remainMs / 1000), 'yellow'))); } catch { /* ignora */ }
    }
  }

  // actionbar com placar + tempo (a cada 1s)
  if (uiTick % 20 === 0) {
    const text = R(
      T('⚽ ', 'white'),
      T('Azul', 'blue'), T(` ${match.score.azul} x ${match.score.vermelho} `, 'white'),
      T('Vermelho', 'red'),
      T('  |  ', 'dark_gray'),
      T(C.fmtTime(remainMs / 1000), 'yellow'),
    );
    for (const p of world.getAllPlayers()) {
      try { p.onScreenDisplay.setActionBar(text); } catch { /* ignora */ }
    }
  }

  // som de torcida ao fundo (se alguém estiver perto do campo)
  if (uiTick % 70 === 0 && field) {
    const near = world.getAllPlayers().some((p) => {
      const dx = p.location.x - field.cx, dz = p.location.z - field.cz;
      return dx * dx + dz * dz < 120 * 120;
    });
    if (near) sound('fute_crowd', { x: field.cx, y: field.y + 2, z: field.cz }, { volume: 0.55, pitch: 0.85 + Math.random() * 0.3 });
  }
}

// ---------------------------------------------------------------- estatísticas
function statsLines() {
  const names = Object.keys(stats);
  if (!names.length) return [R(T('Nenhuma estatística ainda.', 'gray'))];
  const lines = [R(T('⚽ Estatísticas:  ', 'aqua'), T('(gol / chute)', 'dark_gray'))];
  const sorted = names.slice().sort((a, b) => (stats[b].g - stats[a].g) || (stats[b].k - stats[a].k));
  for (const n of sorted) {
    const s = stats[n];
    const hat = s.g >= 3 ? T(' 🎩', 'gold') : T('', 'white');
    lines.push(R(T(' • ', 'yellow'), T(n, 'white'), T(` — ${s.g} gol(s), ${s.k} chute(s)`, 'gray'), hat));
  }
  const top = C.topScorer(stats);
  if (top) lines.push(R(T('👑 Artilheiro: ', 'white'), T(`${top[0]} (${top[1]})`, 'gold')));
  return lines;
}

function showPlacar(player) {
  if (!match.active) {
    say(player, T('ℹ️ Nenhuma partida em andamento. Placar: ', 'yellow'),
      T(`${match.score.azul} x ${match.score.vermelho}`, 'white'));
    return;
  }
  const remain = Math.max(0, match.endsAt - Date.now());
  say(player,
    T('⚽ Placar: ', 'white'),
    T(`Azul ${match.score.azul} x ${match.score.vermelho} Vermelho`, 'yellow'),
    T(match.paused ? ' (pausada)' : ''),
    T(` — ${C.fmtTime(remain / 1000)} restantes`, 'gray'),
  );
}

function showHats(player) {
  if (!hats.length) { say(player, T('🎩 Ninguém fez hat-trick ainda.', 'yellow')); return; }
  say(player, T('🎩 Hat-tricks: ', 'gold'));
  for (const h of hats) say(player, T(' • ', 'yellow'), T(`${h.name} — ${h.goals} gols`, 'gold'));
}

function resetAll(player) {
  match = freshMatch();
  stats = {};
  hats = [];
  lastKicker = null;
  saveJSON(KEY_MATCH, match);
  saveJSON(KEY_STATS, stats);
  saveJSON(KEY_HATS, hats);
  setTeamScore('azul', 0);
  setTeamScore('vermelho', 0);
  hideSidebar();
  for (const p of world.getAllPlayers()) { try { p.onScreenDisplay.setActionBar(R(T('🔄 Reset concluído!', 'aqua'))); } catch { /* ignora */ } }
  say(player, T('♻️ Placar, estatísticas e hat-tricks foram resetados.', 'aqua'));
}

function clearBalls(player) {
  const dim = world.getDimension('overworld');
  let n = 0;
  for (const e of dim.getEntities({ type: BALL_ID })) { removeBall(e); n++; }
  say(player, T(`🗑️ ${n} bola(s) removida(s) do campo.`, 'yellow'));
}

// ---------------------------------------------------------------- times
function joinTeam(player, team) {
  teams.azul = teams.azul.filter((n) => n !== player.name);
  teams.vermelho = teams.vermelho.filter((n) => n !== player.name);
  teams[team].push(player.name);
  saveJSON(KEY_TEAMS, teams);
  sound('fute_count', player.location, { volume: 0.6 });
  const color = team === 'azul' ? 'blue' : 'red';
  say(player, T(`👕 Você entrou para o time ${team.toUpperCase()}! `, color), T('(saindo: /fute time sair)', 'dark_gray'));
  toast(player, `Time ${team.toUpperCase()} — ${teams[team].length} jogador(es)`, color);
}
function leaveTeam(player) {
  teams.azul = teams.azul.filter((n) => n !== player.name);
  teams.vermelho = teams.vermelho.filter((n) => n !== player.name);
  saveJSON(KEY_TEAMS, teams);
  say(player, T('👕 Você saiu do time. /fute time azul | vermelho', 'yellow'));
}
function showTeams(player) {
  say(player, T('👥 Times:  ', 'aqua'));
  say(player, T(' 🔵 Azul: ', 'blue'), T(teams.azul.join(', ') || 'ninguém', 'white'));
  say(player, T(' 🔴 Vermelho: ', 'red'), T(teams.vermelho.join(', ') || 'ninguém', 'white'));
}

// ---------------------------------------------------------------- ajuda + menu
const HELP = [
  R(T('⚽ FUTEBOL 3D — comandos', 'green')),
  R(T(' /fute campo ', 'aqua'), T('— constrói o campo (onde você estiver)', 'gray')),
  R(T(' /fute campo apagar ', 'aqua'), T('— remove o campo', 'gray')),
  R(T(' /fute inicio [min] ', 'aqua'), T('— inicia partida (padrão 10 min)', 'gray')),
  R(T(' /fute pausa | continua | fim ', 'aqua'), T('— controle da partida', 'gray')),
  R(T(' /fute time azul|vermelho|sair ', 'aqua'), T('— entre/saia de time', 'gray')),
  R(T(' /fute times ', 'aqua'), T('— vê os times', 'gray')),
  R(T(' /fute bola ', 'aqua'), T('— ganha uma bola de futebol', 'gray')),
  R(T(' /fute apagar ', 'aqua'), T('— remove todas as bolas', 'gray')),
  R(T(' /fute placar | stats | hat ', 'aqua'), T('— placar, estatísticas, hat-tricks', 'gray')),
  R(T(' /fute menu ', 'aqua'), T('— menu gráfico completo', 'gray')),
  R(T(' /fute reset ', 'aqua'), T('— zera placar e estatísticas', 'gray')),
  R(T('', 'white')),
  R(T('🎮 Como jogar: ', 'yellow')),
  R(T(' • Clique direito (com a bola) = jogar a bola', 'gray')),
  R(T(' • Soco na bola = chute (correndo = chute forte)', 'gray')),
  R(T(' • Clique direito na bola = pegar', 'gray')),
  R(T(' • Faça 3 gols para o HAT-TRICK! 🎩', 'gray')),
];

function showHelp(player) {
  if (!player) return;
  for (const l of HELP) say(player, l);
}

function showMenu(player) {
  try {
    const form = new ActionFormData().title('⚽ Futebol 3D');
    form.button(match.active ? (match.paused ? '▶️ Continuar partida' : '⏸ Pausar partida') : '🏟️ Construir campo');
    if (!match.active) form.button('🏁 Iniciar partida (10 min)');
    if (match.active) form.button('⏹ Encerrar partida');
    if (field) form.button('🧱 Apagar campo');
    form.button('🔵 Time Azul').button('🔴 Time Vermelho').button('⚽ Ganhar bola');
    form.button('🗑️ Remover bolas').button('📊 Estatísticas').button('🎩 Hat-tricks');
    form.button('🏁 Resetar tudo').button('❓ Ajuda');
    form.show(player).then((resp) => {
      if (resp.canceled) return;
      const order = [];
      if (match.active) order.push(match.paused ? 'resume' : 'pause');
      else { order.push('build'); order.push('start'); }
      if (match.active) order.push('end');
      if (field) order.push('rmfield');
      order.push('teamazul', 'teamverm', 'ball', 'clearballs', 'stats', 'hat', 'reset', 'help');
      const act = order[resp.selection];
      switch (act) {
        case 'pause': pauseMatch(player); break;
        case 'resume': resumeMatch(player); break;
        case 'build':
          if (field) { say(player, T('ℹ️ O campo já existe. Use "Apagar campo" para reconstruir.', 'yellow')); }
          else { buildField(player); }
          break;
        case 'start': startMatch(player, 10); break;
        case 'end': endMatch(player, false); break;
        case 'rmfield': destroyField(player); break;
        case 'teamazul': joinTeam(player, 'azul'); break;
        case 'teamverm': joinTeam(player, 'vermelho'); break;
        case 'ball': giveBall(player); break;
        case 'clearballs': clearBalls(player); break;
        case 'stats': for (const l of statsLines()) say(player, l); break;
        case 'hat': showHats(player); break;
        case 'reset': resetAll(player); break;
        case 'help': showHelp(player); break;
        default: break;
      }
    }).catch(() => { /* jogador fechou o formulário */ });
  } catch { /* UI indisponível */ }
}

// ---------------------------------------------------------------- dispatcher de comandos
function dispatch(player, sub, a1, a2) {
  switch (sub) {
    case '':
    case 'ajuda':
    case 'help':
      showHelp(player);
      return { status: CustomCommandStatus.Success };

    case 'campo':
      if (!player) return { status: CustomCommandStatus.Failure, message: 'Só um jogador pode construir o campo.' };
      if (a1 === 'apagar') { destroyField(player); }
      else if (field) { say(player, T('ℹ️ Já existe um campo. Use ', 'yellow'), T('/fute campo apagar', 'aqua'), T(' para reconstruir.', 'yellow')); }
      else { buildField(player); }
      return { status: CustomCommandStatus.Success };

    case 'inicio':
    case 'start':
      return startMatch(player, parseInt(a1, 10) || 10);

    case 'pausa':
    case 'pause':
      pauseMatch(player);
      return { status: CustomCommandStatus.Success };

    case 'continua':
    case 'resume':
      resumeMatch(player);
      return { status: CustomCommandStatus.Success };

    case 'fim':
    case 'end':
      endMatch(player, false);
      return { status: CustomCommandStatus.Success };

    case 'time':
    case 'equipe':
      if (!player) return { status: CustomCommandStatus.Failure, message: 'Só jogadores.' };
      if (a1 === 'azul') joinTeam(player, 'azul');
      else if (a1 === 'vermelho' || a1 === 'vermelha') joinTeam(player, 'vermelho');
      else if (a1 === 'sair') leaveTeam(player);
      else showTeams(player);
      return { status: CustomCommandStatus.Success };

    case 'times':
      showTeams(player);
      return { status: CustomCommandStatus.Success };

    case 'bola':
      if (!player) return { status: CustomCommandStatus.Failure, message: 'Só jogadores.' };
      giveBall(player);
      return { status: CustomCommandStatus.Success };

    case 'apagar':
      clearBalls(player || world.getAllPlayers()[0]);
      return { status: CustomCommandStatus.Success };

    case 'placar':
      showPlacar(player || world.getAllPlayers()[0]);
      return { status: CustomCommandStatus.Success };

    case 'stats':
    case 'stat':
      for (const l of statsLines()) say(player || world.getAllPlayers()[0], l);
      return { status: CustomCommandStatus.Success };

    case 'hat':
      showHats(player || world.getAllPlayers()[0]);
      return { status: CustomCommandStatus.Success };

    case 'reset':
      resetAll(player || world.getAllPlayers()[0]);
      return { status: CustomCommandStatus.Success };

    case 'menu':
      if (player) showMenu(player);
      return { status: CustomCommandStatus.Success };

    default:
      if (player) say(player, T(`❌ Comando desconhecido: /fute ${sub} — use `, 'red'), T('/fute ajuda', 'aqua'));
      return { status: CustomCommandStatus.Failure, message: `Comando desconhecido: ${sub}` };
  }
}

function handleCommand(origin, acao, a1, a2) {
  const player = origin && origin.initiator && origin.initiator.typeId === 'minecraft:player' ? origin.initiator : null;
  try {
    return dispatch(player, String(acao || 'ajuda').toLowerCase().trim(), String(a1 || '').toLowerCase(), String(a2 || '').toLowerCase());
  } catch (e) {
    if (player) say(player, T('⚠️ Erro ao executar o comando: ', 'red'), T(String(e && e.message ? e.message : e), 'gray'));
    return { status: CustomCommandStatus.Failure, message: 'Erro interno.' };
  }
}

// ---------------------------------------------------------------- eventos
function registerEvents() {
  // bem-vindo
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (!ev.initialSpawn) return;
    const p = ev.player;
    system.runTimeout(() => {
      try {
        p.onScreenDisplay.setTitle(
          R(T('⚽ Futebol 3D', 'green')),
          { fadeInDuration: 6, stayDuration: 50, fadeOutDuration: 14, subtitle: R(T('Digite /fute ajuda para começar!', 'yellow')) },
        );
      } catch { /* ignora */ }
    }, 20);
  });

  // sair do time ao deixar o jogo
  world.afterEvents.playerLeave.subscribe((ev) => {
    teams.azul = teams.azul.filter((n) => n !== ev.player.name);
    teams.vermelho = teams.vermelho.filter((n) => n !== ev.player.name);
    saveJSON(KEY_TEAMS, teams);
  });

  // remover registro de bola
  world.afterEvents.entityRemove.subscribe((ev) => {
    if (ev.typeId === BALL_ID) balls.delete(ev.removedEntityId);
  });

  // chute: socar a bola
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    if (ev.damagingEntity.typeId !== 'minecraft:player') return;
    if (ev.hitEntity.typeId !== BALL_ID) return;
    kickBall(ev.damagingEntity, ev.hitEntity);
  });

  // pegar: clique direito na bola
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.target.typeId !== BALL_ID) return;
    pickupBall(ev.player, ev.target);
  });

  // jogar: usar o item da bola (clique direito em qualquer bloco)
  world.beforeEvents.itemUse.subscribe((ev) => {
    if (ev.itemStack && ev.itemStack.typeId === BALL_ID) {
      ev.cancel = true;
      throwBall(ev.source);
    }
  });

  // jogar: socar o chão/bloco segurando a bola
  world.afterEvents.entityHitBlock.subscribe((ev) => {
    if (ev.damagingEntity.typeId !== 'minecraft:player') return;
    const p = ev.damagingEntity;
    const container = playerInventory(p);
    if (!container) return;
    const main = container.getItem(p.selectedSlotIndex);
    if (main && main.typeId === BALL_ID) throwBall(p);
  });

  // comandos por chat (alternativa: /fute ... chega como texto)
  world.afterEvents.chatSend.subscribe((ev) => {
    const parts = C.parseChatCommand(ev.message);
    if (parts.length && (parts[0] === 'fute' || parts[0] === 'futebol')) {
      parts.shift();
      handleCommand({ initiator: ev.sender }, parts[0], parts[1], parts[2]);
    }
  });

  // carga do mundo
  world.afterEvents.worldLoad.subscribe(() => {
    loadAll();
    ensureScoreboard();
    const dim = world.getDimension('overworld');
    for (const e of dim.getEntities({ type: BALL_ID })) {
      balls.set(e.id, { v: { x: 0, y: 0, z: 0 }, lastKick: 0, idleTicks: 0, goalLock: 0, bounceSnd: 0, prev: { ...e.location } });
    }
    // partida que passou do tempo durante o server offline
    if (match.active && !match.paused && Date.now() > match.endsAt) {
      endMatch(null, true);
    } else if (match.active) {
      showSidebar();
    }
    if (match.active) {
      broadcast(T('⚽ A partida anterior foi restaurada! Use /fute fim para encerrar.', 'yellow'));
    }
  });
}

function registerCommands() {
  const base = {
    name: 'fute',
    description: 'Mod de Futebol 3D — /fute ajuda',
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: 'acao', type: CustomCommandParamType.String },
      { name: 'arg1', type: CustomCommandParamType.String },
      { name: 'arg2', type: CustomCommandParamType.String },
    ],
  };
  system.customCommandRegistry.registerCommand(base, (origin, ...args) => handleCommand(origin, ...args));
  system.customCommandRegistry.registerCommand(
    { ...base, name: 'futebol', description: 'Mod de Futebol 3D — /futebol ajuda' },
    (origin, ...args) => handleCommand(origin, ...args),
  );
}

// ---------------------------------------------------------------- bootstrap
registerCommands();
registerEvents();
system.runInterval(() => {
  try {
    ballTick();
    matchTick();
  } catch (e) {
    try { world.sendMessage(R(T('⚠️ [Futebol3D] erro: ', 'red'), T(String(e && e.message ? e.message : e), 'gray'))); } catch { /* ignora */ }
  }
}, 1);
