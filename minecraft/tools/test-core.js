/**
 * Testes de unidade da lógica pura do mod (roda em Node, sem Minecraft).
 * O core.js é ESM (formato do Bedrock); aqui copiamos para um .mjs temporário.
 *
 * Uso: node minecraft/tools/test-core.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const corePath = path.join(__dirname, '..', 'src', 'behavior', 'scripts', 'core.js');
  const src = fs.readFileSync(corePath, 'utf8');
  const tmp = path.join(os.tmpdir(), `fute-core-test-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, src);
  const C = await import(tmp);

  let passed = 0;
  let failed = 0;
  function t(name, cond) {
    if (cond) { passed++; console.log('  ✅', name); }
    else { failed++; console.error('  ❌', name); }
  }
  function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

  console.log('core.js:');

  // vetores
  t('clamp', C.clamp(5, 0, 3) === 3 && C.clamp(-1, 0, 3) === 0 && C.clamp(2, 0, 3) === 2);
  t('len', near(C.len(3, 4, 0), 5));
  t('norm normaliza', (() => { const n = C.norm(10, 0, 0); return near(n.x, 1) && n.y === 0 && n.z === 0; })());
  t('norm vetor zero não quebra', (() => { const n = C.norm(0, 0, 0); return n.x === 0 && n.y === 0 && n.z === 0; })());

  // chute
  {
    const v = C.kickVel({ x: 1, y: 0, z: 0 }, false);
    t('chute normal vai para frente', near(v.x, 0.56) && near(v.y, 0.14) && v.z === 0);
    const s = C.kickVel({ x: 0, y: 0, z: 1 }, true);
    t('chute sprint é mais forte', near(s.z, 0.84) && near(s.y, 0.24));
    const th = C.throwVel({ x: 0, y: 1, z: 0 });
    t('arremesso para cima ganha elevação', th.y > 0.4 && th.y < 0.8);
  }

  // campo / linhas de gol
  {
    const field = { cx: 100, cz: 200, y: 64 };
    const lines = C.goalLines(field);
    t('linhas de gol simétricas', lines[0].x === 78 && lines[1].x === 122);
    t('cruzou linha do gol leste', C.crossedLine(121, 123, 122) === true);
    t('não cruzou (mesmo lado)', C.crossedLine(121, 123, 121) === false);
    t('dentro da boca do gol', C.inGoalMouth(200, 65, field) === true);
    t('fora da boca (lateral)', C.inGoalMouth(206, 65, field) === false);
    t('acima da trave não é gol', C.inGoalMouth(200, 67.5, field) === false);
    t('gol leste => time azul', C.scoringTeam(122, field) === 'azul');
    t('gol oeste => time vermelho', C.scoringTeam(78, field) === 'vermelho');
  }

  // hat-trick
  {
    t('hat em 3 gols', C.isHatTrick(3) === true && C.hatLevel(3) === 1);
    t('não é hat em 2', C.isHatTrick(2) === false);
    t('não é hat em 0', C.isHatTrick(0) === false);
    t('é hat em 6 (dois)', C.isHatTrick(6) === true && C.hatLevel(6) === 2);
    t('título 3 gols', C.hatTitle(3) === 'HAT-TRICK!');
  }

  // tempo
  t('fmtTime 0', C.fmtTime(0) === '0:00');
  t('fmtTime 65', C.fmtTime(65) === '1:05');
  t('fmtTime 599', C.fmtTime(599) === '9:59');
  t('fmtTime negativo vira 0', C.fmtTime(-5) === '0:00');

  // times
  {
    const r = C.autoAssign(['a', 'b', 'c']);
    t('autoAssign alterna times', r.azul.length === 2 && r.vermelho.length === 1 && r.azul[0] === 'a' && r.vermelho[0] === 'b');
    const r2 = C.autoAssign([]);
    t('autoAssign vazio', r2.azul.length === 0 && r2.vermelho.length === 0);
  }

  // artilheiro / resultado
  {
    const stats = { Ana: { g: 2, k: 5 }, Beto: { g: 5, k: 9 }, Car: { g: 0, k: 3 } };
    const top = C.topScorer(stats);
    t('artilheiro correto', top && top[0] === 'Beto' && top[1] === 5);
    const emp = C.resultText({ azul: 1, vermelho: 1 });
    t('empate', emp.winner === null && /Empate/.test(emp.text));
    const az = C.resultText({ azul: 3, vermelho: 1 });
    t('azul vence', az.winner === 'azul' && /3 x 1/.test(az.text));
    const vr = C.resultText({ azul: 0, vermelho: 2 });
    t('vermelho vence', vr.winner === 'vermelho' && /2 x 0/.test(vr.text));
  }

  // parser de chat
  {
    t('parse /fute inicio 10', JSON.stringify(C.parseChatCommand('/fute inicio 10')) === JSON.stringify(['fute', 'inicio', '10']));
    t('parse !futebol time azul', JSON.stringify(C.parseChatCommand('!futebol time azul')) === JSON.stringify(['futebol', 'time', 'azul']));
    t('parse sem slash', C.parseChatCommand('fute bola')[0] === 'fute');
    t('parse esvaziado', C.parseChatCommand('   ').length === 0);
  }

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
