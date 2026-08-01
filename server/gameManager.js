'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const { createDefaultBoards } = require('./defaultBoards');

const MAX_PLAYERS = 4;
const DEFAULT_SETTINGS = {
  deductOnWrong: true,
  wordIntervalMs: 650,
  finalAnswerSeconds: 45,
};

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

class GameManager extends EventEmitter {
  constructor(persisted) {
    super();
    this.state = this._hydrate(persisted);
    this._wordTimer = null;
    this._finalDeadlineTimer = null;
  }

  _hydrate(persisted) {
    const boards = persisted && Array.isArray(persisted.boards) && persisted.boards.length === 2
      ? persisted.boards
      : createDefaultBoards();

    const players = {};
    const playerOrder = [];
    if (persisted && persisted.players) {
      for (const pid of persisted.playerOrder || Object.keys(persisted.players)) {
        const p = persisted.players[pid];
        if (!p) continue;
        players[pid] = {
          id: pid,
          token: p.token,
          name: p.name,
          score: typeof p.score === 'number' ? p.score : 0,
          connected: false,
        };
        playerOrder.push(pid);
      }
    }

    // Never resume mid-clue / mid-final across a server restart; fall back to the board screen.
    let phase = 'lobby';
    if (persisted && ['lobby', 'board', 'ended'].includes(persisted.phase)) {
      phase = persisted.phase;
    } else if (persisted && persisted.phase) {
      phase = 'board';
    }

    return {
      players,
      playerOrder,
      hostConnected: false,
      boards,
      currentBoardIndex: persisted && typeof persisted.currentBoardIndex === 'number' ? persisted.currentBoardIndex : 0,
      phase,
      controlPlayerId: (persisted && persisted.controlPlayerId) || null,
      activeClue: null,
      finalJeopardy: persisted && persisted.finalJeopardy && persisted.finalJeopardy.savedForRecord
        ? persisted.finalJeopardy
        : null,
      settings: Object.assign({}, DEFAULT_SETTINGS, (persisted && persisted.settings) || {}),
    };
  }

  toPersistable() {
    const s = this.state;
    return {
      players: s.players,
      playerOrder: s.playerOrder,
      boards: s.boards,
      currentBoardIndex: s.currentBoardIndex,
      phase: ['lobby', 'board', 'ended'].includes(s.phase) ? s.phase : 'board',
      controlPlayerId: s.controlPlayerId,
      settings: s.settings,
      finalJeopardy: s.finalJeopardy && s.phase === 'ended' ? Object.assign({}, s.finalJeopardy, { savedForRecord: true }) : null,
    };
  }

  _emitChange() {
    this.emit('change');
  }

  // ---------- Players ----------

  listPlayers() {
    return this.state.playerOrder.map((id) => this.state.players[id]).filter(Boolean);
  }

  getPlayer(id) {
    return this.state.players[id] || null;
  }

  findPlayerByToken(token) {
    if (!token) return null;
    return this.listPlayers().find((p) => p.token === token) || null;
  }

  addPlayer(name) {
    const trimmed = (name || '').trim().slice(0, 20) || 'Player';
    if (this.state.playerOrder.length >= MAX_PLAYERS) {
      throw new Error('The game already has the maximum of 4 contestants.');
    }
    const id = uid('p');
    const player = {
      id,
      token: uid('tok'),
      name: trimmed,
      score: 0,
      connected: true,
    };
    this.state.players[id] = player;
    this.state.playerOrder.push(id);
    this._emitChange();
    return player;
  }

  claimPlayer(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('That player no longer exists.');
    player.connected = true;
    this._emitChange();
    return player;
  }

  setConnected(playerId, connected) {
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.connected = connected;
    this._emitChange();
  }

  renamePlayer(playerId, name) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('Player not found.');
    player.name = (name || '').trim().slice(0, 20) || player.name;
    this._emitChange();
  }

  removePlayer(playerId) {
    if (!this.state.players[playerId]) return;
    delete this.state.players[playerId];
    this.state.playerOrder = this.state.playerOrder.filter((id) => id !== playerId);
    if (this.state.controlPlayerId === playerId) this.state.controlPlayerId = null;
    if (this.state.activeClue) {
      if (this.state.activeClue.buzzedPlayerId === playerId) this.state.activeClue.buzzedPlayerId = null;
      if (this.state.activeClue.wagerPlayerId === playerId) this.state.activeClue.wagerPlayerId = null;
      this.state.activeClue.wrongPlayerIds = (this.state.activeClue.wrongPlayerIds || []).filter((id) => id !== playerId);
    }
    if (this.state.finalJeopardy && this.state.finalJeopardy.entries) {
      delete this.state.finalJeopardy.entries[playerId];
    }
    this._emitChange();
  }

  adjustScore(playerId, delta) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('Player not found.');
    player.score += delta;
    this._emitChange();
  }

  setScore(playerId, value) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('Player not found.');
    player.score = Math.round(value);
    this._emitChange();
  }

  // ---------- Board editing ----------

  updateSettings(patch) {
    Object.assign(this.state.settings, patch || {});
    this._emitChange();
  }

  updateBoardMeta(boardIndex, name) {
    const board = this._board(boardIndex);
    board.name = (name || '').trim().slice(0, 40) || board.name;
    this._emitChange();
  }

  updateCategory(boardIndex, categoryIndex, name) {
    const cat = this._category(boardIndex, categoryIndex);
    cat.name = (name || '').trim().slice(0, 30) || cat.name;
    this._emitChange();
  }

  updateClue(boardIndex, categoryIndex, clueIndex, { question, answer, value }) {
    const clue = this._clue(boardIndex, categoryIndex, clueIndex);
    if (typeof question === 'string') clue.question = question.slice(0, 500);
    if (typeof answer === 'string') clue.answer = answer.slice(0, 300);
    if (typeof value === 'number' && Number.isFinite(value)) clue.value = Math.max(0, Math.round(value));
    this._emitChange();
  }

  toggleDailyDouble(boardIndex, categoryIndex, clueIndex) {
    const board = this._board(boardIndex);
    const target = this._clue(boardIndex, categoryIndex, clueIndex);
    const turningOn = !target.dailyDouble;
    for (const cat of board.categories) {
      for (const clue of cat.clues) clue.dailyDouble = false;
    }
    target.dailyDouble = turningOn;
    this._emitChange();
  }

  randomizeDailyDouble(boardIndex, { force = true } = {}) {
    const board = this._board(boardIndex);
    const allClues = [];
    for (const cat of board.categories) {
      for (const clue of cat.clues) allClues.push(clue);
    }
    const alreadyHasOne = allClues.some((c) => c.dailyDouble);
    if (alreadyHasOne && !force) return;
    for (const clue of allClues) clue.dailyDouble = false;
    const pick = allClues[Math.floor(Math.random() * allClues.length)];
    if (pick) pick.dailyDouble = true;
    this._emitChange();
  }

  resetGame({ resetScores = false } = {}) {
    this._clearTimers();
    for (const board of this.state.boards) {
      for (const cat of board.categories) {
        for (const clue of cat.clues) {
          clue.used = false;
        }
      }
    }
    if (resetScores) {
      for (const p of this.listPlayers()) p.score = 0;
    }
    this.state.currentBoardIndex = 0;
    this.state.phase = 'lobby';
    this.state.controlPlayerId = null;
    this.state.activeClue = null;
    this.state.finalJeopardy = null;
    this._emitChange();
  }

  // ---------- Game flow ----------

  startGame() {
    this.randomizeDailyDouble(0, { force: false });
    this.randomizeDailyDouble(1, { force: false });
    this.state.phase = 'board';
    this.state.currentBoardIndex = 0;
    this._emitChange();
  }

  selectBoard(index) {
    if (index !== 0 && index !== 1) throw new Error('Invalid board index.');
    if (this.state.phase !== 'board' && this.state.phase !== 'lobby') {
      throw new Error('Finish the current clue before switching boards.');
    }
    this.state.currentBoardIndex = index;
    this.state.phase = 'board';
    this._emitChange();
  }

  _board(index) {
    const board = this.state.boards[index];
    if (!board) throw new Error('Board not found.');
    return board;
  }

  _category(boardIndex, categoryIndex) {
    const board = this._board(boardIndex);
    const cat = board.categories[categoryIndex];
    if (!cat) throw new Error('Category not found.');
    return cat;
  }

  _clue(boardIndex, categoryIndex, clueIndex) {
    const cat = this._category(boardIndex, categoryIndex);
    const clue = cat.clues[clueIndex];
    if (!clue) throw new Error('Clue not found.');
    return clue;
  }

  _clearTimers() {
    if (this._wordTimer) {
      clearInterval(this._wordTimer);
      this._wordTimer = null;
    }
    if (this._finalDeadlineTimer) {
      clearTimeout(this._finalDeadlineTimer);
      this._finalDeadlineTimer = null;
    }
  }

  openClue(boardIndex, categoryIndex, clueIndex) {
    if (this.state.phase !== 'board') throw new Error('You can only open a clue from the board screen.');
    if (boardIndex !== this.state.currentBoardIndex) throw new Error('That clue is not on the current board.');
    const clue = this._clue(boardIndex, categoryIndex, clueIndex);
    if (clue.used) throw new Error('That clue was already played.');
    const category = this._category(boardIndex, categoryIndex);

    this._clearTimers();

    if (clue.dailyDouble) {
      const defaultWagerPlayer = this.state.controlPlayerId && this.getPlayer(this.state.controlPlayerId) && this.getPlayer(this.state.controlPlayerId).connected
        ? this.state.controlPlayerId
        : null;
      this.state.activeClue = {
        boardIndex,
        categoryIndex,
        clueIndex,
        category: category.name,
        value: clue.value,
        question: clue.question,
        answer: clue.answer,
        isDailyDouble: true,
        status: 'dd-select-player',
        wagerPlayerId: defaultWagerPlayer,
        wager: null,
      };
    } else {
      const words = String(clue.question || '').split(/\s+/).filter(Boolean);
      this.state.activeClue = {
        boardIndex,
        categoryIndex,
        clueIndex,
        category: category.name,
        value: clue.value,
        question: clue.question,
        answer: clue.answer,
        isDailyDouble: false,
        status: 'loading',
        words,
        revealedCount: 0,
        buzzedPlayerId: null,
        wrongPlayerIds: [],
      };
      this._startWordTimer();
    }
    this.state.phase = 'clue';
    this._emitChange();
  }

  _startWordTimer() {
    this._clearTimers();
    this._wordTimer = setInterval(() => {
      const ac = this.state.activeClue;
      if (!ac || ac.status !== 'loading') {
        this._clearTimers();
        return;
      }
      if (ac.revealedCount < ac.words.length) {
        ac.revealedCount += 1;
        this._emitChange();
      }
      if (ac.revealedCount >= ac.words.length) {
        this._clearTimers();
      }
    }, this.state.settings.wordIntervalMs);
  }

  playerBuzz(playerId) {
    const ac = this.state.activeClue;
    if (!ac || ac.isDailyDouble) throw new Error('Buzzing is not available right now.');
    if (ac.status !== 'loading') throw new Error('Buzzing is not available right now.');
    if (ac.wrongPlayerIds.includes(playerId)) throw new Error('You already tried this clue.');
    const player = this.getPlayer(playerId);
    if (!player || !player.connected) throw new Error('Player not recognized.');
    this._clearTimers();
    ac.status = 'buzzed';
    ac.buzzedPlayerId = playerId;
    this._emitChange();
  }

  judgeClue(correct) {
    const ac = this.state.activeClue;
    if (!ac || ac.isDailyDouble) throw new Error('No clue awaiting judgement.');
    if (ac.status !== 'buzzed' || !ac.buzzedPlayerId) throw new Error('No one has buzzed in.');
    const playerId = ac.buzzedPlayerId;
    if (correct) {
      this.adjustScore(playerId, ac.value);
      this.state.controlPlayerId = playerId;
      this._markCurrentClueUsed();
      ac.status = 'answer-shown';
      ac.buzzedPlayerId = null;
    } else {
      if (this.state.settings.deductOnWrong) {
        this.adjustScore(playerId, -ac.value);
      }
      ac.wrongPlayerIds.push(playerId);
      ac.buzzedPlayerId = null;
      ac.status = 'paused';
    }
    this._emitChange();
  }

  continueClue() {
    const ac = this.state.activeClue;
    if (!ac || ac.isDailyDouble) throw new Error('Nothing to continue.');
    if (ac.status !== 'paused') throw new Error('Clue is not paused.');
    ac.status = 'loading';
    if (ac.revealedCount < ac.words.length) {
      this._startWordTimer();
    }
    this._emitChange();
  }

  revealAnswer() {
    const ac = this.state.activeClue;
    if (!ac || ac.isDailyDouble) throw new Error('No clue is open.');
    if (!['loading', 'paused'].includes(ac.status)) throw new Error('Answer already shown.');
    this._clearTimers();
    this._markCurrentClueUsed();
    ac.status = 'answer-shown';
    ac.buzzedPlayerId = null;
    this._emitChange();
  }

  _markCurrentClueUsed() {
    const ac = this.state.activeClue;
    if (!ac) return;
    const clue = this._clue(ac.boardIndex, ac.categoryIndex, ac.clueIndex);
    clue.used = true;
  }

  closeClue() {
    const ac = this.state.activeClue;
    if (!ac) throw new Error('No clue is open.');
    if (ac.status !== 'answer-shown') throw new Error('Answer has not been revealed yet.');
    this.state.activeClue = null;
    this.state.phase = 'board';
    this._emitChange();
  }

  // ---------- Daily Double ----------

  setDailyDoubleWagerPlayer(playerId) {
    const ac = this.state.activeClue;
    if (!ac || !ac.isDailyDouble || ac.status !== 'dd-select-player') {
      throw new Error('Not currently choosing a Daily Double contestant.');
    }
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('Player not found.');
    ac.wagerPlayerId = playerId;
    ac.status = 'dd-wager';
    this._emitChange();
  }

  _dailyDoubleMaxWager(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return 1000;
    return player.score >= 1000 ? player.score : 1000;
  }

  submitDailyDoubleWager(playerId, amount) {
    const ac = this.state.activeClue;
    if (!ac || !ac.isDailyDouble || ac.status !== 'dd-wager') throw new Error('Not currently wagering.');
    if (ac.wagerPlayerId !== playerId) throw new Error('It is not your Daily Double.');
    const max = this._dailyDoubleMaxWager(playerId);
    const wager = Math.round(Number(amount));
    if (!Number.isFinite(wager) || wager < 0 || wager > max) {
      throw new Error(`Wager must be between 0 and ${max}.`);
    }
    ac.wager = wager;
    ac.status = 'dd-revealed';
    this._emitChange();
  }

  judgeDailyDouble(correct) {
    const ac = this.state.activeClue;
    if (!ac || !ac.isDailyDouble || ac.status !== 'dd-revealed') throw new Error('No Daily Double awaiting judgement.');
    const playerId = ac.wagerPlayerId;
    const delta = correct ? ac.wager : -ac.wager;
    this.adjustScore(playerId, delta);
    if (correct) this.state.controlPlayerId = playerId;
    this._markCurrentClueUsed();
    ac.status = 'answer-shown';
    this._emitChange();
  }

  // ---------- Final Jeopardy ----------

  startFinalJeopardy({ category, question, answer }) {
    if (!question || !answer) throw new Error('Final Jeopardy needs a question and an answer.');
    this._clearTimers();
    const entries = {};
    for (const p of this.listPlayers()) {
      if (!p.connected) continue;
      entries[p.id] = { wager: null, answer: null, revealed: false, correct: null };
    }
    if (Object.keys(entries).length === 0) throw new Error('No connected players to play Final Jeopardy.');
    this.state.finalJeopardy = {
      category: (category || 'Final Jeopardy').slice(0, 40),
      question: question.slice(0, 500),
      answer: answer.slice(0, 300),
      entries,
      deadline: null,
    };
    this.state.phase = 'final-wager';
    this.state.activeClue = null;
    this._emitChange();
  }

  submitFinalWager(playerId, amount) {
    const fj = this.state.finalJeopardy;
    if (!fj || this.state.phase !== 'final-wager') throw new Error('Not currently wagering.');
    const entry = fj.entries[playerId];
    if (!entry) throw new Error('You are not part of Final Jeopardy.');
    const player = this.getPlayer(playerId);
    const max = Math.max(player.score, 0);
    const wager = Math.round(Number(amount));
    if (!Number.isFinite(wager) || wager < 0 || wager > max) {
      throw new Error(`Wager must be between 0 and ${max}.`);
    }
    entry.wager = wager;
    this._emitChange();
  }

  advanceToFinalAnswer() {
    const fj = this.state.finalJeopardy;
    if (!fj || this.state.phase !== 'final-wager') throw new Error('Not currently wagering.');
    for (const entry of Object.values(fj.entries)) {
      if (entry.wager === null) entry.wager = 0;
    }
    fj.deadline = Date.now() + this.state.settings.finalAnswerSeconds * 1000;
    this.state.phase = 'final-answer';
    this._emitChange();
    this._clearTimers();
    this._finalDeadlineTimer = setTimeout(() => {
      this._emitChange();
    }, this.state.settings.finalAnswerSeconds * 1000 + 50);
  }

  submitFinalAnswer(playerId, text) {
    const fj = this.state.finalJeopardy;
    if (!fj || this.state.phase !== 'final-answer') throw new Error('Not currently answering.');
    const entry = fj.entries[playerId];
    if (!entry) throw new Error('You are not part of Final Jeopardy.');
    entry.answer = (text || '').slice(0, 200);
    this._emitChange();
  }

  revealFinalAnswers() {
    const fj = this.state.finalJeopardy;
    if (!fj || this.state.phase !== 'final-answer') throw new Error('Not currently answering.');
    this._clearTimers();
    for (const entry of Object.values(fj.entries)) {
      if (entry.answer === null) entry.answer = '';
    }
    this.state.phase = 'final-reveal';
    this._emitChange();
  }

  judgeFinal(playerId, correct) {
    const fj = this.state.finalJeopardy;
    if (!fj || this.state.phase !== 'final-reveal') throw new Error('Not currently revealing.');
    const entry = fj.entries[playerId];
    if (!entry) throw new Error('Player not part of Final Jeopardy.');
    if (entry.revealed) throw new Error('Already revealed.');
    entry.revealed = true;
    entry.correct = correct;
    this.adjustScore(playerId, correct ? entry.wager : -entry.wager);
    this._emitChange();
  }

  endGame() {
    this.state.phase = 'ended';
    this._emitChange();
  }

  // ---------- Views ----------

  buildHostView() {
    const s = this.state;
    return {
      role: 'host',
      phase: s.phase,
      currentBoardIndex: s.currentBoardIndex,
      boards: s.boards,
      players: this.listPlayers(),
      controlPlayerId: s.controlPlayerId,
      activeClue: s.activeClue,
      finalJeopardy: s.finalJeopardy,
      settings: s.settings,
      maxPlayers: MAX_PLAYERS,
    };
  }

  buildDisplayView() {
    const s = this.state;
    const board = s.boards[s.currentBoardIndex];
    const boardView = {
      name: board.name,
      categories: board.categories.map((cat) => ({
        name: cat.name,
        clues: cat.clues.map((clue) => ({ value: clue.value, used: clue.used })),
      })),
    };

    let activeClue = null;
    if (s.activeClue) {
      const ac = s.activeClue;
      if (ac.isDailyDouble) {
        activeClue = {
          isDailyDouble: true,
          category: ac.category,
          value: ac.value,
          status: ac.status,
          wagerPlayerName: ac.wagerPlayerId ? (this.getPlayer(ac.wagerPlayerId) || {}).name : null,
          wager: ['dd-revealed', 'answer-shown'].includes(ac.status) ? ac.wager : null,
          question: ['dd-revealed', 'answer-shown'].includes(ac.status) ? ac.question : null,
          answer: ac.status === 'answer-shown' ? ac.answer : null,
        };
      } else {
        const revealedText = ac.words.slice(0, ac.revealedCount).join(' ');
        activeClue = {
          isDailyDouble: false,
          category: ac.category,
          value: ac.value,
          status: ac.status,
          revealedText: ac.status === 'answer-shown' ? ac.words.join(' ') : revealedText,
          fullyRevealed: ac.revealedCount >= ac.words.length,
          buzzedPlayerName: ac.buzzedPlayerId ? (this.getPlayer(ac.buzzedPlayerId) || {}).name : null,
          answer: ac.status === 'answer-shown' ? ac.answer : null,
        };
      }
    }

    return {
      role: 'display',
      phase: s.phase,
      currentBoardIndex: s.currentBoardIndex,
      board: boardView,
      players: this.listPlayers(),
      activeClue,
      finalJeopardy: this._sanitizeFinalForAudience(),
    };
  }

  _sanitizeFinalForAudience() {
    const fj = this.state.finalJeopardy;
    if (!fj) return null;
    const base = { category: fj.category, phase: this.state.phase };
    if (['final-answer', 'final-reveal'].includes(this.state.phase) || this.state.phase === 'ended') {
      base.question = fj.question;
    }
    if (['final-reveal', 'ended'].includes(this.state.phase)) {
      base.answer = fj.answer;
    }
    if (this.state.phase === 'final-answer') {
      base.deadline = fj.deadline;
    }
    base.entries = {};
    for (const [pid, entry] of Object.entries(fj.entries)) {
      base.entries[pid] = {
        wagerKnown: entry.wager !== null,
        answerLockedIn: entry.answer !== null,
        revealed: entry.revealed,
        wager: entry.revealed ? entry.wager : null,
        answer: entry.revealed ? entry.answer : null,
        correct: entry.revealed ? entry.correct : null,
      };
    }
    return base;
  }

  buildPlayerView(playerId) {
    const s = this.state;
    const player = this.getPlayer(playerId);
    if (!player) return null;

    const view = {
      role: 'player',
      me: { id: player.id, name: player.name, score: player.score },
      phase: s.phase,
      buzzer: { state: 'disabled', message: 'Waiting for the host to start...' },
      dailyDouble: null,
      finalJeopardy: null,
    };

    if (s.phase === 'clue' && s.activeClue) {
      const ac = s.activeClue;
      if (ac.isDailyDouble) {
        view.buzzer = { state: 'disabled', message: 'Daily Double!' };
        if (ac.wagerPlayerId === playerId && ac.status === 'dd-wager') {
          view.dailyDouble = {
            youAreWagering: true,
            max: this._dailyDoubleMaxWager(playerId),
          };
        } else if (ac.status === 'dd-select-player') {
          view.buzzer.message = 'Daily Double! Waiting for host...';
        } else {
          const wagerName = ac.wagerPlayerId ? (this.getPlayer(ac.wagerPlayerId) || {}).name : 'A player';
          view.buzzer.message = `Daily Double! ${wagerName} is wagering...`;
        }
      } else if (ac.status === 'loading') {
        if (ac.wrongPlayerIds.includes(playerId)) {
          view.buzzer = { state: 'wrong-locked', message: 'You already tried this clue.' };
        } else {
          view.buzzer = { state: 'ready', message: 'BUZZ IN!' };
        }
      } else if (ac.status === 'buzzed') {
        if (ac.buzzedPlayerId === playerId) {
          view.buzzer = { state: 'mine', message: "You're up! Answer out loud." };
        } else {
          const name = ac.buzzedPlayerId ? (this.getPlayer(ac.buzzedPlayerId) || {}).name : 'Someone';
          view.buzzer = { state: 'locked', message: `${name} buzzed in...` };
        }
      } else if (ac.status === 'paused') {
        view.buzzer = { state: 'disabled', message: 'Get ready...' };
      } else if (ac.status === 'answer-shown') {
        view.buzzer = { state: 'disabled', message: 'Revealing answer...' };
      }
    } else if (s.phase === 'board') {
      view.buzzer = { state: 'disabled', message: 'Waiting for host to open a clue...' };
    } else if (s.phase === 'lobby') {
      view.buzzer = { state: 'disabled', message: 'Waiting for the host to start the game...' };
    } else if (s.phase === 'ended') {
      view.buzzer = { state: 'disabled', message: 'Game over! Thanks for playing.' };
    }

    if (s.finalJeopardy && ['final-wager', 'final-answer', 'final-reveal', 'ended'].includes(s.phase)) {
      const fj = s.finalJeopardy;
      const entry = fj.entries[playerId];
      view.buzzer = { state: 'disabled', message: 'Final Jeopardy!' };
      if (entry) {
        if (s.phase === 'final-wager') {
          view.finalJeopardy = {
            stage: 'wager',
            category: fj.category,
            locked: entry.wager !== null,
            max: Math.max(player.score, 0),
          };
        } else if (s.phase === 'final-answer') {
          view.finalJeopardy = {
            stage: 'answer',
            category: fj.category,
            question: fj.question,
            locked: entry.answer !== null,
            deadline: fj.deadline,
          };
        } else if (s.phase === 'final-reveal' || s.phase === 'ended') {
          view.finalJeopardy = {
            stage: 'reveal',
            category: fj.category,
            question: fj.question,
            answer: fj.answer,
            revealed: entry.revealed,
            wager: entry.wager,
            yourAnswer: entry.answer,
            correct: entry.correct,
          };
        }
      } else {
        view.finalJeopardy = { stage: 'spectating', category: fj.category };
      }
    }

    return view;
  }
}

module.exports = { GameManager, MAX_PLAYERS };
