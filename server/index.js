'use strict';

const os = require('os');
const path = require('path');
const express = require('express');
const http = require('http');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { GameManager } = require('./gameManager');
const store = require('./store');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, '..', 'public')));

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

app.get('/api/network-info', (req, res) => {
  res.json({ port: PORT, addresses: getLanAddresses() });
});

app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text query param');
  try {
    const buffer = await QRCode.toBuffer(String(text), { width: 320, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Failed to generate QR code');
  }
});

const persisted = store.loadState();
const game = new GameManager(persisted);

// playerId -> socket.id (most recent active connection for that player)
const playerSockets = new Map();
let hostSocketCount = 0;
let displaySocketCount = 0;

function persistSoon() {
  store.saveStateDebounced(() => game.toPersistable());
}

function broadcastAll() {
  io.to('host').emit('state', game.buildHostView());
  io.to('display').emit('state', game.buildDisplayView());
  for (const [playerId, socketId] of playerSockets.entries()) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    const view = game.buildPlayerView(playerId);
    if (view) sock.emit('state', view);
  }
  io.emit('lobby:players', sanitizedLobbyPlayers());
  persistSoon();
}

function sanitizedLobbyPlayers() {
  return game.listPlayers().map((p) => ({ id: p.id, name: p.name, connected: p.connected }));
}

game.on('change', broadcastAll);

function wrap(fn) {
  return (payload, cb) => {
    try {
      const result = fn(payload) || {};
      if (typeof cb === 'function') cb({ ok: true, ...result });
    } catch (err) {
      if (typeof cb === 'function') cb({ ok: false, error: err.message || 'Something went wrong.' });
    }
  };
}

io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.playerId = null;

  socket.emit('lobby:players', sanitizedLobbyPlayers());
  socket.emit('network:info', { port: PORT, addresses: getLanAddresses() });

  // ----- Host -----
  socket.on('host:hello', wrap(() => {
    socket.join('host');
    socket.data.role = 'host';
    hostSocketCount += 1;
    game.state.hostConnected = true;
    socket.emit('state', game.buildHostView());
    return {};
  }));

  socket.on('host:startGame', wrap(() => game.startGame()));
  socket.on('host:resetGame', wrap((p) => game.resetGame(p || {})));
  socket.on('host:selectBoard', wrap((p) => game.selectBoard(p.boardIndex)));
  socket.on('host:openClue', wrap((p) => game.openClue(p.boardIndex, p.categoryIndex, p.clueIndex)));
  socket.on('host:judgeClue', wrap((p) => game.judgeClue(!!p.correct)));
  socket.on('host:continueClue', wrap(() => game.continueClue()));
  socket.on('host:revealAnswer', wrap(() => game.revealAnswer()));
  socket.on('host:closeClue', wrap(() => game.closeClue()));

  socket.on('host:setDailyDoubleWagerPlayer', wrap((p) => game.setDailyDoubleWagerPlayer(p.playerId)));
  socket.on('host:submitWagerForPlayer', wrap((p) => game.submitDailyDoubleWager(p.playerId, p.amount)));
  socket.on('host:judgeDailyDouble', wrap((p) => game.judgeDailyDouble(!!p.correct)));

  socket.on('host:adjustScore', wrap((p) => game.adjustScore(p.playerId, Number(p.delta))));
  socket.on('host:setScore', wrap((p) => game.setScore(p.playerId, Number(p.score))));
  socket.on('host:renamePlayer', wrap((p) => game.renamePlayer(p.playerId, p.name)));
  socket.on('host:removePlayer', wrap((p) => game.removePlayer(p.playerId)));

  socket.on('host:updateSettings', wrap((p) => game.updateSettings(p)));
  socket.on('host:updateBoardMeta', wrap((p) => game.updateBoardMeta(p.boardIndex, p.name)));
  socket.on('host:updateCategory', wrap((p) => game.updateCategory(p.boardIndex, p.categoryIndex, p.name)));
  socket.on('host:updateClue', wrap((p) => game.updateClue(p.boardIndex, p.categoryIndex, p.clueIndex, p)));
  socket.on('host:toggleDailyDouble', wrap((p) => game.toggleDailyDouble(p.boardIndex, p.categoryIndex, p.clueIndex)));
  socket.on('host:randomizeDailyDouble', wrap((p) => game.randomizeDailyDouble(p.boardIndex, { force: true })));

  socket.on('host:startFinalJeopardy', wrap((p) => game.startFinalJeopardy(p)));
  socket.on('host:advanceToFinalAnswer', wrap(() => game.advanceToFinalAnswer()));
  socket.on('host:revealFinalAnswers', wrap(() => game.revealFinalAnswers()));
  socket.on('host:judgeFinal', wrap((p) => game.judgeFinal(p.playerId, !!p.correct)));
  socket.on('host:endGame', wrap(() => game.endGame()));

  // ----- Display -----
  socket.on('display:hello', wrap(() => {
    socket.join('display');
    socket.data.role = 'display';
    displaySocketCount += 1;
    socket.emit('state', game.buildDisplayView());
    return {};
  }));

  // ----- Player -----
  function bindPlayerSocket(playerId) {
    const existingSocketId = playerSockets.get(playerId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const old = io.sockets.sockets.get(existingSocketId);
      if (old) {
        old.emit('player:kicked', { reason: 'You joined from another device/tab.' });
        old.data.role = null;
        old.data.playerId = null;
        old.leave('players');
      }
    }
    playerSockets.set(playerId, socket.id);
    socket.join('players');
    socket.data.role = 'player';
    socket.data.playerId = playerId;
  }

  socket.on('player:reconnect', wrap((p) => {
    const player = game.findPlayerByToken(p.token);
    if (!player) throw new Error('Session expired.');
    game.claimPlayer(player.id);
    bindPlayerSocket(player.id);
    socket.emit('player:joined', { token: player.token, playerId: player.id, name: player.name });
    socket.emit('state', game.buildPlayerView(player.id));
    return {};
  }));

  socket.on('player:join', wrap((p) => {
    const player = game.addPlayer(p.name);
    bindPlayerSocket(player.id);
    socket.emit('player:joined', { token: player.token, playerId: player.id, name: player.name });
    socket.emit('state', game.buildPlayerView(player.id));
    return { playerId: player.id, token: player.token };
  }));

  socket.on('player:claim', wrap((p) => {
    const player = game.claimPlayer(p.playerId);
    bindPlayerSocket(player.id);
    socket.emit('player:joined', { token: player.token, playerId: player.id, name: player.name });
    socket.emit('state', game.buildPlayerView(player.id));
    return { playerId: player.id, token: player.token };
  }));

  socket.on('player:buzz', wrap(() => {
    if (!socket.data.playerId) throw new Error('Not joined.');
    game.playerBuzz(socket.data.playerId);
  }));

  socket.on('player:submitDailyDoubleWager', wrap((p) => {
    if (!socket.data.playerId) throw new Error('Not joined.');
    game.submitDailyDoubleWager(socket.data.playerId, Number(p.amount));
  }));

  socket.on('player:submitFinalWager', wrap((p) => {
    if (!socket.data.playerId) throw new Error('Not joined.');
    game.submitFinalWager(socket.data.playerId, Number(p.amount));
  }));

  socket.on('player:submitFinalAnswer', wrap((p) => {
    if (!socket.data.playerId) throw new Error('Not joined.');
    game.submitFinalAnswer(socket.data.playerId, p.text);
  }));

  socket.on('disconnect', () => {
    if (socket.data.role === 'host') {
      hostSocketCount = Math.max(0, hostSocketCount - 1);
      if (hostSocketCount === 0) {
        game.state.hostConnected = false;
        broadcastAll();
      }
    } else if (socket.data.role === 'display') {
      displaySocketCount = Math.max(0, displaySocketCount - 1);
    } else if (socket.data.role === 'player' && socket.data.playerId) {
      if (playerSockets.get(socket.data.playerId) === socket.id) {
        playerSockets.delete(socket.data.playerId);
        game.setConnected(socket.data.playerId, false);
      }
    }
  });
});

server.listen(PORT, () => {
  const addrs = getLanAddresses();
  console.log('');
  console.log('=================================================');
  console.log('  Jeopardy server is running!');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of addrs) {
    console.log(`  Network: http://${addr}:${PORT}`);
  }
  console.log('=================================================');
  console.log('');
});

process.on('SIGINT', () => {
  store.saveStateNow(() => game.toPersistable());
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.saveStateNow(() => game.toPersistable());
  process.exit(0);
});
