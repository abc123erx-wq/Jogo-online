/**
 * Futebol 3D — lógica pura (sem dependência da API do Minecraft).
 * Testável em Node via tools/test-core.js.
 */

// ---------- constantes do campo ----------
export const FIELD = {
  W: 44,          // largura (eixo X)
  L: 28,          // comprimento (eixo Z)
  GOAL_HALF: 4,   // meia-largura da boca do gol (bloco)
  POST_H: 3,      // altura dos postes (blocos acima do chão)
  NET_D: 3,       // profundidade da rede (blocos)
  BOX_W: 10,      // largura da grande área
  BOX_D: 7,       // profundidade da grande área
};

// ---------- vetores ----------
export function len(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

export function norm(x, y, z) {
  const l = len(x, y, z);
  if (l < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: x / l, y: y / l, z: z / l };
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ---------- chute / arremesso ----------
/**
 * Velocidade (blocos/tick, 20 tick/s) de um chute dado a direção de mira.
 * Sprint = chute forte.
 */
export function kickVel(view, sprint) {
  const h = Math.hypot(view.x, view.z);
  let dx, dz;
  if (h < 1e-4) { dx = 0; dz = 1; } else { dx = view.x / h; dz = view.z / h; }
  const power = sprint ? 0.84 : 0.56;
  const up = sprint ? 0.24 : 0.14;
  return { x: dx * power, y: up, z: dz * power };
}

/** Velocidade do arremesso da bola (clique direito). */
export function throwVel(view) {
  const h = Math.hypot(view.x, view.z);
  let dx, dz;
  if (h < 1e-4) { dx = 0; dz = 1; } else { dx = view.x / h; dz = view.z / h; }
  return { x: dx * 0.62, y: 0.2 + clamp(view.y * 0.5, -0.25, 0.55), z: dz * 0.62 };
}

// ---------- gols ----------
export function goalLines(field) {
  return [
    { x: field.cx - FIELD.W / 2, dir: -1, side: 'oeste' },
    { x: field.cx + FIELD.W / 2, dir: 1, side: 'leste' },
  ];
}

/** Verifica se o segmento prev->cur cruza a linha vertical em x=lineX. */
export function crossedLine(prevX, curX, lineX) {
  return (prevX - lineX) * (curX - lineX) < 0;
}

/** true se (z,y) está dentro da boca do gol do campo em dado instante. */
export function inGoalMouth(z, y, field) {
  return Math.abs(z - field.cz) <= FIELD.GOAL_HALF && y >= field.y - 0.5 && y <= field.y + FIELD.POST_H;
}

/** Time que ataca o gol LESTE (x = cx + 22) é o AZUL (metade oeste). */
export function scoringTeam(goalLineX, field) {
  return goalLineX > field.cx ? 'azul' : 'vermelho';
}

// ---------- hat-trick ----------
export function hatLevel(goals) {
  return Math.floor(goals / 3);
}

export function isHatTrick(goals) {
  return goals > 0 && goals % 3 === 0;
}

export function hatTitle(goals) {
  if (goals === 3) return 'HAT-TRICK!';
  if (goals === 6) return 'DOIS HAT-TRICKS!!';
  if (goals === 9) return 'TRÊS HAT-TRICKS!!!';
  return `${goals} GOLS!!`;
}

// ---------- utilidades ----------
export function fmtTime(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Distribui jogadores online em dois times equilibrados (em ordem de chegada). */
export function autoAssign(names) {
  const azul = [];
  const vermelho = [];
  for (const n of names) {
    if (azul.length <= vermelho.length) azul.push(n);
    else vermelho.push(n);
  }
  return { azul, vermelho };
}

/** Artilheiro: [nome, gols] ou null. */
export function topScorer(stats) {
  let best = null;
  for (const [name, st] of Object.entries(stats)) {
    if (st && st.g > 0 && (!best || st.g > best[1])) best = [name, st.g];
  }
  return best;
}

/** Resultado de um placar: texto "Azul x Vermelho" e vencedor. */
export function resultText(score) {
  const { azul = 0, vermelho = 0 } = score || {};
  if (azul === vermelho) return { text: `Empate ${azul} x ${vermelho}`, winner: null };
  const winner = azul > vermelho ? 'azul' : 'vermelho';
  const winName = winner === 'azul' ? 'AZUL' : 'VERMELHO';
  const [a, b] = azul > vermelho ? [azul, vermelho] : [vermelho, azul];
  return { text: `${winName} venceu por ${a} x ${b}!`, winner };
}

/**
 * Parser simples de comandos de chat: remove "/" ou "!" inicial e separa tokens.
 * Retorna [sub, arg1, arg2] (arg opcionais podem ser undefined).
 */
export function parseChatCommand(message) {
  const m = String(message || '').trim().replace(/^[/!]+/, '');
  const parts = m.split(/\s+/).filter(Boolean);
  return parts;
}
