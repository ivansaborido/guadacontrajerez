/* ============================================================================
 *  ¡LA LIÁ! — MODO PLATAFORMAS
 *  Carrera a la meta de lado, a lo clásico: saltos, muelles, pinchos de
 *  chumbera, cajas sorpresa… y aquí se roba, quillo:
 *    - CHIQUIS: los chiquillos que vas rescatando. Si te dan, se te caen todos
 *      y los recoge el primero que pase. Si le pisas la cabeza a alguien, le
 *      quitas 3.
 *    - PODERES: guindilla, escudo, petardo e imán. Pisándole la cabeza a otro
 *      le robas el suyo.
 *    - MUÑECOS (disfraces): Rayo, Saltaora, Fantasma y Torero, cada uno con su
 *      habilidad. Si le das un acelerón (DASH) a otro, le robas el muñeco.
 * ========================================================================== */
'use strict';

const T = { AIR: 0, GROUND: 1, PLAT: 2, SPIKE: 3, SPRING: 4, TURBO: 5, BOXP: 6, BOXD: 7, MOSTO: 8 };
const SOLID = [false, true, true, false, true, true, true, true, true];
const COSTUMES = ['normal', 'rayo', 'saltaora', 'fantasma', 'torero'];
const COSTUME_NAMES = { normal: 'Tú mismo', rayo: 'El Rayo de la Campiña', saltaora: 'La Saltaora', fantasma: 'El Fantasma del Alcázar', torero: 'El Torero' };
const COSTUME_HINT = { rayo: 'corres muchísimo más', saltaora: 'doble salto', fantasma: 'mantén SALTO pa planear', torero: 'tus acelerones derriban a cualquiera' };
const POWERS = ['', 'guindilla', 'escudo', 'petardo', 'iman'];
const POWER_NAMES = { guindilla: '🌶️ Guindilla (turbo)', escudo: '🛡️ Escudo', petardo: '🧨 Petardo', iman: '🧲 Imán de chiquis' };
const THEMES = ['halloween', 'navidad', 'verano', 'levante', 'feria', 'circuito', 'vendimia', 'apagon'];
const THEME_HINT = {
  halloween: '¡Er Tío del Saco persigue al que va primero! Ir en cabeza tiene su riesgo.',
  navidad: 'Suelo helao: cuesta arrancar y cuesta todavía más frenar.',
  verano: 'Con la caló vas más lento, pero los muelles te mandan a la luna.',
  levante: 'El Levante te empuja pa’lante o pa’trás según le dé.',
  feria: 'Cacharritos por todos laos (muelles) y el doble de chiquis.',
  circuito: 'Pisa los turbos amarillos y sal disparao.',
  vendimia: 'Barriles rodando hacia ti y charcos de mosto que te dejan pegao.',
  apagon: 'Se ha ido la luz: sólo ves lo que tienes cerca. ¡Y hay más bichos!',
};
const H = 18;
const G = 45, JUMP = 18, RUN = 9.5, MAXFALL = 26, DASH = 20;
const HW = 0.38, PH = 1.7; // medio ancho y alto del muñeco

module.exports = function makePlataformas({ io, PHASES, PHASE_IDX, markDirty }) {
  let eid = 1;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const r2 = (v) => Math.round(v * 100) / 100;
  const isActive = (p) => p.status === 'jugando';

  /* ---------------------------- EL NIVEL ---------------------------------- */
  function generateLevel(theme, diff) {
    const LEN = Math.min(340, 230 + diff * 15);
    const g = new Uint8Array(LEN * H);
    const set = (x, y, v) => { if (x >= 0 && x < LEN && y >= 0 && y < H) g[y * LEN + x] = v; };
    const col = (x, h, top = T.GROUND) => { for (let y = 0; y < h; y++) set(x, y, y === h - 1 ? top : T.GROUND); };
    const chiquis = [], enemies = [], checkpoints = [], spawners = [];
    const extraChiquis = theme === 'feria' ? 2 : 1;
    const addChiqui = (x, y) => { chiquis.push([r2(x), r2(y)]); };
    let x = 0, h = 3;
    for (; x < 12; x++) col(x, h);
    let nextCk = 55;
    const bag = ['flat', 'step', 'step', 'gap', 'gap', 'plats', 'spikes', 'spikes', 'spring', 'boxes', 'boxes', 'enemies'];
    if (theme === 'circuito') bag.push('turbo', 'turbo', 'turbo');
    if (theme === 'vendimia') bag.push('mosto', 'mosto', 'barrel', 'barrel');
    if (theme === 'feria') bag.push('spring', 'spring', 'boxes');
    if (theme === 'apagon') bag.push('enemies', 'enemies');
    bag.push('wall', 'spikegap');
    if (diff >= 1) bag.push('gap', 'spikes', 'plats', 'spikegap');
    if (diff >= 3) bag.push('spikegap', 'wall', 'enemies');
    let last = '';
    while (x < LEN - 24) {
      if (x >= nextCk) {
        for (let i = 0; i < 5; i++) col(x + i, h);
        checkpoints.push(x + 2); x += 5; nextCk += 55;
        continue;
      }
      let s = pick(bag);
      if (s === last && s !== 'flat') s = 'flat';
      last = s;
      if (s === 'flat') {
        const len = ri(5, 9);
        for (let i = 0; i < len; i++) { col(x + i, h); if (i % 2 === 0 && Math.random() < 0.6 * extraChiquis) addChiqui(x + i + 0.5, h + 1.3); }
        x += len;
      } else if (s === 'step') {
        h = Math.max(2, Math.min(8, h + pick([-2, -1, 1, 2])));
        const len = ri(4, 7);
        for (let i = 0; i < len; i++) col(x + i, h);
        x += len;
      } else if (s === 'gap') {
        const gl = ri(3, 4 + Math.min(2, diff));
        for (let i = 0; i < gl; i++) addChiqui(x + i + 0.5, h + 1.6 + Math.sin(Math.PI * (i + 0.5) / gl) * 2.2);
        x += gl;
        for (let i = 0; i < 3; i++) col(x + i, h);
        x += 3;
      } else if (s === 'plats') {
        const gl = ri(8, 11);
        const ps = [[1, h + 1], [Math.floor(gl / 2) - 1, h + 3], [gl - 4, h + 1]];
        for (const [px, py] of ps) for (let i = 0; i < 3; i++) { set(x + px + i, py, T.PLAT); if (i === 1) addChiqui(x + px + i + 0.5, py + 1.4); }
        x += gl;
        for (let i = 0; i < 3; i++) col(x + i, h);
        x += 3;
      } else if (s === 'spikes') {
        const len = 10, n = ri(2, 3 + Math.min(1, diff));
        for (let i = 0; i < len; i++) col(x + i, h);
        for (let i = 0; i < n; i++) set(x + 3 + i, h, T.SPIKE);
        addChiqui(x + 3 + n / 2, h + 3.4);
        x += len;
      } else if (s === 'spring') {
        const len = 12;
        for (let i = 0; i < len; i++) col(x + i, h);
        set(x + 2, h, T.SPRING);
        const py = Math.min(H - 3, h + 7);
        for (let i = 4; i < 12; i++) { set(x + i, py, T.PLAT); if (i % 2) addChiqui(x + i + 0.5, py + 1.4); }
        set(x + 8, py + 4, Math.random() < 0.5 ? T.BOXD : T.BOXP);
        x += len;
      } else if (s === 'boxes') {
        const len = 8;
        for (let i = 0; i < len; i++) col(x + i, h);
        set(x + 3, h + 3, Math.random() < 0.55 ? T.BOXP : T.BOXD);
        if (Math.random() < 0.5) set(x + 5, h + 3, Math.random() < 0.55 ? T.BOXP : T.BOXD);
        x += len;
      } else if (s === 'enemies') {
        const len = 11;
        for (let i = 0; i < len; i++) col(x + i, h);
        enemies.push([x + 5, h]);
        if (diff >= 1 || theme === 'apagon') enemies.push([x + 8, h]);
        x += len;
      } else if (s === 'wall') {
        // muro: hay que subir de un salto y bajar con cuidao, que al otro lao hay chumberas
        const wh = Math.min(H - 6, h + 3);
        for (let i = 0; i < 3; i++) col(x + i, h);
        for (let i = 3; i < 7; i++) { col(x + i, wh); if (i === 5) addChiqui(x + i + 0.5, wh + 1.4); }
        for (let i = 7; i < 12; i++) col(x + i, h);
        set(x + 8, h, T.SPIKE);
        x += 12;
      } else if (s === 'spikegap') {
        // hoyo con chumberas en los dos bordes: o saltas largo o pinchas
        for (let i = 0; i < 4; i++) col(x + i, h);
        set(x + 3, h, T.SPIKE);
        x += 4;
        const gl = ri(3, 4);
        x += gl;
        for (let i = 0; i < 5; i++) col(x + i, h);
        set(x, h, T.SPIKE);
        addChiqui(x - gl / 2, h + 4);
        x += 5;
      } else if (s === 'turbo') {
        const len = 10;
        for (let i = 0; i < len; i++) col(x + i, h, i >= 2 && i <= 4 ? T.TURBO : T.GROUND);
        x += len;
      } else if (s === 'mosto') {
        const len = 10;
        for (let i = 0; i < len; i++) col(x + i, h, i >= 2 && i <= 7 ? T.MOSTO : T.GROUND);
        x += len;
      } else if (s === 'barrel') {
        const len = 12;
        for (let i = 0; i < len; i++) col(x + i, h);
        spawners.push([x + 11, h + 0.5]);
        x += len;
      }
    }
    for (; x < LEN; x++) col(x, h);
    return { LEN, H, g, chiquis, enemies, checkpoints, spawners, finishX: LEN - 10, theme, diff };
  }
  const tileAt = (lv, x, y) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= lv.LEN) return T.GROUND; // paredes invisibles a los laos
    if (y < 0 || y >= H) return T.AIR;
    return lv.g[y * lv.LEN + x];
  };
  const solidAt = (lv, x, y) => SOLID[tileAt(lv, x, y)];

  /* ---------------------------- LA CARRERA -------------------------------- */
  function create(inst, room) {
    inst.platLevel = room?.platLevel || 0;
    inst.themeIdx = process.env.PLAT_THEME ? THEMES.indexOf(process.env.PLAT_THEME) : Math.floor(Math.random() * THEMES.length);
    newRace(inst, true);
  }
  function newRace(inst, first = false) {
    const theme = THEMES[inst.themeIdx % THEMES.length];
    const lv = generateLevel(theme, inst.platLevel);
    inst.lv = lv;
    inst.chiquiTaken = new Array(lv.chiquis.length).fill(0); // 0 = está; >0 = vuelve en ese instante
    inst.boxUsed = new Map();
    inst.enemies = lv.enemies.map(([x, y]) => ({ id: eid++, type: 1, x: x + 0.5, y, vx: -2, vy: 0, alive: true, back: 0 }));
    inst.barrels = []; inst.petardos = []; inst.loose = [];
    inst.saco = null; inst.wind = 0; inst.windAt = 0; inst.spawnAt = 0;
    const t = Date.now() / 1000;
    inst.race = { state: 'ready', until: t + 4, startAt: t + 4, firstFinishAt: 0, finishers: 0, ranking: null };
    let i = 0;
    for (const p of inst.players) spawn(inst, p, i++);
    if (!first) {
      io.to(inst.id).emit('phase', packet(inst));
      io.to(inst.id).emit('fx', { t: 'phase', id: theme });
    }
  }
  function spawn(inst, p, i = 0) {
    const lv = inst.lv;
    const x = 2 + (i % 5) * 1.1;
    let y = H - 1; while (y > 0 && !solidAt(lv, x, y - 1)) y--;
    p.pl = { x, y, vx: 0, vy: 0, ground: false, gTile: 0, facing: 1, costume: 'normal', power: '', chiquis: 0, got: 0,
      jumps: 0, coyote: 0, dashUntil: 0, dashCd: 0, airDash: true, invuln: 0, stun: 0, shieldUntil: 0, turboUntil: 0, imanUntil: 0,
      ck: x, finished: false, place: 0, prevS: false, glide: false, springAt: 0 };
    p.x = x; p.y = y; p.z = 0;
  }
  function packet(inst) {
    const lv = inst.lv, ph = PHASES[PHASE_IDX[lv.theme]];
    let tiles = '';
    for (let i = 0; i < lv.g.length; i++) tiles += lv.g[i];
    const t = Date.now() / 1000;
    return { type: 'plat', id: lv.theme, name: `${ph.name} · Carrera`, emoji: ph.emoji, hint: THEME_HINT[lv.theme],
      LEN: lv.LEN, H, tiles, chiquis: lv.chiquis, taken: inst.chiquiTaken.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
      boxes: [...inst.boxUsed.keys()], ck: lv.checkpoints, finishX: lv.finishX, level: inst.platLevel, duel: false,
      race: raceInfo(inst), endsAt: Math.round((inst.race.startAt + 150) * 1000), startedAt: Math.round(inst.race.startAt * 1000), dur: 150 };
  }
  const raceInfo = (inst) => ({ state: inst.race.state, until: Math.round(inst.race.until * 1000), startAt: Math.round(inst.race.startAt * 1000),
    close: inst.race.firstFinishAt ? Math.round((inst.race.firstFinishAt + 20) * 1000) : 0 });

  function emitRace(inst) { io.to(inst.id).emit('race', raceInfo(inst)); }

  /* ---------------------------- FÍSICA ------------------------------------ */
  function moveBody(lv, b, dt, hw, hh) {
    // eje X
    b.x += b.vx * dt;
    const yb = b.y + 0.05, yt = b.y + hh - 0.05;
    if (b.vx > 0) { const cx = b.x + hw; for (let yy = Math.floor(yb); yy <= Math.floor(yt); yy++) if (solidAt(lv, cx, yy)) { b.x = Math.floor(cx) - hw - 0.001; b.vx = 0; b.hitWall = 1; break; } }
    else if (b.vx < 0) { const cx = b.x - hw; for (let yy = Math.floor(yb); yy <= Math.floor(yt); yy++) if (solidAt(lv, cx, yy)) { b.x = Math.floor(cx) + 1 + hw + 0.001; b.vx = 0; b.hitWall = -1; break; } }
    // eje Y
    b.y += b.vy * dt;
    b.ground = false; b.bump = null;
    const xl = b.x - hw + 0.02, xr = b.x + hw - 0.02;
    if (b.vy <= 0) {
      for (let xx = Math.floor(xl); xx <= Math.floor(xr); xx++) {
        if (solidAt(lv, xx, b.y)) { b.y = Math.floor(b.y) + 1; b.vy = 0; b.ground = true; b.gTile = tileAt(lv, xx, b.y - 1); if (b.gTile === T.SPRING) b.onSpring = true; break; }
      }
    } else {
      const top = b.y + hh;
      for (let xx = Math.floor(xl); xx <= Math.floor(xr); xx++) {
        if (solidAt(lv, xx, top)) { b.y = Math.floor(top) - hh - 0.001; b.vy = 0; b.bump = [xx, Math.floor(top)]; break; }
      }
    }
  }

  function hurt(inst, p, t, why, msg) {
    const pl = p.pl;
    if (t < pl.invuln || pl.finished) return;
    if (t < pl.shieldUntil) { pl.shieldUntil = 0; pl.invuln = t + 1; io.to(inst.id).emit('fx', { t: 'pshield', nid: p.nid }); return; }
    const lost = pl.chiquis;
    scatter(inst, pl, Math.min(lost, 10), t);
    pl.chiquis = 0;
    pl.vx = -pl.facing * 8; pl.vy = 11; pl.stun = t + 0.6; pl.invuln = t + 2;
    if (lost === 0) { // sin chiquis que soltar: pa’trás al último banderín
      pl.x = pl.ck; pl.y = H - 1; while (pl.y > 0 && !solidAt(inst.lv, pl.x, pl.y - 1)) pl.y--; pl.vx = 0; pl.vy = 0; pl.stun = t + 1;
    }
    io.to(inst.id).emit('fx', { t: 'phurt', nid: p.nid, name: p.name, why, msg, lost, respawn: lost === 0 });
  }
  function scatter(inst, pl, n, t) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / Math.max(1, n - 1)));
      inst.loose.push({ id: eid++, x: pl.x, y: pl.y + 1, vx: Math.cos(a) * rand(4, 8), vy: Math.sin(a) * rand(8, 13), born: t, until: t + 7 });
    }
  }
  function giveChiqui(p, n = 1) { p.pl.chiquis += n; p.pl.got += n; }

  function stepPlayer(inst, p, t, dt) {
    const pl = p.pl, lv = inst.lv, th = lv.theme;
    if (!pl) return;
    if (!isActive(p) || inst.race.state === 'ready' || pl.finished) {
      pl.vx *= 0.8; if (!isActive(p) || inst.race.state === 'ready') { p.wantKick = 0; }
      if (inst.race.state !== 'ready' && isActive(p)) { pl.vy = Math.max(-MAXFALL, pl.vy - G * dt); moveBody(lv, pl, dt, HW, PH); }
      return;
    }
    const inp = p.input;
    let ix = t < pl.stun ? 0 : Math.sign(inp.x) * Math.min(1, Math.abs(inp.x) * 1.4);
    if (Math.abs(inp.x) < 0.2) ix = 0;
    let max = RUN;
    if (pl.costume === 'rayo') max = 13;
    if (th === 'verano') max *= 0.72;
    if (pl.turboUntil > t) max = 17;
    if (pl.ground && pl.gTile === T.MOSTO) max *= 0.4;
    let acc = pl.ground ? 32 : 18, fric = pl.ground ? 28 : 4;
    if (pl.costume === 'rayo') acc *= 1.3;
    if (th === 'navidad' && pl.ground) { acc = 8; fric = 1.5; }
    const dashing = pl.dashUntil > t;
    if (!dashing) {
      if (ix) {
        pl.facing = ix > 0 ? 1 : -1;
        if (Math.abs(pl.vx) < max || Math.sign(pl.vx) !== ix) pl.vx += ix * acc * dt;
        if (Math.abs(pl.vx) > max) pl.vx -= Math.sign(pl.vx) * Math.min(Math.abs(pl.vx) - max, (pl.ground ? 30 : 6) * dt);
        if (Math.sign(pl.vx) !== ix && pl.ground) pl.vx += ix * fric * dt; // derrapada pa cambiar de sentío
      } else {
        const d = fric * dt;
        pl.vx = Math.abs(pl.vx) <= d ? 0 : pl.vx - Math.sign(pl.vx) * d;
      }
    }
    if (th === 'levante') pl.vx += inst.wind * dt;
    // DASH (acelerón): también sirve pa robar muñecos
    if (inp.s && !pl.prevS && t > pl.dashCd && t > pl.stun && (pl.ground || pl.airDash)) {
      pl.dashUntil = t + 0.28; pl.dashCd = t + (pl.costume === 'torero' ? 1 : 1.8);
      if (!pl.ground) pl.airDash = false;
      pl.vx = pl.facing * DASH; pl.vy = Math.max(pl.vy, 0);
      io.to(inst.id).emit('fx', { t: 'pdash', nid: p.nid });
    }
    pl.prevS = !!inp.s;
    if (dashing) { pl.vx = pl.facing * DASH; pl.vy = Math.max(pl.vy, -2); }
    // SALTO
    if (pl.ground) { pl.coyote = t + 0.1; pl.jumps = pl.costume === 'saltaora' ? 1 : 0; pl.airDash = true; }
    if (p.wantKick > t && t > pl.stun) {
      if (pl.ground || t < pl.coyote) { pl.vy = JUMP; p.wantKick = 0; pl.coyote = 0; pl.ground = false; }
      else if (pl.jumps > 0) { pl.jumps--; pl.vy = JUMP * 0.9; p.wantKick = 0; io.to(inst.id).emit('fx', { t: 'pdouble', nid: p.nid }); }
    }
    if (!inp.j && pl.vy > 7 && !pl.spring) pl.vy = 7; // salto corto si sueltas el botón
    pl.vy -= G * dt;
    pl.glide = pl.costume === 'fantasma' && inp.j && pl.vy < -2.5;
    if (pl.glide) pl.vy = -2.5;
    if (pl.vy < -MAXFALL) pl.vy = -MAXFALL;
    if (pl.vy <= 0) pl.spring = false;
    pl.onSpring = false;
    moveBody(lv, pl, dt, HW, PH);
    // muelles
    if (pl.ground && pl.onSpring) {
      pl.vy = th === 'verano' ? 34 : th === 'feria' ? 30 : 27; pl.ground = false; pl.spring = true;
      io.to(inst.id).emit('fx', { t: 'pspring', nid: p.nid });
    }
    // turbos del suelo
    if (pl.ground && pl.gTile === T.TURBO && pl.turboUntil < t + 1.5) {
      pl.turboUntil = t + 2; pl.vx = pl.facing * 16;
      if (p.socket) p.socket.emit('fx', { t: 'turbo' });
    }
    // cajas sorpresa (golpe por abajo)
    if (pl.bump) {
      const [bx, by] = pl.bump, k = by * lv.LEN + bx, tile = lv.g[k];
      if ((tile === T.BOXP || tile === T.BOXD) && !inst.boxUsed.has(k)) {
        inst.boxUsed.set(k, t + 12);
        io.to(inst.id).emit('pt', { k: 'b', i: k, on: 0 });
        if (tile === T.BOXP) {
          pl.power = pick(POWERS.slice(1));
          io.to(inst.id).emit('fx', { t: 'pitem', nid: p.nid, name: p.name, kind: 'poder', what: POWER_NAMES[pl.power] });
        } else {
          pl.costume = pick(COSTUMES.slice(1).filter((c) => c !== pl.costume));
          io.to(inst.id).emit('fx', { t: 'pitem', nid: p.nid, name: p.name, kind: 'muñeco', what: COSTUME_NAMES[pl.costume], hint: COSTUME_HINT[pl.costume] });
        }
      }
    }
    // pinchos de chumbera
    for (let yy = Math.floor(pl.y); yy <= Math.floor(pl.y + PH - 0.1); yy++)
      for (let xx = Math.floor(pl.x - HW); xx <= Math.floor(pl.x + HW); xx++)
        if (tileAt(lv, xx, yy) === T.SPIKE) { hurt(inst, p, t, 'chumbera', '¡Te has clavao una chumbera! Eso pica más que el gazpacho'); pl.vy = 13; }
    // al hoyo
    if (pl.y < -4) {
      pl.chiquis = Math.floor(pl.chiquis / 2);
      pl.x = pl.ck; pl.y = H - 1; while (pl.y > 0 && !solidAt(lv, pl.x, pl.y - 1)) pl.y--; pl.vx = 0; pl.vy = 0; pl.invuln = t + 1.5;
      io.to(inst.id).emit('fx', { t: 'phurt', nid: p.nid, name: p.name, why: 'hoyo', msg: '¡Al hoyo! Has perdío la mitá de los chiquis', respawn: true });
    }
    // banderines
    for (const cx of lv.checkpoints) if (pl.x > cx && pl.ck < cx) { pl.ck = cx; if (p.socket) p.socket.emit('fx', { t: 'pcheck' }); }
    // chiquis del nivel
    const rad = pl.imanUntil > t ? 4 : 0.85;
    lv.chiquis.forEach(([cx, cy], i) => {
      if (inst.chiquiTaken[i]) return;
      if (Math.abs(cx - pl.x) < rad && Math.abs(cy - (pl.y + 0.85)) < rad + 0.4) {
        inst.chiquiTaken[i] = t + 25; giveChiqui(p);
        io.to(inst.id).emit('pt', { k: 'c', i, on: 0 });
      }
    });
    // chiquis sueltos (los que se le han caído a otro)
    for (const c of inst.loose) {
      if (t - c.born < 0.5 || c.taken) continue;
      if (Math.abs(c.x - pl.x) < rad + 0.2 && Math.abs(c.y - (pl.y + 0.85)) < rad + 0.6) { c.taken = true; giveChiqui(p); }
    }
    // ¡META!
    if (pl.x >= lv.finishX && !pl.finished) {
      pl.finished = true; pl.place = ++inst.race.finishers;
      if (!inst.race.firstFinishAt) { inst.race.firstFinishAt = t; emitRace(inst); }
      io.to(inst.id).emit('fx', { t: 'pfinish', nid: p.nid, name: p.name, place: pl.place });
    }
    p.x = pl.x; p.y = pl.y;
  }

  /* El poder que llevas guardado: tecla E o botón PODER */
  function usePower(inst, p, t) {
    const pl = p.pl;
    if (!pl.power || t < pl.stun || pl.finished) return;
    const pw = pl.power; pl.power = '';
    if (pw === 'guindilla') { pl.turboUntil = t + 3; pl.vx = pl.facing * 17; }
    if (pw === 'escudo') pl.shieldUntil = t + 12;
    if (pw === 'iman') pl.imanUntil = t + 8;
    if (pw === 'petardo') inst.petardos.push({ id: eid++, x: pl.x + pl.facing * 0.6, y: pl.y + 1, vx: pl.facing * 19 + pl.vx * 0.3, vy: 0, owner: p.nid, until: t + 1.6 });
    io.to(inst.id).emit('fx', { t: 'ppower', nid: p.nid, name: p.name, what: POWER_NAMES[pw] });
  }

  /* Robos entre jugadores */
  function interactions(inst, t) {
    const arr = [...inst.players].filter((p) => p.pl && isActive(p) && !p.pl.finished);
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length; j++) {
      if (i === j) continue;
      const A = arr[i], B = arr[j], a = A.pl, b = B.pl;
      if (t < b.invuln || t < a.stun) continue;
      if (Math.abs(a.x - b.x) > 0.8 || a.y > b.y + PH || b.y > a.y + PH) continue;
      // PISOTÓN: caes encima de su cabeza → le robas el poder y 3 chiquis
      if (a.vy < 0 && a.y > b.y + 1.0) {
        a.vy = 14; b.invuln = t + 1.2; b.stun = t + 0.7; b.vy = -4;
        if (t < b.shieldUntil) { b.shieldUntil = 0; io.to(inst.id).emit('fx', { t: 'pshield', nid: B.nid }); continue; }
        const n = Math.min(3, b.chiquis); b.chiquis -= n; a.chiquis += n; a.got += n;
        const pw = b.power;
        if (pw) { a.power = pw; b.power = ''; }
        io.to(inst.id).emit('fx', { t: 'steal', kind: 'pisoton', from: B.name, to: A.name, fromNid: B.nid, toNid: A.nid, n, what: pw ? POWER_NAMES[pw] : '' });
        continue;
      }
      // ACELERÓN: le robas el muñeco (y sale volando)
      const charging = a.dashUntil > t || (a.costume === 'torero' && Math.abs(a.vx) > 11);
      if (charging && !(b.dashUntil > t && Math.abs(b.vx) > Math.abs(a.vx))) {
        b.invuln = t + 1.2; b.stun = t + 0.7; b.vx = a.facing * 11; b.vy = 9;
        if (t < b.shieldUntil) { b.shieldUntil = 0; io.to(inst.id).emit('fx', { t: 'pshield', nid: B.nid }); continue; }
        const mine = a.costume, theirs = b.costume;
        if (theirs !== 'normal') { a.costume = theirs; b.costume = mine; }
        io.to(inst.id).emit('fx', { t: 'steal', kind: 'muneco', from: B.name, to: A.name, fromNid: B.nid, toNid: A.nid,
          what: theirs !== 'normal' ? COSTUME_NAMES[theirs] : '', hint: theirs !== 'normal' ? COSTUME_HINT[theirs] : '' });
      }
    }
  }

  /* Bichos, barriles, petardos y er Tío del Saco */
  function stepThings(inst, t, dt) {
    const lv = inst.lv, racing = [...inst.players].filter((p) => p.pl && isActive(p) && !p.pl.finished);
    const touch = (o, w, h, fnStomp, fnSide) => {
      for (const p of racing) {
        const pl = p.pl;
        if (Math.abs(pl.x - o.x) > HW + w || pl.y > o.y + h || o.y > pl.y + PH) continue;
        if (pl.vy < 0 && pl.y > o.y + h * 0.5) fnStomp(p); else fnSide(p);
      }
    };
    // caracoles
    for (const e of inst.enemies) {
      if (!e.alive) { if (t > e.back) { e.alive = true; e.x = e.homeX ?? e.x; } continue; }
      e.homeX ??= e.x;
      e.vy -= G * dt; e.hitWall = 0;
      const ahead = e.x + Math.sign(e.vx) * 0.6;
      if (e.ground && !solidAt(lv, ahead, e.y - 0.5)) e.vx = -e.vx;
      moveBody(lv, e, dt, 0.4, 0.8);
      if (e.hitWall) e.vx = -2 * e.hitWall;
      if (e.y < -4) { e.alive = false; e.back = t + 10; }
      touch(e, 0.4, 0.8, (p) => { e.alive = false; e.back = t + 12; p.pl.vy = 13; giveChiqui(p); io.to(inst.id).emit('fx', { t: 'pstomp', nid: p.nid }); },
        (p) => hurt(inst, p, t, 'caracol', '¡Te ha mordío un caracol! Esos, con tomate'));
    }
    // barriles (Bodega Loca)
    if (lv.spawners.length && t > inst.spawnAt) {
      inst.spawnAt = t + 3.2 / (1 + 0.1 * inst.platLevel);
      for (const [sx, sy] of lv.spawners) if (racing.some((p) => Math.abs(p.pl.x - sx) < 35)) inst.barrels.push({ id: eid++, type: 2, x: sx, y: sy, vx: -6, vy: 0 });
    }
    inst.barrels = inst.barrels.filter((b) => {
      b.vy -= G * dt; b.hitWall = 0; moveBody(lv, b, dt, 0.45, 0.9);
      if (b.hitWall || b.y < -4 || b.dead) return false;
      b.vx = -6;
      touch(b, 0.45, 0.9, (p) => { b.dead = true; p.pl.vy = 13; io.to(inst.id).emit('fx', { t: 'pstomp', nid: p.nid }); },
        (p) => hurt(inst, p, t, 'barril', '¡Barrilazo! Te han pisao como a una uva'));
      return !b.dead;
    });
    // petardos
    inst.petardos = inst.petardos.filter((pt) => {
      pt.x += pt.vx * dt;
      if (t > pt.until || solidAt(lv, pt.x, pt.y)) { io.to(inst.id).emit('fx', { t: 'pboom', x: r2(pt.x), y: r2(pt.y) }); return false; }
      for (const p of racing) {
        if (p.nid === pt.owner) continue;
        if (Math.abs(p.pl.x - pt.x) < 0.7 && pt.y > p.pl.y - 0.2 && pt.y < p.pl.y + PH) {
          hurt(inst, p, t, 'petardo', '¡PUMBA! Te han tirao un petardo de los de la Feria');
          io.to(inst.id).emit('fx', { t: 'pboom', x: r2(pt.x), y: r2(pt.y) });
          return false;
        }
      }
      return true;
    });
    // chiquis sueltos
    inst.loose = inst.loose.filter((c) => {
      if (c.taken || t > c.until) return false;
      c.vy -= G * 0.7 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
      if (solidAt(lv, c.x, c.y)) { c.y = Math.floor(c.y) + 1; c.vy = Math.abs(c.vy) * 0.55; c.vx *= 0.8; }
      if (solidAt(lv, c.x, c.y + 0.3)) c.vx = -c.vx;
      return c.y > -4;
    });
    // viento del Levante
    if (lv.theme === 'levante' && t > inst.windAt) {
      inst.wind = pick([-1, 1]) * rand(5, 8) * (1 + 0.08 * inst.platLevel); inst.windAt = t + 6;
      io.to(inst.id).emit('fx', { t: 'wind', x: r2(inst.wind), z: 0 });
    }
    // er Tío del Saco persigue al que va primero
    if (lv.theme === 'halloween' && t > inst.race.startAt + 8) {
      if (!inst.saco) inst.saco = { id: eid++, type: 3, x: -4, y: 8, cool: 0 };
      const s = inst.saco;
      let leader = null;
      for (const p of racing) if (!leader || p.pl.x > leader.pl.x) leader = p;
      if (leader) {
        const sp = (t < s.cool ? 3 : 9.3) * (1 + 0.05 * inst.platLevel);
        const dx = leader.pl.x - s.x, dy = leader.pl.y + 1 - s.y, d = Math.hypot(dx, dy) || 1;
        s.x += (dx / d) * sp * dt; s.y += (dy / d) * sp * dt;
        if (d < 1.3 && t > s.cool) {
          s.cool = t + 2.5;
          hurt(inst, leader, t, 'saco', '¡Te ha cogío er Tío del Saco, carajote!');
          leader.pl.vx = -14; leader.pl.vy = 12;
          io.to(inst.id).emit('fx', { t: 'saco', nid: leader.nid, name: leader.name });
        }
      }
    }
    // cajas que vuelven y chiquis que reaparecen
    for (const [k, until] of inst.boxUsed) if (t > until) { inst.boxUsed.delete(k); io.to(inst.id).emit('pt', { k: 'b', i: k, on: 1 }); }
    inst.chiquiTaken.forEach((v, i) => { if (v && t > v) { inst.chiquiTaken[i] = 0; io.to(inst.id).emit('pt', { k: 'c', i, on: 1 }); } });
  }

  /* ---------------------------- EL BUCLE ---------------------------------- */
  function step(inst, t, dt) {
    const race = inst.race;
    for (const p of inst.players) {
      if (!p.pl) spawn(inst, p, 0);
      if (p.wantPower > t) { p.wantPower = 0; usePower(inst, p, t); }
    }
    if (race.state === 'ready' && t > race.until) { race.state = 'race'; race.startAt = t; emitRace(inst); io.to(inst.id).emit('fx', { t: 'pgo' }); }
    if (race.state === 'race') {
      const racing = [...inst.players].filter((p) => isActive(p));
      const allDone = racing.length > 0 && racing.every((p) => p.pl.finished);
      if (t > race.startAt + 150 || (race.firstFinishAt && t > race.firstFinishAt + 20) || allDone) endRace(inst, t);
    }
    if (race.state === 'results' && t > race.until) {
      inst.themeIdx++; inst.platLevel++;
      const room = inst.room; if (room) { room.platLevel = inst.platLevel; markDirty(); }
      newRace(inst);
      return;
    }
    if (race.state !== 'results') {
      for (const p of inst.players) stepPlayer(inst, p, t, dt);
      interactions(inst, t);
      stepThings(inst, t, dt);
    }
  }
  function endRace(inst, t) {
    const race = inst.race;
    race.state = 'results'; race.until = t + 9;
    const list = [...inst.players].filter((p) => p.pl);
    list.sort((a, b) => (a.pl.finished !== b.pl.finished ? (a.pl.finished ? -1 : 1) : a.pl.finished ? a.pl.place - b.pl.place : b.pl.x - a.pl.x));
    const PTS = [30, 20, 12, 8, 5];
    race.ranking = list.map((p, i) => {
      const pts = (p.pl.finished ? PTS[i] ?? 3 : 1) + p.pl.chiquis;
      if (p.profile) {
        p.profile.points += pts;
        p.profile.chiquis = (p.profile.chiquis || 0) + p.pl.got;
        p.profile.platRaces = (p.profile.platRaces || 0) + 1;
        if (i === 0 && p.pl.finished) p.profile.platW = (p.profile.platW || 0) + 1;
        markDirty();
      }
      return { name: p.name, nid: p.nid, place: i + 1, finished: p.pl.finished, chiquis: p.pl.chiquis, pts, costume: COSTUME_NAMES[p.pl.costume] };
    });
    emitRace(inst);
    io.to(inst.id).emit('fx', { t: 'praceEnd', ranking: race.ranking, next: PHASES[PHASE_IDX[THEMES[(inst.themeIdx + 1) % THEMES.length]]].name });
  }

  /* Paquete compacto (15 veces/seg) */
  function snapshot(inst, t) {
    const p = [];
    for (const q of inst.players) {
      const pl = q.pl; if (!pl) continue;
      const flags = (t < pl.invuln ? 1 : 0) | (pl.dashUntil > t ? 2 : 0) | (pl.turboUntil > t ? 4 : 0) | (!isActive(q) ? 8 : 0) |
        (pl.ground ? 16 : 0) | (pl.facing < 0 ? 32 : 0) | (pl.shieldUntil > t ? 64 : 0) | (pl.finished ? 128 : 0) | (pl.glide ? 256 : 0) | (pl.imanUntil > t ? 512 : 0);
      p.push(q.nid, r2(pl.x), r2(pl.y), r2(pl.vx), flags, COSTUMES.indexOf(pl.costume), POWERS.indexOf(pl.power), pl.chiquis);
    }
    const e = [];
    for (const en of inst.enemies) if (en.alive) e.push(en.id, 1, r2(en.x), r2(en.y), en.vx > 0 ? 1 : -1);
    for (const b of inst.barrels) e.push(b.id, 2, r2(b.x), r2(b.y), -1);
    if (inst.saco) e.push(inst.saco.id, 3, r2(inst.saco.x), r2(inst.saco.y), 1);
    for (const pt of inst.petardos) e.push(pt.id, 4, r2(pt.x), r2(pt.y), Math.sign(pt.vx));
    const l = [];
    for (const c of inst.loose) l.push(c.id, r2(c.x), r2(c.y));
    return { t: Math.round(t * 1000), plat: 1, p, e, l };
  }

  return { create, spawn: (inst, p) => spawn(inst, p, inst.players.size), step, packet, snapshot, raceInfo };
};
