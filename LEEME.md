# ¡LA LIÁ! — Jerez vs Guadalcacín

Juego multijugador 3D para el navegador (móvil u ordenador). Fútbol, pádel, el Tío del Saco y mucho arte.

```
la-lia/
├── index.js            ← el servidor (Node + Express + Socket.io)
├── plataformas.js      ← el modo carrera de plataformas
├── public/index.html   ← el juego (Three.js + Socket.io por CDN, un solo archivo)
├── test/simulacion.js  ← prueba con jugadores de mentira
└── data/               ← se crea solo: perfiles y salas guardadas
```

## Probarlo en tu ordenador

1. Instala Node.js 18 o superior (nodejs.org).
2. En esta carpeta: `npm install` y luego `npm start`.
3. Abre http://localhost:3000 en dos pestañas y juega contra ti mismo.

Para ver los 8 mundos sin esperar un minuto en cada uno: `PHASE_SECONDS=8 npm start`.

## Que jueguen los chavales desde su casa

El servidor tiene que estar en internet. Lo más sencillo es subir la carpeta a GitHub y desplegarla en **Render**, **Railway** o **Fly.io** (comando de arranque `npm start`; el puerto lo cogen solos de `PORT`).

Te darán una dirección `https://algo.onrender.com`. Ese enlace es el que se pasa por WhatsApp. Dentro del juego, el botón **📲 Invitar** manda el enlace con el código de sala ya puesto.

Dos cosas importantes:

- **La cámara sólo funciona con https** (o en localhost). Los servicios de arriba ya dan https.
- **El histórico se guarda en `data/`**. En los planes gratuitos el disco se borra al reiniciar. Para que no se pierda, añade un disco/volumen persistente y pon la variable `DATA_DIR` apuntando a él (en Railway y Fly es un volumen; en Render, un "Persistent Disk").

## Cómo se juega

| | Ordenador | Móvil |
|---|---|---|
| Mover | WASD / flechas | joystick (mitad izquierda) |
| Chutar / golpear | Espacio | botón CHUTA |
| Esprín | Shift | botón ESPRÍN |
| Frases | teclas 1‑8 | botón 💬 |

- **Campo grande**: Jerez contra Guadalcacín, los equipos se reparten solos. Un partido dura una vuelta completa a los 8 mundos (8 minutos). Cada vuelta sube el **nivel** y todo va más rápido.
- **🏃 Plataformas** (botón amarillo de la izquierda): carrera de lado, todos a la vez, hasta la META. Cada carrera es un mundo distinto y cada vez más difícil. Ver más abajo.
- **Retos 1vs1**: en 👥 retas a quien quieras a **pádel** (a 7 puntos) o **fútbol** (a 3 goles). También contra el bot.
- **⏸️ Me voy un momento**: merendar, comer, deberes… A todos les sale "Nico está merendando, ahora vuelve". En un reto, el partido se para hasta que vuelvas.
- **🏆 Ranking**: puntos, goles, partidos, pádel y veces que te ha cogido el Tío del Saco.
- Si estás solo, entra un bot para que no te aburras.

## Modo Plataformas: aquí se roba

| Qué | Cómo se consigue | Cómo se roba |
|---|---|---|
| 🧒 **Chiquis** (los chiquillos que rescatas) | Por el nivel, y pisando bichos | **Pisándole la cabeza** a otro le quitas 3. Si te da algo, se te caen todos y los coge el primero que pase |
| 🌶️🛡️🧨🧲 **Poderes** (guindilla turbo, escudo, petardo, imán) | Cajas amarillas **?** (golpe desde abajo) | **Pisándole la cabeza** a otro te quedas con el suyo |
| ⚡💃👻🐂 **Muñecos** (Rayo: corre más · Saltaora: doble salto · Fantasma: planea · Torero: sus acelerones derriban) | Cajas moradas **★** | Dándole un **acelerón (DASH)** a otro te quedas con su muñeco y él con el tuyo |

Controles: ←→ correr · Espacio/W saltar (mantén para saltar más) · Shift o X acelerón · E usar poder. En el móvil: joystick, SALTA, DASH y PODER.

Peligros: chumberas, hoyos (vuelves al último banderín), caracoles, barriles en la Bodega, viento en el Levante, hielo en Navidad y el Tío del Saco persiguiendo al que va primero en Halloween. Cuando llega el primero, los demás tienen 20 segundos. Puntos: 30/20/12/8/5 por puesto + 1 por cada chiqui.

## Los mundos del fútbol (cambian solos cada 60 s)

| Mundo | Lo que pasa |
|---|---|
| 🎃 El Fantasma del Alcázar | El Tío del Saco persigue al que lleva la pelota y lo manda volando |
| 🎄 Nieve en la Plaza del Mamelón | Hielo, fricción cero: no paras ni a tiros |
| 🏖️ Caló y playa | Vas a la mitad, sin esprín, balón de playa que rebota el doble |
| 🌬️ Levante en Cádiz | Viento que cambia cada 6 s y sombrillas voladoras |
| 🐴 Feria del Caballo | Dos balones y coches de caballos (aviso con raya roja) |
| 🏍️ Circuito de Jerez | Motos a toda velocidad y turbos en el suelo |
| 🍇 Bodega Loca | Barriles rodando y charcos de mosto que te pegan al suelo |
| 🔦 Apagón en Guadalcacín | El balón sólo se ve a ratos y los controles se dan la vuelta |

En el pádel salen los mundos que tienen sentido en una pista pequeña (Tío del Saco, hielo, playa, Levante y apagón).

## Privacidad de las caras

La foto se hace una vez, en 128×128 (unos 7 KB). Se queda en el móvil de cada uno, se manda al servidor sólo mientras está conectado y sólo a los que la piden. **No se guarda en disco.** Las salas son privadas: hace falta el código. Quien no quiera cámara puede usar la cara dibujada.

## Datos de red

- Cada jugador manda sólo su dirección, el esprín y los chutes (como mucho 20 veces por segundo y sólo si cambia algo).
- El servidor manda el estado 15 veces por segundo en arrays planos de unos 130 bytes.
- Las caras van una vez por jugador y sólo cuando alguien la necesita.

## Prueba automática

Con el servidor arrancado en modo prueba (`npm run prueba`), en otra terminal: `npm test` (fútbol, pádel, avisos) y `node test/plataformas.js` (carrera). Simulan chavales conectándose, merendando, retándose y robándose cosas.
