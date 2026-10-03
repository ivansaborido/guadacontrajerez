// Prueba del modo plataformas: dos corredores de mentira que corren y saltan como locos.
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (c, m) => { out.push((c ? '✅ ' : '❌ ') + m); if (!c) process.exitCode = 1; };
function kid(name) {
  const s = io(URL, { transports: ['websocket'] });
  const k = { s, name, fx: [], race: [], pt: 0, inst: null, last: null, bytes: 0, n: 0 };
  s.on('instance', (i) => (k.inst = i));
  s.on('phase', (p) => (k.inst = { ...k.inst, phase: p }));
  s.on('s', (p) => { k.last = p; k.bytes += JSON.stringify(p).length; k.n++; });
  s.on('fx', (f) => k.fx.push(f));
  s.on('race', (r) => k.race.push(r.state));
  s.on('pt', () => k.pt++);
  k.emit = (ev, d) => new Promise((r) => s.emit(ev, d, r));
  return k;
}
const me = (k) => { const p = k.last.p; for (let i = 0; i < p.length; i += 8) if (p[i] === k.inst.you) return p.slice(i, i + 8); };
(async () => {
  const a = kid('Corredor'), b = kid('Saltarín');
  await sleep(400);
  await a.emit('hello', { name: 'Corredor', token: 'x1' });
  await b.emit('hello', { name: 'Saltarín', token: 'x2' });
  const r = await a.emit('joinRoom', { create: true });
  await b.emit('joinRoom', { code: r.code });
  a.s.emit('goPlat'); await sleep(200); b.s.emit('goPlat');
  await sleep(600);
  ok(a.inst.phase.type === 'plat', `Entran a las plataformas: ${a.inst.phase.name} (${a.inst.phase.LEN} casillas)`);
  ok(a.inst.phase.tiles.length === a.inst.phase.LEN * 18, 'El nivel llega entero una sola vez (' + a.inst.phase.tiles.length + ' casillas)');
  await sleep(4200);
  ok(a.race.includes('race'), '¡Salida! La carrera empieza tras la cuenta atrás');
  let k = 0, kb = 0, best = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    for (const [i, c] of [a, b].entries()) {
      const m = me(c); if (!m) continue;
      best = Math.max(best, m[1]);
      // corre a la derecha, salta a menudo, acelerón y poder de vez en cuando
      k++;
      c.s.emit('i', { x: 1, z: 0, j: true, s: k % 23 === i, k: Math.floor(k / 4), p: Math.floor(k / 40) });
    }
    if (a.fx.some((f) => f.t === 'praceEnd')) break;
    await sleep(60);
  }
  const ma = me(a), mb = me(b);
  ok(best > 40, `Avanzan por el nivel (el más lejano llegó a x=${best.toFixed(0)} de ${a.inst.phase.LEN})`);
  const types = {}; for (const f of a.fx) types[f.t] = (types[f.t] || 0) + 1;
  ok(a.pt > 0 || (ma[7] + mb[7]) > 0, `Se recogen chiquis (cambios de nivel: ${a.pt}, chiquis ahora: ${ma[7]} y ${mb[7]})`);
  ok(Object.keys(types).length >= 3, 'Efectos: ' + JSON.stringify(types));
  ok(a.bytes / a.n < 1500, `Cada foto de estado pesa ${(a.bytes / a.n / 1024).toFixed(2)} KB`);
  a.s.emit('goField'); await sleep(400);
  ok(a.inst.phase.type === 'futbol', 'Vuelve al campo de fútbol');
  console.log(out.join('\n'));
  process.exit();
})();
