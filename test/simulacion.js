// Prueba con chavales de mentira: entran, juegan, meriendan, se retan.
// Uso: PHASE_SECONDS=4 node index.js  (en otra terminal)  y luego  node test/simulacion.js
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const face = 'data:image/jpeg;base64,' + Buffer.alloc(5000, 7).toString('base64');
const log = [];
const ok = (cond, msg) => { log.push((cond ? '✅ ' : '❌ ') + msg); if (!cond) process.exitCode = 1; };

function kid(name) {
  const s = io(URL, { transports: ['websocket'] });
  const k = { s, name, snaps: 0, toasts: [], fx: [], roster: [], phases: [], faces: {}, challenged: null, instance: null, lastSnap: null, bytes: 0 };
  s.on('s', (p) => { k.snaps++; k.lastSnap = p; k.bytes += JSON.stringify(p).length; });
  s.on('toast', (t) => k.toasts.push(t.text));
  s.on('fx', (f) => k.fx.push(f));
  s.on('roster', (r) => (k.roster = r));
  s.on('phase', (p) => k.phases.push(p.id));
  s.on('instance', (i) => { k.instance = i; k.phases.push(i.phase.id); });
  s.on('faces', (f) => Object.assign(k.faces, f));
  s.on('challenged', (c) => (k.challenged = c));
  k.emit = (ev, d) => new Promise((r) => s.emit(ev, d, r));
  return k;
}

(async () => {
  const nico = kid('Nico'), pablo = kid('Pablo'), lucia = kid('Lucía');
  await sleep(500);
  const h1 = await nico.emit('hello', { name: 'Nico', token: 't1', face });
  ok(h1.ok, 'Nico se conecta');
  const room = await nico.emit('joinRoom', { create: true });
  ok(room.ok && room.code.length === 4, 'Nico crea la sala ' + room.code);
  await sleep(400);
  ok(nico.roster.some((p) => p.bot), 'Al estar solo, entra un bot a jugar con él');
  await pablo.emit('hello', { name: 'Pablo', token: 't2', face });
  await sleep(200);
  ok(nico.toasts.some((t) => t.includes('Pablo se ha conectao')), 'A Nico le llega la notificación de que Pablo se ha conectado');
  const dup = await lucia.emit('hello', { name: 'nico', token: 't3' });
  ok(!dup.ok, 'No deja dos "Nico" a la vez: ' + dup.error);
  await lucia.emit('hello', { name: 'Lucía', token: 't3' });
  const j2 = await pablo.emit('joinRoom', { code: room.code });
  await lucia.emit('joinRoom', { code: room.code });
  ok(j2.ok, 'Pablo entra con el código');
  await sleep(500);
  ok(!nico.roster.some((p) => p.bot), 'Con 3 personas el bot se va');
  const teams = nico.roster.map((p) => p.team);
  ok(teams.includes(0) && teams.includes(1), 'Hay gente en Jerez y en Guadalcacín: ' + nico.roster.map((p) => p.name + ':' + p.team).join(', '));
  // caras: sólo las que pido
  pablo.s.emit('needFaces', [nico.s.id]);
  await sleep(300);
  ok(pablo.faces[nico.s.id]?.f === face, 'Pablo recibe la cara de Nico una sola vez (' + face.length + ' bytes)');
  // movimiento
  const before = nico.lastSnap;
  for (let i = 0; i < 30; i++) { nico.s.emit('i', { x: 1, z: 0, s: false, k: i % 5 === 0 ? i : 0 }); await sleep(50); }
  const find = (snap, nid) => { for (let i = 0; i < snap.p.length; i += 6) if (snap.p[i] === nid) return snap.p.slice(i + 1, i + 4); };
  const a = find(before, nico.instance.you), b = find(nico.lastSnap, nico.instance.you);
  ok(b[0] > a[0] + 3, `Nico se mueve a la derecha (${a[0]} → ${b[0]})`);
  ok(nico.snaps > 20, 'Llegan fotos del estado (' + nico.snaps + ')');
  // merienda
  lucia.s.emit('status', 'merendando');
  await sleep(300);
  ok(nico.toasts.some((t) => t.includes('Lucía está merendando, ahora vuelve')), 'Aviso: "Lucía está merendando, ahora vuelve"');
  lucia.s.emit('status', 'jugando');
  // reto de pádel
  const ch = await nico.emit('challenge', { to: pablo.s.id, type: 'padel' });
  ok(ch.ok, 'Nico reta a Pablo a pádel');
  await sleep(200);
  ok(pablo.challenged?.from === 'Nico', 'A Pablo le llega el reto');
  pablo.s.emit('challengeAnswer', { id: pablo.challenged.id, accept: true });
  await sleep(600);
  ok(nico.instance.phase.type === 'padel' && pablo.instance.phase.type === 'padel', 'Los dos están en la pista de pádel');
  ok(lucia.toasts.some((t) => t.includes('pádel')), 'Lucía se entera del reto');
  await sleep(500);
  ok(lucia.roster.some((p) => p.bot), 'Lucía se queda sola en el campo grande y entra el bot');
  // jugamos al pádel a lo loco: los dos le dan a todo
  let k = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && !nico.fx.some((f) => f.t === 'duelEnd')) {
    for (const p of [nico, pablo]) {
      const snap = p.lastSnap; if (!snap) continue;
      const me = find(snap, p.instance.you); const bx = snap.b[0], bz = snap.b[2];
      const dx = bx - me[0], dz = bz - me[2], l = Math.hypot(dx, dz) || 1;
      p.s.emit('i', { x: dx / l, z: dz / l, s: false, k: k++ });
    }
    await sleep(80);
  }
  const points = nico.fx.filter((f) => f.t === 'point');
  ok(points.length > 0, `Se juegan puntos de pádel (${points.length}): ${[...new Set(points.map((p) => p.why))].join(' | ')}`);
  ok(nico.fx.some((f) => f.t === 'hit' || f.t === 'smash'), 'Hay golpes de pala');
  // abandonar si no terminó
  if (!nico.fx.some((f) => f.t === 'duelEnd')) nico.s.emit('leaveDuel');
  await sleep(4500);
  ok(nico.instance.phase.type === 'futbol' && pablo.instance.phase.type === 'futbol', 'Al acabar el reto vuelven al campo grande');
  // reto contra el bot de fútbol
  lucia.s.emit('challengeBot', { type: 'futbol' });
  await sleep(500);
  ok(lucia.instance.phase.type === 'futbol' && lucia.instance.duel, 'Lucía juega un 1vs1 contra el bot');
  // cambio de mundos
  const seen = new Set(nico.phases);
  await sleep(Number(process.env.WAIT || 9000));
  nico.phases.forEach((p) => seen.add(p));
  ok(seen.size >= 3, 'Los mundos van cambiando: ' + [...seen].join(' → '));
  ok(nico.fx.some((f) => f.t === 'phase'), 'Llega el aviso de cambio de fase');
  const kb = (nico.bytes / nico.snaps / 1024).toFixed(2);
  ok(nico.bytes / nico.snaps < 1500, `Cada foto de estado pesa poco: ${kb} KB`);
  const rank = await nico.emit('ranking', null);
  ok(rank.top.length >= 3 && !('token' in rank.top[0]), 'Ranking sin tokens: ' + rank.top.map((p) => `${p.name}(${p.points})`).join(', '));
  // desconexión y vuelta
  pablo.s.disconnect();
  await sleep(300);
  ok(nico.toasts.some((t) => t.includes('Pablo se ha desconectao')), 'Aviso de desconexión');
  const pablo2 = kid('Pablo');
  await sleep(300);
  const h = await pablo2.emit('hello', { name: 'Pablo', token: 't2' });
  ok(h.ok && h.lastRoom?.code === room.code, 'Pablo vuelve y el servidor le ofrece seguir en su sala ' + h.lastRoom?.code);
  const fx = new Set(nico.fx.map((f) => f.t).concat(lucia.fx.map((f) => f.t)));
  log.push('Efectos vistos: ' + [...fx].join(', '));
  console.log(log.join('\n'));
  process.exit();
})();
