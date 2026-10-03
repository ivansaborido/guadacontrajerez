/* ============================================================================
 *  ¡LA LIÁ! — Jerez vs Guadalcacín
 *  Servidor multijugador (Node.js + Express + Socket.io)
 *
 *  Aquí manda er servidó, quillo. Los clientes sólo dicen "pa dónde quieren ir"
 *  y er servidó calcula dónde están de verdad (física autoritativa), así naide
 *  hace trampas aunque tenga el primo informático.
 *
 *  - Salas privadas con código (sin límite de jugadores, que esto es la Feria)
 *  - Cada sala tiene un campo principal de fútbol (Jerez vs Guadalcacín)
 *  - Retos 1vs1 de pádel o fútbol en pistas aparte
 *  - 8 mundos que van cambiando cada 60 segundos, cada uno con su mecánica
 *  - Perfiles e histórico guardados en disco (data/*.json)
 *  - Estados: merendando, comiendo, deberes... y aviso al resto
 *  - Las caras viajan UNA vez y sólo a quien las pide (y NUNCA se guardan en disco)
 * ========================================================================== */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TICK = 30;              // pasos de física por segundo
const SEND_EVERY = 2;         // mandamos foto del estado 15 veces/seg (de sobra, que hay que ahorrá datos)
const DT = 1 / TICK;
const MAX_FACE = 40000;       // 40 KB máximo por cara (la nuestra va en ~7 KB)
const PHASE_SECONDS = Number(process.env.PHASE_SECONDS) || 60; // pa probar rápido: PHASE_SECONDS=5

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '10m' }));
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 80000,                  // nadie manda un mamotreto
  cors: { origin: '*' },
  perMessageDeflate: { threshold: 2048 },     // comprime sólo lo gordo
  pingInterval: 10000, pingTimeout: 9000,
});

/* ----------------------------------------------------------------------------
 *  EL ARCHIVO DE LA ABUELA: perfiles e histórico que sobreviven a un reinicio
 * ------------------------------------------------------------------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const PROFILES_FILE = path.join(DATA_DIR, 'perfiles.json');
const ROOMS_FILE = path.join(DATA_DIR, 'salas.json');
const loadJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const profiles = loadJSON(PROFILES_FILE);
const savedRooms = loadJSON(ROOMS_FILE);
let dirty = false;
const markDirty = () => { dirty = true; };
function writeAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFile(tmp, JSON.stringify(obj), (e) => { if (!e) fs.rename(tmp, file, () => {}); });
}
function flush() {
  for (const r of rooms.values()) savedRooms[r.code] = serializeRoom(r);
  writeAtomic(PROFILES_FILE, profiles);
  writeAtomic(ROOMS_FILE, savedRooms);
}
setInterval(() => { if (dirty) { dirty = false; flush(); } }, 5000);

function getProfile(name) {
  const k = name.toLowerCase();
  if (!profiles[k]) {
    profiles[k] = { name, token: null, points: 0, goals: 0, ownGoals: 0, wins: 0, losses: 0, draws: 0,
      padelW: 0, padelL: 0, duelW: 0, duelL: 0, saco: 0, played: 0, lastRoom: null, lastSeen: 0, created: Date.now() };
  }
  return profiles[k];
}
const publicProfile = (pr) => {
  const { token, ...rest } = pr; return rest;
};

/* ----------------------------------------------------------------------------
 *  LOS MUNDOS: cada uno con su gracia. Cambian solos cada 60 segundos.
 *  move: 'normal' o 'ice' (fricción cero, ¡agárrate los machos!)
 * ------------------------------------------------------------------------- */
const PHASES = [
  { id: 'halloween', name: 'El Fantasma del Alcázar', emoji: '🎃',
    hint: '¡Er Tío del Saco persigue al que lleva la pelota! Pásala rápido o te lleva volando.',
    move: 'normal', speed: 1, ballDamp: 0.9, bounce: 0.5, kickUp: 3, saco: true,
    goalMsg: '¡Gol de miedo, illo! ¡Hasta er fantasma ha aplaudío!' },
  { id: 'navidad', name: 'Nieve en la Plaza del Mamelón', emoji: '🎄',
    hint: 'Suelo de hielo: lo que empiezas a mover NO para. Frena tirando pa’l lao contrario.',
    move: 'ice', speed: 1.05, ballDamp: 0.04, bounce: 0.5, kickUp: 2,
    goalMsg: '¡Eso merece una copita de anís y un polvorón!' },
  { id: 'verano', name: 'Caló de la Campiña y escapada a la playa', emoji: '🏖️',
    hint: 'Con esta caló vas a la mitá y sin esprín. El balón de playa rebota el doble.',
    move: 'normal', speed: 0.5, noSprint: true, ballDamp: 1.1, bounce: 0.92, kickUp: 7, bigBall: true,
    goalMsg: '¡Golazo! Esto se celebra con un helaíto y un chapuzón.' },
  { id: 'levante', name: 'Levante en Cádiz: ¡que se vuela el chiringuito!', emoji: '🌬️',
    hint: 'El viento cambia cada 6 segundos y te arrastra. ¡Cuidao con las sombrillas voladoras!',
    move: 'normal', speed: 1, ballDamp: 0.7, bounce: 0.55, kickUp: 4, wind: true, umbrellas: 3,
    goalMsg: '¡Gol con ayuda del Levante! Eso es que el viento es de los tuyos.' },
  { id: 'feria', name: 'Feria del Caballo: el Real de la Feria', emoji: '🐴',
    hint: '¡DOS balones! Y los coches de caballos cruzan sin frenar. Mira la raya roja antes de que pasen.',
    move: 'normal', speed: 1, ballDamp: 0.9, bounce: 0.5, kickUp: 3, twoBalls: true, carriages: true,
    goalMsg: '¡Ole tu arte! ¡Pescaíto frito pa tó er equipo!' },
  { id: 'circuito', name: 'Gran Premio en el Circuito de Jerez', emoji: '🏍️',
    hint: 'Las motos cruzan a toa leche (raya roja = aviso). Pisa los TURBOS amarillos pa volar.',
    move: 'normal', speed: 1, ballDamp: 0.6, bounce: 0.5, kickUp: 3, motos: true, turbos: true,
    goalMsg: '¡Vaya derrapada! ¡Esto es pole position, quillo!' },
  { id: 'vendimia', name: 'Fiesta de la Vendimia: la Bodega Loca', emoji: '🍇',
    hint: 'Los barriles ruedan solos y los charcos de mosto te dejan pegao. Esquiva o te pisan como a la uva.',
    move: 'normal', speed: 1, ballDamp: 1.0, bounce: 0.45, kickUp: 3, barrels: true, puddles: true,
    goalMsg: '¡Gol con más arte que una pisá de uva!' },
  { id: 'apagon', name: 'Apagón en Guadalcacín', emoji: '🔦',
    hint: 'Se ha ido la luz: el balón sólo se ve a ratos. ¡Y de vez en cuando te mareas y los controles se dan la vuelta!',
    move: 'normal', speed: 1, ballDamp: 0.8, bounce: 0.5, kickUp: 3, dark: true, mareo: true,
    goalMsg: '¡Gol a oscuras! ¿Quién ha sío? ¡Que alguien encienda la luz!' },
];
const PHASE_IDX = Object.fromEntries(PHASES.map((p, i) => [p.id, i]));
const PADEL_PHASES = ['halloween', 'navidad', 'verano', 'levante', 'apagon'].map((id) => PHASE_IDX[id]);
const ALL_PHASES = PHASES.map((_, i) => i);

const STATUS_MSG = {
  jugando: (n) => `🎮 ${n} ha vuelto. ¡A jugar, que se enfría!`,
  merendando: (n) => `🥪 ${n} está merendando, ahora vuelve`,
  comiendo: (n) => `🍽️ ${n} se ha ido a comer, ahora vuelve`,
  deberes: (n) => `📚 ${n} está haciendo los deberes (dice…), ahora vuelve`,
  cenando: (n) => `🍲 ${n} se ha ido a cenar, ahora vuelve`,
  bano: (n) => `🚽 ${n} ha ido al baño, ahora vuelve`,
  recado: (n) => `🛒 A ${n} le han mandao a por el pan, ahora vuelve`,
};
const EMOTES = ['¡Illo!', '¡Ole tu arte!', '¡Pásamela, quillo!', '¡Qué malaje!', '¡Ea!', '¡Mi arma!', '¡Ozú!', '¡Vamo’ a vé!'];
const BOT_NAMES = ['El Primo de Chipiona', 'Er Tito Bot', 'Manolito Robot', 'La Máquina de Lebrija'];
const TEAM_NAMES = ['Jerez', 'Guadalcacín'];

/* ----------------------------------------------------------------------------
 *  ESTADO EN MEMORIA
 * ------------------------------------------------------------------------- */
const players = new Map();    // socket.id -> jugador
const rooms = new Map();      // código -> sala
const instances = new Map();  // id -> pista (campo principal o pista de reto)
const challenges = new Map(); // id -> reto pendiente
let nidSeq = 1, instSeq = 1, chSeq = 1, botSeq = 1, hzSeq = 1;

const now = () => Date.now() / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cleanName = (s) => String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const isActive = (p) => p.isBot || p.status === 'jugando';

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin la O y el 0, pa que no se líen
  let c;
  do { c = Array.from({ length: 4 }, () => pick(A)).join(''); } while (rooms.has(c) || savedRooms[c]);
  return c;
}

/* ----------------------------------------------------------------------------
 *  SALAS
 * ------------------------------------------------------------------------- */
function serializeRoom(r) {
  const inst = instances.get(r.main);
  return { code: r.code, level: r.level, score: r.score, history: r.history.slice(-15),
    phasePos: inst ? inst.pos : r.phasePos, createdAt: r.createdAt, lastUsed: Date.now() };
}
function getOrCreateRoom(code) {
  let r = rooms.get(code);
  if (r) return r;
  const s = savedRooms[code];
  r = { code, level: s?.level || 0, score: s?.score || [0, 0], history: s?.history || [],
    phasePos: s?.phasePos || 0, createdAt: s?.createdAt || Date.now(), members: new Set(), emptySince: 0, main: null };
  const inst = createInstance({ type: 'futbol', room: r, duel: false, list: ALL_PHASES, pos: process.env.START_PHASE ? PHASE_IDX[process.env.START_PHASE] : r.phasePos, dur: PHASE_SECONDS });
  r.main = inst.id;
  rooms.set(code, r);
  markDirty();
  return r;
}

/* ----------------------------------------------------------------------------
 *  PISTAS (instancias): el campo de la sala o una pista de reto
 * ------------------------------------------------------------------------- */
function createInstance({ type, room, duel, list, pos = 0, dur = 60 }) {
  const dims = type === 'padel' ? { L: 10, W: 5 } : duel ? { L: 14, W: 9, GW: 3, GH: 2.4 } : { L: 20, W: 13, GW: 3.6, GH: 2.6 };
  const inst = {
    id: 'i' + instSeq++, type, roomCode: room ? room.code : null, duel, players: new Set(),
    ...dims, list, pos: pos % list.length, dur, phaseEndsAt: now() + dur, phaseStartedAt: now(),
    balls: [], hazards: [], statics: { turbos: [], puddles: [] }, enemy: null,
    wind: { x: 0, z: 0, nextAt: 0 }, mareoUntil: 0, nextMareo: 0, mareoWarned: false,
    freezeUntil: 0, resetAt: 0, nextSpawn: 0, tick: 0, score: [0, 0], target: type === 'padel' ? 7 : 3,
    paused: false, pausedAt: 0, ended: false, padel: null, sides: {}, createdAt: now(),
  };
  instances.set(inst.id, inst);
  setupPhase(inst, true);
  return inst;
}
const phaseOf = (inst) => PHASES[inst.list[inst.pos]];
const levelOf = (inst) => (inst.duel ? 1 : rooms.get(inst.roomCode)?.level || 0);

function newBall(inst, x = 0, z = 0) {
  const ph = phaseOf(inst);
  const r = inst.type === 'padel' ? 0.22 : ph.bigBall ? 0.95 : 0.45;
  return { x, y: r + (inst.type === 'padel' ? 1 : 0), z, vx: 0, vy: 0, vz: 0, r, lastTouch: 0, touchT: 0, prevX: x };
}

function setupPhase(inst, first = false) {
  const ph = phaseOf(inst);
  const t = now();
  inst.phaseStartedAt = t;
  inst.phaseEndsAt = t + inst.dur;
  inst.hazards = [];
  inst.enemy = null;
  inst.statics = { turbos: [], puddles: [] };
  inst.mareoUntil = 0; inst.nextMareo = t + 9; inst.mareoWarned = false;
  inst.wind = { x: 0, z: 0, nextAt: t + 0.5 };
  inst.nextSpawn = t + 2;
  const { L, W } = inst;
  if (inst.type !== 'padel') {
    // Al cambiar de mundo, el balón se queda donde estaba (pero cambia de tamaño)
    const old = inst.balls;
    inst.balls = [newBall(inst, old[0]?.x || 0, old[0]?.z || 0)];
    if (ph.twoBalls) inst.balls.push(newBall(inst, 0, W * 0.4));
  } else if (!inst.balls.length) {
    inst.balls = [newBall(inst, 0, 0)];
  } else {
    inst.balls.forEach((b) => { b.r = 0.22; });
  }
  if (ph.saco) inst.enemy = { x: -L + 2, z: -W + 2, vx: 0, vz: 0, rot: 0, cool: t + 3, target: 0 };
  if (ph.turbos) inst.statics.turbos = [[-L * 0.5, -W * 0.5], [L * 0.5, W * 0.5], [-L * 0.5, W * 0.5], [L * 0.5, -W * 0.5], [0, -W * 0.75], [0, W * 0.75]].map(([x, z]) => [x, z, 1.3]);
  if (ph.puddles) {
    for (let i = 0; i < 6; i++) {
      let x, z, ok, tries = 0;
      do {
        x = rand(-L + 3, L - 3); z = rand(-W + 2.5, W - 2.5);
        ok = Math.hypot(x, z) > 4 && Math.abs(x) < L - 4.5 && inst.statics.puddles.every(([px, pz]) => Math.hypot(px - x, pz - z) > 5);
      } while (!ok && ++tries < 40);
      inst.statics.puddles.push([r2(x), r2(z), 2.3]);
    }
  }
  if (ph.umbrellas) for (let i = 0; i < ph.umbrellas; i++) inst.hazards.push({ id: hzSeq++, k: 'sombrilla', x: rand(-L, L), z: rand(-W, W), vx: 0, vz: 0, r: 1.1, rot: 0, armedAt: 0 });
  if (!first) {
    io.to(inst.id).emit('phase', phasePacket(inst));
    io.to(inst.id).emit('fx', { t: 'phase', id: ph.id });
  }
}
function phasePacket(inst) {
  const ph = phaseOf(inst);
  return { id: ph.id, idx: inst.list[inst.pos], name: ph.name, emoji: ph.emoji, hint: ph.hint,
    endsAt: Math.round(inst.phaseEndsAt * 1000), startedAt: Math.round(inst.phaseStartedAt * 1000), dur: inst.dur,
    level: levelOf(inst), statics: inst.statics, type: inst.type, L: inst.L, W: inst.W, GW: inst.GW, GH: inst.GH,
    duel: inst.duel, ballR: inst.balls[0]?.r || 0.45, nBalls: inst.balls.length };
}

function nextPhase(inst) {
  inst.pos = (inst.pos + 1) % inst.list.length;
  if (!inst.duel && inst.pos === 0) endMatch(inst); // vuelta completa = fin del partido
  setupPhase(inst);
  if (!inst.duel) markDirty();
}

/* Fin de partido en el campo grande (cada vuelta completa a los 8 mundos) */
function endMatch(inst) {
  const room = rooms.get(inst.roomCode);
  if (!room) return;
  const [a, b] = room.score;
  const winner = a > b ? 0 : b > a ? 1 : -1;
  for (const p of inst.players) {
    if (p.isBot || !p.profile) continue;
    p.profile.played++;
    if (winner === -1) { p.profile.draws++; p.profile.points += 5; }
    else if (p.team === winner) { p.profile.wins++; p.profile.points += 25; }
    else p.profile.losses++;
  }
  room.history.push({ at: Date.now(), score: [a, b], winner, level: room.level });
  room.history = room.history.slice(-15);
  const txt = winner === -1 ? `¡Empate ${a}-${b}! Aquí no gana ni Jerez ni Guadalcacín: gana la amistá.`
    : `¡Fin del partido! Gana ${TEAM_NAMES[winner]} ${Math.max(a, b)}-${Math.min(a, b)}. ¡Ozú qué partidazo!`;
  io.to(inst.id).emit('fx', { t: 'match', winner, score: [a, b], text: txt, level: room.level + 1 });
  room.score = [0, 0];
  room.level++;
  io.to(inst.id).emit('score', { score: room.score, level: room.level });
  markDirty();
}

/* ----------------------------------------------------------------------------
 *  ENTRAR Y SALIR DE PISTAS
 * ------------------------------------------------------------------------- */
function spawnPlayer(inst, p) {
  const t = now();
  p.vx = p.vz = p.vy = 0; p.y = 0; p.stunUntil = 0; p.immuneUntil = t + 2;
  if (inst.type === 'padel') {
    p.x = p.side * 7; p.z = rand(-1, 1); p.rot = p.side < 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    const dir = p.team === 0 ? -1 : 1;
    p.x = dir * inst.L * rand(0.35, 0.65); p.z = rand(-inst.W * 0.6, inst.W * 0.6);
    p.rot = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}
function addToInstance(p, inst) {
  if (p.inst) removeFromInstance(p);
  p.inst = inst.id;
  inst.players.add(p);
  if (inst.type !== 'padel' && !inst.duel) {
    let c = [0, 0];
    for (const q of inst.players) if (q !== p && !q.isBot) c[q.team]++;
    p.team = c[0] <= c[1] ? 0 : 1;
  }
  spawnPlayer(inst, p);
  if (p.socket) {
    p.socket.join(inst.id);
    p.socket.emit('instance', { id: inst.id, you: p.nid, phase: phasePacket(inst), score: scoreOf(inst), duel: duelInfo(inst) });
  }
  sendRoster(inst);
}
function removeFromInstance(p) {
  const inst = instances.get(p.inst);
  p.inst = null;
  if (!inst) return;
  inst.players.delete(p);
  if (p.socket) p.socket.leave(inst.id);
  sendRoster(inst);
}
function scoreOf(inst) {
  if (inst.duel) return { score: inst.score, target: inst.target };
  const room = rooms.get(inst.roomCode);
  return { score: room?.score || [0, 0], level: room?.level || 0 };
}
function duelInfo(inst) {
  if (!inst.duel) return null;
  const ps = [...inst.players].sort((a, b) => a.side - b.side);
  return { type: inst.type, names: ps.map((p) => p.name), nids: ps.map((p) => p.nid), target: inst.target };
}
function sendRoster(inst) {
  const list = [...inst.players].map((p) => ({ nid: p.nid, id: p.id, name: p.name, team: p.team, side: p.side || 0,
    status: p.status, bot: !!p.isBot, face: !!p.face, fv: p.faceV || 0 }));
  io.to(inst.id).emit('roster', list);
}

/* ----------------------------------------------------------------------------
 *  BOTS: pa cuando estás solo y no tienes con quién echar un partío
 * ------------------------------------------------------------------------- */
function makeBot(team = 1, side = 0) {
  return { id: 'bot' + botSeq++, nid: nidSeq++, name: pick(BOT_NAMES), isBot: true, status: 'jugando', team, side,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, input: { x: 0, z: 0, s: false }, wantKick: 0, lastKick: 0,
    sprintUntil: 0, sprintCd: 0, stunUntil: 0, immuneUntil: 0, boostUntil: 0, lastHit: 0, botMiss: false, botThink: 0 };
}
function balanceBots(inst) {
  if (inst.duel) return;
  const humans = [...inst.players].filter((p) => !p.isBot);
  const bots = [...inst.players].filter((p) => p.isBot);
  const activeHumans = humans.filter(isActive).length;
  if (humans.length === 0) { bots.forEach((b) => inst.players.delete(b)); if (bots.length) sendRoster(inst); return; }
  if (activeHumans <= 1 && bots.length === 0) {
    const h = humans.find(isActive) || humans[0];
    const bot = makeBot(h.team === 0 ? 1 : 0);
    inst.players.add(bot); bot.inst = inst.id; spawnPlayer(inst, bot); sendRoster(inst);
    io.to(inst.id).emit('toast', { text: `🤖 ${bot.name} se apunta pa que no juegues solo. ¡Invita a tus colegas con el código!` });
  } else if (activeHumans >= 2 && bots.length) {
    bots.forEach((b) => inst.players.delete(b)); sendRoster(inst);
  }
}

/* ----------------------------------------------------------------------------
 *  FÍSICA DE LOS JUGADORES
 * ------------------------------------------------------------------------- */
const BASE_SPEED = 8.5;
function stepPlayer(inst, p, ph, t) {
  if (!isActive(p)) { p.vx = p.vz = 0; return; } // estatua: está merendando
  let ix = p.input.x, iz = p.input.z;
  if (inst.mareoUntil > t) { ix = -ix; iz = -iz; }
  const stunned = t < p.stunUntil;
  if (stunned || t < inst.freezeUntil) { ix = 0; iz = 0; }
  let speed = BASE_SPEED * ph.speed * (p.isBot ? 0.82 : 1);
  if (p.boostUntil > t) speed *= 1.8;
  if (p.input.s && !ph.noSprint && t > p.sprintCd && !stunned) { p.sprintUntil = t + 0.7; p.sprintCd = t + 3; }
  if (p.sprintUntil > t && !ph.noSprint) speed *= 1.65;
  for (const [px, pz, pr] of inst.statics.puddles) if (Math.hypot(p.x - px, p.z - pz) < pr) { speed *= 0.38; break; }
  if (inst.enemy && inst.enemy.target === p.nid) speed *= 0.93; // el que lleva la pelota va más cargao
  const wx = inst.wind.x, wz = inst.wind.z;

  if (ph.move === 'ice') {
    // Fricción cero, señores. Si no tocas nada, sigues patinando hasta la Cartuja.
    p.vx += (ix * 13 + wx * 0.6) * DT; p.vz += (iz * 13 + wz * 0.6) * DT;
    const sp = Math.hypot(p.vx, p.vz), max = speed * 1.25;
    if (sp > max) { p.vx *= max / sp; p.vz *= max / sp; }
  } else {
    const k = Math.min(1, (stunned ? 2.5 : 11) * DT);
    p.vx += (ix * speed + wx * 0.45 - p.vx) * k;
    p.vz += (iz * speed + wz * 0.45 - p.vz) * k;
  }
  if (ix || iz) p.rot = Math.atan2(ix, iz);
  // por el aire (cuando te coge er Tío del Saco)
  if (p.y > 0 || p.vy) { p.vy -= 30 * DT; p.y += p.vy * DT; if (p.y <= 0) { p.y = 0; p.vy = 0; } }
  p.x += p.vx * DT; p.z += p.vz * DT;

  // paredes / medio campo de pádel
  const m = 0.55;
  let minX = -inst.L + m, maxX = inst.L - m;
  if (inst.type === 'padel') { if (p.side < 0) maxX = -0.45; else minX = 0.45; }
  const bounceK = ph.move === 'ice' ? -0.7 : 0;
  if (p.x < minX) { p.x = minX; p.vx *= bounceK; } else if (p.x > maxX) { p.x = maxX; p.vx *= bounceK; }
  if (p.z < -inst.W + m) { p.z = -inst.W + m; p.vz *= bounceK; } else if (p.z > inst.W - m) { p.z = inst.W - m; p.vz *= bounceK; }

  // turbos del Circuito
  for (const [tx, tz, tr] of inst.statics.turbos) {
    if (Math.hypot(p.x - tx, p.z - tz) < tr && p.boostUntil < t) {
      p.boostUntil = t + 2.2;
      if (p.socket) p.socket.emit('fx', { t: 'turbo' });
    }
  }
}
function separatePlayers(inst) {
  const arr = [...inst.players].filter((p) => isActive(p) && p.y < 1);
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], b = arr[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 1.15;
    if (d > 0 && d < min) {
      const push = (min - d) / 2, nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    }
  }
}

/* ----------------------------------------------------------------------------
 *  FÚTBOL: la pelota, los chutes y los goles
 * ------------------------------------------------------------------------- */
const G = 22;
function stepFootball(inst, ph, t) {
  const { L, W, GW, GH } = inst;
  for (const b of inst.balls) {
    const air = b.y > b.r + 0.05;
    b.vy -= G * DT;
    b.vx += inst.wind.x * (air ? 1.5 : 0.8) * DT;
    b.vz += inst.wind.z * (air ? 1.5 : 0.8) * DT;
    b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    if (b.y < b.r) { b.y = b.r; b.vy = b.vy < -1.5 ? -b.vy * ph.bounce : 0; }
    let damp = ph.ballDamp;
    for (const [px, pz, pr] of inst.statics.puddles) if (Math.hypot(b.x - px, b.z - pz) < pr) { damp = 4.5; break; }
    const f = Math.exp(-(b.y <= b.r + 0.05 ? damp : 0.05) * DT);
    b.vx *= f; b.vz *= f;
    // bandas
    if (b.z > W - b.r) { b.z = W - b.r; b.vz = -Math.abs(b.vz) * 0.75; }
    if (b.z < -W + b.r) { b.z = -W + b.r; b.vz = Math.abs(b.vz) * 0.75; }
    // fondos y porterías
    const inMouth = Math.abs(b.z) < GW - b.r * 0.3 && b.y < GH;
    if (Math.abs(b.x) > L - b.r) {
      if (!inMouth && Math.abs(b.x) < L + 0.2) { b.x = Math.sign(b.x) * (L - b.r); b.vx = -b.vx * 0.75; }
      else if (Math.abs(b.x) > L + 0.4 && t > inst.freezeUntil) { goal(inst, b, b.x > 0 ? 0 : 1, t); return; }
      else if (Math.abs(b.x) >= L) { // dentro de la red
        if (Math.abs(b.z) > GW - b.r) { b.z = Math.sign(b.z) * (GW - b.r); b.vz *= -0.3; }
        if (b.y > GH - b.r) { b.y = GH - b.r; b.vy = -Math.abs(b.vy) * 0.3; }
        if (Math.abs(b.x) > L + 1.6) { b.x = Math.sign(b.x) * (L + 1.6); b.vx = 0; }
      }
    }
    // jugadores
    for (const p of inst.players) {
      if (!isActive(p) || p.y > 1.2) continue;
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz) || 0.001;
      const min = 0.62 + b.r;
      if (d < min && b.y < 1.9 + b.r) {
        const nx = dx / d, nz = dz / d;
        b.x = p.x + nx * min; b.z = p.z + nz * min;
        const pv = p.vx * nx + p.vz * nz, bv = b.vx * nx + b.vz * nz;
        if (bv < pv * 1.15) { b.vx += (pv * 1.15 - bv) * nx; b.vz += (pv * 1.15 - bv) * nz; }
        b.lastTouch = p.nid; b.touchT = t;
      }
      // ¡CHUTA!
      if (p.wantKick > t && t > p.lastKick + 0.35 && d < min + 1.0 && b.y < 2.4 && t > p.stunUntil) {
        const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
        let pow = 17 * (p.boostUntil > t ? 1.35 : 1);
        if (ph.bigBall) pow *= 0.85;
        b.vx = fx * pow + p.vx * 0.3; b.vz = fz * pow + p.vz * 0.3; b.vy = ph.kickUp;
        b.lastTouch = p.nid; b.touchT = t; p.lastKick = t; p.wantKick = 0;
        io.to(inst.id).emit('fx', { t: 'kick', nid: p.nid });
      }
    }
  }
  if (inst.resetAt && t > inst.resetAt) {
    inst.resetAt = 0;
    inst.balls.forEach((b, i) => { Object.assign(b, { x: 0, y: b.r + 3, z: i ? inst.W * 0.4 : 0, vx: 0, vy: 0, vz: 0 }); });
    for (const p of inst.players) spawnPlayer(inst, p);
  }
}

function goal(inst, b, scoringTeam, t) {
  const ph = phaseOf(inst);
  const scorer = [...inst.players].find((p) => p.nid === b.lastTouch && t - b.touchT < 8);
  let own = false;
  if (inst.duel) {
    // en el 1vs1 de fútbol el equipo es el lao
    inst.score[scoringTeam]++;
  } else {
    const room = rooms.get(inst.roomCode);
    room.score[scoringTeam]++;
    markDirty();
  }
  if (scorer) {
    own = scorer.team !== scoringTeam;
    if (scorer.profile) {
      if (own) scorer.profile.ownGoals++; else { scorer.profile.goals++; scorer.profile.points += 10; }
      markDirty();
    }
  }
  b.x = Math.sign(b.x) * (inst.L + 0.8); b.vx = b.vz = 0;
  inst.freezeUntil = t + 2.3;
  inst.resetAt = t + 2.2;
  const msg = own ? '¡Gol en propia puerta, carajote! Eso no se celebra, eso se esconde.' : ph.goalMsg;
  io.to(inst.id).emit('fx', { t: 'goal', team: scoringTeam, scorer: scorer?.name || '¿Quién ha sío?', own, msg,
    teamName: inst.duel ? null : TEAM_NAMES[scoringTeam] });
  io.to(inst.id).emit('score', scoreOf(inst));
  if (inst.duel && inst.score[scoringTeam] >= inst.target) {
    const winner = [...inst.players].find((p) => p.team === scoringTeam);
    setTimeout(() => endDuel(inst, winner, 'goles'), 1500);
  }
}

/* ----------------------------------------------------------------------------
 *  PÁDEL: con sus cristales, su red y sus reglas (versión pa chavales)
 *  - Tiene que botar una vez en el campo contrario. Si bota dos, punto pa’l que pegó.
 *  - Si da en la pared del contrario sin botar antes: fuera, punto pa’l otro.
 *  - Si se queda en tu campo (red o corta): punto pa’l rival.
 *  - Se gana a 7 puntos.
 * ------------------------------------------------------------------------- */
function padelInit(inst) {
  const ps = [...inst.players];
  inst.padel = { state: 'serve', serverNid: ps[0].nid, serveAt: now() + 1.5, served: 0, hitter: 0, hitterSide: 0,
    recvBounces: 0, netHit: false, until: 0, rallyStart: 0, lastMove: now(), floor: false };
}
function playerByNid(inst, nid) { for (const p of inst.players) if (p.nid === nid) return p; return null; }

function padelHit(inst, p, ph, t, serve = false) {
  const b = inst.balls[0], pd = inst.padel;
  const side = p.side;
  let aimZ = clamp((p.input.z || (Math.random() * 2 - 1) * 0.6) * inst.W * 0.75, -inst.W + 1, inst.W - 1);
  let speed = ph.speed < 1 ? 10 : 13, vy = 6.3 + Math.max(0, 1 - b.y) * 2.2;
  let smash = false;
  if (!serve && b.y > 2.0 && Math.abs(b.x) < 5) { speed = 19; vy = -1.2; smash = true; }
  if (serve) { speed = 11; vy = 5.6; aimZ = -Math.sign(p.z || 1) * inst.W * 0.45; }
  const tx = -side * (smash ? 5 : 6), dx = tx - b.x, dz = aimZ - b.z, dl = Math.hypot(dx, dz) || 1;
  b.vx = (dx / dl) * speed; b.vz = (dz / dl) * speed; b.vy = vy;
  pd.hitter = p.nid; pd.hitterSide = side; pd.recvBounces = 0; pd.netHit = false; pd.floor = false;
  p.lastHit = t; p.wantKick = 0;
  b.lastTouch = p.nid; b.touchT = t;
  // el bot decide ahora si la próxima la falla (no es perfecto, como er Betis)
  for (const q of inst.players) if (q.isBot && q !== p) q.botMiss = Math.random() < 0.16;
  io.to(inst.id).emit('fx', { t: smash ? 'smash' : 'hit', nid: p.nid });
}

function padelPoint(inst, winnerSide, why, t) {
  const pd = inst.padel;
  if (pd.state !== 'rally') return;
  const idx = winnerSide < 0 ? 0 : 1;
  inst.score[idx]++;
  pd.state = 'pause'; pd.until = t + 1.8;
  const winner = [...inst.players].find((p) => p.side === winnerSide);
  io.to(inst.id).emit('fx', { t: 'point', why, winner: winner?.name || '', nid: winner?.nid });
  io.to(inst.id).emit('score', scoreOf(inst));
  if (inst.score[idx] >= inst.target) setTimeout(() => endDuel(inst, winner, 'pádel'), 1500);
}

function stepPadel(inst, ph, t) {
  const b = inst.balls[0], pd = inst.padel, { L, W } = inst;
  if (!pd) return;
  if (pd.state === 'pause') {
    if (t > pd.until && !inst.ended) {
      pd.served++;
      const ps = [...inst.players];
      // cambia el saque cada dos puntos
      const sIdx = Math.floor(pd.served / 2) % ps.length;
      pd.serverNid = ps[sIdx].nid; pd.state = 'serve'; pd.serveAt = t;
      for (const p of inst.players) spawnPlayer(inst, p);
      const s = playerByNid(inst, pd.serverNid);
      if (s) { s.x = s.side * (L - 1.5); }
    }
    return;
  }
  if (pd.state === 'serve') {
    const s = playerByNid(inst, pd.serverNid);
    if (!s) return;
    if (s.x * s.side < L - 3) s.x = s.side * (L - 1.5); // el que saca, al fondo
    b.x = s.x - s.side * 0.8; b.z = s.z; b.y = 1.1; b.vx = b.vy = b.vz = 0;
    const auto = s.isBot ? 1.2 : 5;
    if ((s.wantKick > t && t > pd.serveAt + 0.4) || t > pd.serveAt + auto) {
      pd.state = 'rally'; pd.rallyStart = t; pd.lastMove = t;
      padelHit(inst, s, ph, t, true);
    }
    return;
  }
  // ---- peloteo ----
  const prevX = b.x;
  b.vy -= 18 * DT;
  b.vx += inst.wind.x * 1.2 * DT; b.vz += inst.wind.z * 1.2 * DT;
  b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
  b.vx *= 0.998; b.vz *= 0.998;
  // la red
  if (prevX * b.x <= 0 && prevX !== b.x) {
    if (b.y < 0.92 + b.r) { b.x = Math.sign(prevX) * (b.r + 0.02); b.vx = -b.vx * 0.2; b.vz *= 0.5; pd.netHit = true; }
  }
  // el suelo
  if (b.y < b.r) {
    b.y = b.r;
    if (b.vy < -0.6) {
      const side = Math.sign(b.x) || 1;
      b.vy = -b.vy * (ph.bounce > 0.8 ? 0.95 : 0.72);
      if (side === -pd.hitterSide) {
        pd.recvBounces++;
        if (pd.recvBounces >= 2) return padelPoint(inst, pd.hitterSide, '¡Doble bote! No llegaste, quillo', t);
      } else if (pd.recvBounces === 0) {
        return padelPoint(inst, -pd.hitterSide, pd.netHit ? '¡A la red! Más feo que un pie, quillo' : '¡Corta! Se quedó en tu campo', t);
      } else {
        return padelPoint(inst, pd.hitterSide, '¡Por tres! La bola volvió pa’l otro lao', t);
      }
    } else b.vy = 0;
  }
  // los cristales
  const wallSideHit = (sideOfBall) => {
    if (sideOfBall === -pd.hitterSide && pd.recvBounces === 0) {
      padelPoint(inst, -pd.hitterSide, '¡Pared directa! Fuera, illo', t); return true;
    }
    return false;
  };
  if (Math.abs(b.x) > L - b.r) {
    b.x = Math.sign(b.x) * (L - b.r); b.vx = -b.vx * 0.7;
    if (wallSideHit(Math.sign(b.x))) return;
  }
  if (Math.abs(b.z) > W - b.r) {
    b.z = Math.sign(b.z) * (W - b.r); b.vz = -b.vz * 0.7;
    if (wallSideHit(Math.sign(b.x))) return;
  }
  // bola muerta (rodando sin gracia)
  if (Math.hypot(b.vx, b.vy, b.vz) > 1) pd.lastMove = t;
  else if (t - pd.lastMove > 1.2) return padelPoint(inst, -(Math.sign(b.x) || 1), 'Bola muerta. ¡Despierta, que te duermes!', t);
  // golpes
  for (const p of inst.players) {
    if (!isActive(p) || t < p.stunUntil) continue;
    const onMySide = Math.sign(b.x) === p.side || Math.abs(b.x) < 0.4;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (p.wantKick > t && onMySide && d < 1.9 && b.y < 3.4 && t > p.lastHit + 0.3 && pd.hitter !== p.nid) {
      padelHit(inst, p, ph, t);
    }
  }
}

/* ----------------------------------------------------------------------------
 *  IA: los bots
 * ------------------------------------------------------------------------- */
function botFootball(inst, p, t) {
  if (t < p.botThink) return;
  p.botThink = t + 0.1;
  let best = null, bd = 1e9;
  for (const b of inst.balls) { const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = b; } }
  if (!best) return;
  const gx = p.team === 0 ? inst.L + 1 : -inst.L - 1;
  let dgx = gx - best.x, dgz = -best.z; const dl = Math.hypot(dgx, dgz) || 1; dgx /= dl; dgz /= dl;
  let tx = best.x - dgx * 1.1, tz = best.z - dgz * 1.1;
  // si está en el lao malo de la pelota, rodea
  const behind = (p.x - best.x) * dgx + (p.z - best.z) * dgz;
  if (behind > 0 && bd < 3) tz += p.z > best.z ? 1.8 : -1.8;
  const mx = tx - p.x, mz = tz - p.z, ml = Math.hypot(mx, mz);
  p.input.x = ml > 0.3 ? mx / ml : 0; p.input.z = ml > 0.3 ? mz / ml : 0;
  p.input.s = bd > 6 && Math.random() < 0.1;
  // el bot apunta regular (si no, no habría quien le ganara)
  if (bd < 1.8 && Math.random() < 0.6) { p.rot = Math.atan2(dgx, dgz) + rand(-0.35, 0.35); p.wantKick = t + 0.2; }
}
function botPadel(inst, p, t) {
  if (t < p.botThink) return;
  p.botThink = t + 0.08;
  const b = inst.balls[0], pd = inst.padel;
  let tx = p.side * 6.5, tz = 0;
  const coming = pd.state === 'rally' && (Math.sign(b.x) === p.side || b.vx * p.side > 0);
  if (coming && !p.botMiss) { tx = clamp(b.x + b.vx * 0.15, -inst.L, inst.L); tz = b.z + b.vz * 0.15; }
  if (coming && p.botMiss) { tx = p.side * 6.5; tz = -b.z * 0.5; } // se despista mirando el móvil
  const mx = tx - p.x, mz = tz - p.z, ml = Math.hypot(mx, mz);
  p.input.x = ml > 0.25 ? mx / ml : 0; p.input.z = ml > 0.25 ? mz / ml : 0;
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  if (coming && !p.botMiss && d < 1.7 && b.y < 2.6) { p.input.z = (Math.random() * 2 - 1); p.wantKick = t + 0.15; }
}

/* ----------------------------------------------------------------------------
 *  LOS PELIGROS DE CADA MUNDO
 * ------------------------------------------------------------------------- */
const HZ = { carro: 1, moto: 2, barril: 3, sombrilla: 4 };
function spawnHazards(inst, ph, t) {
  const { L, W } = inst, lvl = levelOf(inst), mult = 1 + 0.12 * lvl;
  if (t < inst.nextSpawn) return;
  if (ph.carriages) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    inst.hazards.push({ id: hzSeq++, k: 'carro', x: rand(-L + 3, L - 3), z: -dir * (W + 2.5), vx: 0, vz: dir * rand(6.5, 8.5) * Math.min(mult, 1.6), r: 1.5, rot: dir > 0 ? 0 : Math.PI, armedAt: t + 1.0 });
    inst.nextSpawn = t + 3.0 / mult;
  } else if (ph.motos) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    inst.hazards.push({ id: hzSeq++, k: 'moto', x: -dir * (L + 3), z: rand(-W + 1.5, W - 1.5), vx: dir * 21 * Math.min(mult, 1.5), vz: 0, r: 1.0, rot: dir > 0 ? Math.PI / 2 : -Math.PI / 2, armedAt: t + 0.9 });
    inst.nextSpawn = t + 2.1 / mult;
  } else if (ph.barrels) {
    const sx = Math.random() < 0.5 ? 1 : -1, sz = Math.random() < 0.5 ? 1 : -1;
    const sp = rand(5.5, 7.5) * Math.min(mult, 1.5);
    inst.hazards.push({ id: hzSeq++, k: 'barril', x: -sx * (L + 1.5), z: rand(-W + 2, W - 2), vx: sx * sp, vz: sz * sp * 0.6, r: 1.0, rot: 0, armedAt: t + 0.6 });
    inst.nextSpawn = t + 2.4 / mult;
  } else inst.nextSpawn = t + 999;
}
function stepHazards(inst, ph, t) {
  const { L, W } = inst;
  if (ph.wind && t > inst.wind.nextAt) {
    const a = Math.random() * Math.PI * 2, mag = 6 + levelOf(inst) * 0.6;
    inst.wind = { x: Math.cos(a) * mag, z: Math.sin(a) * mag, nextAt: t + 6 };
    io.to(inst.id).emit('fx', { t: 'wind', x: r2(inst.wind.x), z: r2(inst.wind.z) });
  }
  if (ph.mareo) {
    if (!inst.mareoWarned && t > inst.nextMareo - 1.5) { inst.mareoWarned = true; io.to(inst.id).emit('fx', { t: 'mareoAviso' }); }
    if (t > inst.nextMareo) {
      inst.mareoUntil = t + 3.5; inst.nextMareo = t + rand(11, 15) / (1 + 0.1 * levelOf(inst)); inst.mareoWarned = false;
      io.to(inst.id).emit('fx', { t: 'mareo', until: Math.round(inst.mareoUntil * 1000) });
    }
  }
  if (inst.type !== 'padel') spawnHazards(inst, ph, t);
  const keep = [];
  for (const h of inst.hazards) {
    const armed = t >= h.armedAt;
    if (h.k === 'sombrilla') {
      h.vx += (inst.wind.x * 1.3 - h.vx) * 0.05 + rand(-0.4, 0.4); h.vz += (inst.wind.z * 1.3 - h.vz) * 0.05 + rand(-0.4, 0.4);
      h.rot += 6 * DT;
    }
    if (armed) { h.x += h.vx * DT; h.z += h.vz * DT; }
    if (h.k === 'barril') { h.rot = Math.atan2(h.vx, h.vz); if (Math.abs(h.z) > W - h.r) { h.z = Math.sign(h.z) * (W - h.r); h.vz *= -1; } }
    if (h.k === 'sombrilla') { // da la vuelta al campo como el Levante
      if (h.x > L + 2) h.x = -L - 2; else if (h.x < -L - 2) h.x = L + 2;
      if (h.z > W + 2) h.z = -W - 2; else if (h.z < -W - 2) h.z = W + 2;
    }
    const out = h.k !== 'sombrilla' && (Math.abs(h.x) > L + 6 || Math.abs(h.z) > W + 6);
    if (!out) keep.push(h);
    if (!armed) continue;
    for (const p of inst.players) {
      if (!isActive(p) || t < p.immuneUntil || p.y > 1) continue;
      if (Math.hypot(p.x - h.x, p.z - h.z) < h.r + 0.55) knock(inst, p, h, t);
    }
    for (const b of inst.balls) {
      const dx = b.x - h.x, dz = b.z - h.z, d = Math.hypot(dx, dz) || 1;
      if (d < h.r + b.r && b.y < 2) { b.vx = h.vx * 1.2 + (dx / d) * 6; b.vz = h.vz * 1.2 + (dz / d) * 6; b.vy = 4; }
    }
  }
  inst.hazards = keep;
}
const KNOCK_MSG = {
  carro: ['¡Te ha arrollao un coche de caballos! ¡Que no tiene freno, hombre!', '¡Atropellao en el Real! El cochero ni se ha enterao'],
  moto: ['¡Te ha pasao una moto por encima! Mira la raya roja, carajote', '¡Brrrum! Te ha dejao más tieso que la mojama'],
  barril: ['¡Te ha pisao un barril como a una uva!', '¡Barrilazo! Ya eres mosto'],
  sombrilla: ['¡Sombrillazo! El Levante no perdona', '¡Te ha dao una sombrilla voladora en tó la cara!'],
};
function knock(inst, p, h, t) {
  const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
  const sp = Math.hypot(h.vx, h.vz) || 5;
  p.vx = (dx / d) * 9 + h.vx * 0.5; p.vz = (dz / d) * 9 + h.vz * 0.5;
  p.vy = h.k === 'moto' ? 11 : 7; p.y = Math.max(p.y, 0.01);
  p.stunUntil = t + (h.k === 'moto' ? 1.8 : 1.3); p.immuneUntil = t + 3;
  io.to(inst.id).emit('fx', { t: 'knock', nid: p.nid, name: p.name, k: h.k, msg: pick(KNOCK_MSG[h.k]), sp: r2(sp) });
}

/* El Tío del Saco de Guadalcacín. No corre más que tú… al principio. */
function stepSaco(inst, ph, t) {
  const e = inst.enemy;
  if (!e) return;
  const lvl = levelOf(inst);
  let target = null;
  if (t > e.cool) {
    if (inst.type === 'padel') {
      target = playerByNid(inst, inst.padel?.hitter);
    } else {
      for (const b of inst.balls) {
        const p = playerByNid(inst, b.lastTouch);
        if (p && isActive(p) && t - b.touchT < 2.5 && Math.hypot(p.x - b.x, p.z - b.z) < 2.6) { target = p; break; }
      }
      if (!target) {
        let bd = 4;
        for (const p of inst.players) {
          if (!isActive(p)) continue;
          for (const b of inst.balls) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; target = p; } }
        }
      }
    }
    if (target && !isActive(target)) target = null;
  }
  e.target = target ? target.nid : 0;
  let tx, tz, speed;
  if (target) { tx = target.x; tz = target.z; speed = (inst.type === 'padel' ? 6.2 : 7.4) * (1 + 0.07 * lvl); }
  else { const b = inst.balls[0]; tx = b ? b.x : 0; tz = b ? b.z : 0; speed = 3.5; }
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
  e.vx += ((dx / d) * speed - e.vx) * 0.12; e.vz += ((dz / d) * speed - e.vz) * 0.12;
  e.x += e.vx * DT; e.z += e.vz * DT;
  e.x = clamp(e.x, -inst.L - 1, inst.L + 1); e.z = clamp(e.z, -inst.W - 1, inst.W + 1);
  e.rot = Math.atan2(e.vx, e.vz);
  if (target && d < 1.5 && t > target.immuneUntil && target.y === 0) {
    // ¡ZAS! Pa’l saco
    const nx = dx / d, nz = dz / d;
    target.vy = 17; target.y = 0.01; target.vx = nx * 10; target.vz = nz * 10;
    target.stunUntil = t + 2.2; target.immuneUntil = t + 4.5;
    for (const b of inst.balls) if (b.lastTouch === target.nid && Math.hypot(b.x - target.x, b.z - target.z) < 3) { b.vx = -nx * 7; b.vz = -nz * 7; b.vy = 6; b.lastTouch = 0; }
    e.cool = t + 1.8;
    if (target.profile) { target.profile.saco++; markDirty(); }
    io.to(inst.id).emit('fx', { t: 'saco', nid: target.nid, name: target.name });
  }
}

/* ----------------------------------------------------------------------------
 *  EL BUCLE: 30 veces por segundo, sin descanso, como una abuela en la cocina
 * ------------------------------------------------------------------------- */
function stepInstance(inst, t) {
  const humans = [...inst.players].filter((p) => !p.isBot);
  if (!humans.length) {
    if (inst.duel) { instances.delete(inst.id); }
    return;
  }
  // Si en un reto alguien se va a merendar, el partido se para (¡con educación!)
  const shouldPause = inst.duel && humans.some((p) => !isActive(p));
  if (shouldPause && !inst.paused) { inst.paused = true; inst.pausedAt = t; io.to(inst.id).emit('fx', { t: 'pause', on: true }); }
  if (!shouldPause && inst.paused) {
    inst.paused = false; const lost = t - inst.pausedAt;
    inst.phaseEndsAt += lost; inst.phaseStartedAt += lost;
    if (inst.padel) inst.padel.serveAt = t;
    io.to(inst.id).emit('fx', { t: 'pause', on: false });
    io.to(inst.id).emit('phase', phasePacket(inst));
  }
  if (inst.paused) {
    if (t - inst.pausedAt > 600) { // 10 minutos merendando es mucha merienda
      const back = humans.find(isActive);
      endDuel(inst, back || null, 'abandono');
    }
    broadcastState(inst, t);
    return;
  }
  if (t > inst.phaseEndsAt) nextPhase(inst);
  const ph = phaseOf(inst);
  for (const p of inst.players) {
    if (p.isBot) (inst.type === 'padel' ? botPadel : botFootball)(inst, p, t);
    stepPlayer(inst, p, ph, t);
  }
  separatePlayers(inst);
  stepHazards(inst, ph, t);
  stepSaco(inst, ph, t);
  if (inst.type === 'padel') stepPadel(inst, ph, t); else stepFootball(inst, ph, t);
  inst.tick++;
  if (inst.tick % SEND_EVERY === 0) broadcastState(inst, t);
}

/* Paquete compacto: arrays planos y dos decimales, que los datos del móvil cuestan */
function broadcastState(inst, t) {
  const p = [];
  for (const q of inst.players) {
    const flags = (t < q.stunUntil ? 1 : 0) | (q.sprintUntil > t ? 2 : 0) | (q.boostUntil > t ? 4 : 0) | (!isActive(q) ? 8 : 0);
    p.push(q.nid, r2(q.x), r2(q.y), r2(q.z), r2(q.rot), flags);
  }
  const b = [];
  for (const ball of inst.balls) b.push(r2(ball.x), r2(ball.y), r2(ball.z));
  const h = [];
  for (const hz of inst.hazards) h.push(hz.id % 100000, HZ[hz.k], r2(hz.x), r2(hz.z), r2(hz.rot), t >= hz.armedAt ? 1 : 0);
  const e = inst.enemy ? [r2(inst.enemy.x), r2(inst.enemy.z), r2(inst.enemy.rot), inst.enemy.target] : 0;
  const pkt = { t: Math.round(t * 1000), p, b, h, e };
  if (inst.padel) pkt.pd = [inst.padel.state === 'serve' ? 1 : inst.padel.state === 'pause' ? 2 : 0, inst.padel.serverNid, inst.padel.hitter];
  io.to(inst.id).volatile.emit('s', pkt);
}

setInterval(() => {
  const t = now();
  for (const inst of instances.values()) {
    try { stepInstance(inst, t); } catch (err) { console.error('Se ha liao en la pista', inst.id, err); }
  }
}, 1000 / TICK);

/* Limpieza: salas vacías se guardan y se van a dormir la siesta */
setInterval(() => {
  const t = Date.now();
  for (const r of rooms.values()) {
    if (r.members.size === 0 && r.emptySince && t - r.emptySince > 120000) {
      savedRooms[r.code] = serializeRoom(r);
      instances.delete(r.main);
      rooms.delete(r.code);
      markDirty();
    }
  }
  // salas guardadas sin uso en 60 días: a la papelera
  for (const [code, s] of Object.entries(savedRooms)) if (t - (s.lastUsed || 0) > 60 * 86400000) delete savedRooms[code];
}, 30000);

/* ----------------------------------------------------------------------------
 *  RETOS 1vs1 (pádel o fútbol)
 * ------------------------------------------------------------------------- */
function createDuel(a, b, type) {
  const room = rooms.get(a.room);
  const list = type === 'padel' ? PADEL_PHASES : ALL_PHASES;
  const inst = createInstance({ type, room, duel: true, list, pos: Math.floor(Math.random() * list.length), dur: Math.round(PHASE_SECONDS * 0.75) });
  a.side = -1; b.side = 1; a.team = 0; b.team = 1;
  const prevInsts = [a, b].map((p) => instances.get(p.inst)).filter((i) => i && !i.duel);
  for (const p of [a, b]) {
    if (p.isBot) { inst.players.add(p); p.inst = inst.id; spawnPlayer(inst, p); }
  }
  for (const p of [a, b]) if (!p.isBot) addToInstance(p, inst);
  for (const pi of prevInsts) balanceBots(pi);
  if (type === 'padel') padelInit(inst);
  sendRoster(inst);
  io.to(inst.id).emit('phase', phasePacket(inst));
  io.to(inst.id).emit('fx', { t: 'duelStart', type, names: [a.name, b.name] });
  const roomsToTell = new Set([a.room, b.room].filter(Boolean));
  const label = type === 'padel' ? 'pádel 🎾' : 'fútbol 1vs1 ⚽';
  for (const rc of roomsToTell) io.to('room:' + rc).emit('toast', { text: `⚔️ ¡${a.name} y ${b.name} se están echando un ${label}!` });
  broadcastOnline();
  return inst;
}
function endDuel(inst, winner, why) {
  if (inst.ended) return;
  inst.ended = true;
  const ps = [...inst.players];
  const loser = ps.find((p) => p !== winner);
  for (const p of ps) {
    if (!p.profile) continue;
    const won = winner && p === winner;
    if (inst.type === 'padel') won ? p.profile.padelW++ : p.profile.padelL++;
    else won ? p.profile.duelW++ : p.profile.duelL++;
    if (won) p.profile.points += inst.type === 'padel' ? 20 : 15;
  }
  markDirty();
  const label = inst.type === 'padel' ? 'pádel' : 'fútbol 1vs1';
  const txt = winner
    ? `🏆 ${winner.name} le gana a ${loser?.name || 'naide'} al ${label} ${Math.max(...inst.score)}-${Math.min(...inst.score)}${why === 'abandono' ? ' (por abandono)' : ''}`
    : 'Reto cancelao';
  io.to(inst.id).emit('fx', { t: 'duelEnd', text: txt, winner: winner?.name || null });
  const roomsToTell = new Set(ps.map((p) => p.room).filter(Boolean));
  for (const rc of roomsToTell) io.to('room:' + rc).emit('toast', { text: txt });
  setTimeout(() => {
    for (const p of ps) {
      p.side = 0;
      if (p.isBot) continue;
      if (players.has(p.id) && p.inst === inst.id) {
        const room = rooms.get(p.room);
        if (room) { addToInstance(p, instances.get(room.main)); balanceBots(instances.get(room.main)); }
      }
    }
    instances.delete(inst.id);
    broadcastOnline();
  }, 3500);
}

/* ----------------------------------------------------------------------------
 *  LISTA DE CONECTAOS (pa ver quién anda por ahí)
 * ------------------------------------------------------------------------- */
let onlineTimer = null;
function broadcastOnline() {
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    const list = [...players.values()].filter((p) => p.name).map((p) => ({ id: p.id, name: p.name, room: p.room, status: p.status,
      duel: !!instances.get(p.inst)?.duel }));
    io.emit('online', list);
  }, 300);
}

/* ----------------------------------------------------------------------------
 *  SOCKETS: aquí se atiende al personal
 * ------------------------------------------------------------------------- */
io.on('connection', (socket) => {
  const p = { id: socket.id, nid: nidSeq++, socket, name: null, profile: null, face: null, faceV: 0,
    room: null, inst: null, team: 0, side: 0, status: 'jugando', isBot: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, input: { x: 0, z: 0, s: false }, kseq: 0, wantKick: 0, lastKick: 0,
    sprintUntil: 0, sprintCd: 0, stunUntil: 0, immuneUntil: 0, boostUntil: 0, lastHit: 0, lastInputAt: 0, inputCount: 0, inputWindow: 0 };
  players.set(socket.id, p);
  socket.emit('online', [...players.values()].filter((q) => q.name).map((q) => ({ id: q.id, name: q.name, room: q.room, status: q.status, duel: !!instances.get(q.inst)?.duel })));

  socket.on('hello', (data, ack) => {
    if (typeof ack !== 'function') return;
    const name = cleanName(data?.name);
    const token = String(data?.token || '').slice(0, 40);
    if (name.length < 2) return ack({ ok: false, error: 'Ponte un nombre de al menos 2 letras, quillo.' });
    const taken = [...players.values()].find((q) => q !== p && q.name && q.name.toLowerCase() === name.toLowerCase());
    if (taken) return ack({ ok: false, error: `Ya hay un ${name} conectao. Ponte otro nombre (o un apodo, que eso en Jerez sobra).` });
    const pr = getProfile(name);
    if (pr.token && token && pr.token !== token && Date.now() - pr.lastSeen < 7 * 86400000 && !data?.force) {
      return ack({ ok: false, needForce: true, error: `El nombre ${name} ya lo usa alguien desde otro dispositivo. Si eres tú, dale a "Soy yo".` });
    }
    pr.token = token || pr.token; pr.name = name; pr.lastSeen = Date.now();
    p.name = name; p.profile = pr;
    if (typeof data?.face === 'string' && data.face.startsWith('data:image/jpeg;base64,') && data.face.length < MAX_FACE) { p.face = data.face; p.faceV = 1; }
    markDirty();
    ack({ ok: true, nid: p.nid, profile: publicProfile(pr), lastRoom: pr.lastRoom && (rooms.has(pr.lastRoom) || savedRooms[pr.lastRoom]) ? { code: pr.lastRoom, ...(rooms.has(pr.lastRoom) ? serializeRoom(rooms.get(pr.lastRoom)) : savedRooms[pr.lastRoom]) } : null, emotes: EMOTES });
    socket.broadcast.emit('toast', { kind: 'join', id: p.id, text: `🟢 ${name} se ha conectao. ¡Échale un reto!` });
    broadcastOnline();
  });

  socket.on('joinRoom', (data, ack) => {
    if (typeof ack !== 'function' || !p.name) return;
    let code = cleanCode(data?.code);
    if (data?.create) code = newCode();
    if (code.length < 4) return ack({ ok: false, error: 'Ese código está cojo. Son 4 letras/números.' });
    if (!data?.create && !rooms.has(code) && !savedRooms[code]) return ack({ ok: false, error: `La sala ${code} no existe. ¿Seguro que te lo han dicho bien?` });
    leaveRoom(p);
    const room = getOrCreateRoom(code);
    room.members.add(p.id); room.emptySince = 0;
    p.room = code; p.profile.lastRoom = code; markDirty();
    socket.join('room:' + code);
    const inst = instances.get(room.main);
    addToInstance(p, inst);
    balanceBots(inst);
    io.to('room:' + code).except(socket.id).emit('toast', { text: `👋 ${p.name} ha entrao en la sala` });
    ack({ ok: true, code, history: room.history.slice(-10) });
    broadcastOnline();
  });

  socket.on('leaveRoom', () => { leaveRoom(p); broadcastOnline(); });

  // Entrada del mando: sólo la dirección, el esprín y el contador de chutes
  socket.on('i', (d) => {
    if (!d || !p.inst) return;
    const t = now();
    if (t - p.inputWindow > 1) { p.inputWindow = t; p.inputCount = 0; }
    if (++p.inputCount > 40) return; // tranquilito, que no eres una ametralladora
    let x = Number(d.x) || 0, z = Number(d.z) || 0;
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    p.input.x = x; p.input.z = z; p.input.s = !!d.s;
    const k = Number(d.k) | 0;
    if (k !== p.kseq) { p.kseq = k; p.wantKick = t + 0.25; }
    if (p.status !== 'jugando' && (x || z)) setStatus(p, 'jugando');
  });

  socket.on('status', (s) => { if (STATUS_MSG[s]) setStatus(p, s); });

  socket.on('emote', (i) => {
    i = Number(i) | 0;
    if (!p.inst || !EMOTES[i]) return;
    const t = now(); if (t - (p.lastEmote || 0) < 1.2) return; p.lastEmote = t;
    io.to(p.inst).emit('emote', { nid: p.nid, text: EMOTES[i] });
  });

  // Caras: el cliente pide sólo las que no tiene
  socket.on('needFaces', (ids) => {
    if (!Array.isArray(ids)) return;
    const out = {};
    for (const id of ids.slice(0, 30)) { const q = players.get(String(id)); if (q && q.face) out[q.id] = { f: q.face, v: q.faceV }; }
    socket.emit('faces', out);
  });
  socket.on('updateFace', (face) => {
    if (typeof face !== 'string' || !face.startsWith('data:image/jpeg;base64,') || face.length >= MAX_FACE) return;
    p.face = face; p.faceV = (p.faceV || 0) + 1;
    if (p.inst) sendRoster(instances.get(p.inst));
  });

  socket.on('challenge', (d, ack) => {
    if (typeof ack !== 'function') return;
    const type = d?.type === 'padel' ? 'padel' : 'futbol';
    const target = players.get(String(d?.to));
    if (!p.room) return ack({ ok: false, error: 'Entra primero en una sala.' });
    if (!target || !target.name || target === p) return ack({ ok: false, error: 'Ese jugador ya no está.' });
    if (!target.room) return ack({ ok: false, error: `${target.name} todavía no ha entrao en ninguna sala.` });
    if (instances.get(p.inst)?.duel || instances.get(target.inst)?.duel) return ack({ ok: false, error: 'Uno de los dos ya está en un reto.' });
    if (target.status !== 'jugando') return ack({ ok: false, error: `${target.name} está ${target.status}. Espérate un poquito.` });
    const id = 'c' + chSeq++;
    challenges.set(id, { id, from: p.id, to: target.id, type, at: Date.now() });
    setTimeout(() => {
      const c = challenges.get(id);
      if (c) { challenges.delete(id); p.socket.emit('toast', { text: `⌛ ${target.name} no ha contestao al reto. ¡Estará merendando!` }); }
    }, 20000);
    target.socket.emit('challenged', { id, from: p.name, type });
    ack({ ok: true });
  });

  socket.on('challengeAnswer', (d) => {
    const c = challenges.get(String(d?.id));
    if (!c || c.to !== p.id) return;
    challenges.delete(c.id);
    const from = players.get(c.from);
    if (!from || !from.room || !p.room) return;
    if (!d.accept) { from.socket.emit('toast', { text: `🙅 ${p.name} dice que ahora no le apetece. ¡Cagueta! (es broma)` }); return; }
    if (instances.get(from.inst)?.duel || instances.get(p.inst)?.duel) return;
    createDuel(from, p, c.type);
  });

  socket.on('challengeBot', (d) => {
    if (!p.room || instances.get(p.inst)?.duel) return;
    const type = d?.type === 'padel' ? 'padel' : 'futbol';
    const bot = makeBot(1, 1);
    createDuel(p, bot, type);
  });

  socket.on('leaveDuel', () => {
    const inst = instances.get(p.inst);
    if (!inst?.duel) return;
    const other = [...inst.players].find((q) => q !== p);
    endDuel(inst, other || null, 'abandono');
  });

  socket.on('ranking', (_, ack) => {
    if (typeof ack !== 'function') return;
    const top = Object.values(profiles).sort((a, b) => b.points - a.points).slice(0, 25).map(publicProfile);
    const room = p.room ? rooms.get(p.room) : null;
    ack({ top, me: p.profile ? publicProfile(p.profile) : null, history: room ? room.history.slice(-10) : [] });
  });

  socket.on('disconnect', () => {
    const inst = instances.get(p.inst);
    if (inst?.duel && !inst.ended) {
      const other = [...inst.players].find((q) => q !== p);
      endDuel(inst, other || null, 'abandono');
    }
    if (p.profile) { p.profile.lastSeen = Date.now(); markDirty(); }
    leaveRoom(p);
    players.delete(socket.id);
    if (p.name) io.emit('toast', { kind: 'leave', text: `🔴 ${p.name} se ha desconectao. Su partida queda guardá pa la próxima.` });
    broadcastOnline();
  });
});

function setStatus(p, s) {
  if (p.status === s) return;
  p.status = s;
  if (p.name) io.emit('toast', { kind: 'status', id: p.id, status: s, text: STATUS_MSG[s](p.name) });
  const inst = instances.get(p.inst);
  if (inst) { sendRoster(inst); balanceBots(inst); }
  broadcastOnline();
}
function leaveRoom(p) {
  const cur = instances.get(p.inst);
  if (cur?.duel && !cur.ended) {
    const other = [...cur.players].find((q) => q !== p);
    endDuel(cur, other || null, 'abandono');
  }
  if (p.inst) {
    const inst = instances.get(p.inst);
    removeFromInstance(p);
    if (inst && !inst.duel) balanceBots(inst);
  }
  if (p.room) {
    const room = rooms.get(p.room);
    p.socket?.leave('room:' + p.room);
    if (room) { room.members.delete(p.id); if (room.members.size === 0) room.emptySince = Date.now(); }
    p.room = null;
  }
}

app.get('/salud', (req, res) => res.json({ ok: true, conectaos: players.size, salas: rooms.size, pistas: instances.size }));

process.on('SIGINT', () => { flush(); setTimeout(() => process.exit(0), 300); });
process.on('SIGTERM', () => { flush(); setTimeout(() => process.exit(0), 300); });

server.listen(PORT, () => {
  console.log(`\n  ¡LA LIÁ! funcionando en http://localhost:${PORT}`);
  console.log('  Jerez vs Guadalcacín. Que gane el que más arte tenga.\n');
});
