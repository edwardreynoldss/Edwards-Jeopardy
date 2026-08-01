(function () {
  const socket = io();

  const screens = {
    lobby: document.getElementById('lobby-screen'),
    board: document.getElementById('board-screen'),
    clue: document.getElementById('clue-screen'),
    dd: document.getElementById('dd-splash'),
    final: document.getElementById('final-screen'),
    ended: document.getElementById('ended-screen'),
  };

  const PLAYER_COLORS = ['#ff6b5b', '#4fce62', '#5bb8ff', '#ffcc33'];

  function showOnly(key) {
    for (const [k, el] of Object.entries(screens)) {
      el.style.display = k === key ? 'flex' : 'none';
    }
  }

  socket.on('connect', () => socket.emit('display:hello', {}, () => {}));

  socket.on('network:info', ({ port, addresses }) => {
    const primary = addresses[0];
    const url = primary ? `http://${primary}:${port}/play/` : `http://localhost:${port}/play/`;
    document.getElementById('lobby-qr-img').src = `/api/qr?text=${encodeURIComponent(url)}`;
    document.getElementById('lobby-addr').textContent = url;
  });

  let prevCluekey = null;
  let prevStatus = null;
  let sawDdSplashFor = null;

  socket.on('state', (view) => {
    if (view.role !== 'display') return;
    renderScoreBars(view.players);

    if (view.phase === 'lobby') {
      showOnly('lobby');
      renderLobbyPlayers(view.players);
      return;
    }
    if (view.phase === 'board') {
      showOnly('board');
      renderBoard(view);
      return;
    }
    if (view.phase === 'clue') {
      renderClue(view);
      return;
    }
    if (['final-wager', 'final-answer', 'final-reveal'].includes(view.phase)) {
      showOnly('final');
      renderFinal(view);
      return;
    }
    if (view.phase === 'ended') {
      showOnly('ended');
      renderEnded(view);
      return;
    }
  });

  function renderLobbyPlayers(players) {
    const el = document.getElementById('lobby-players');
    if (players.length === 0) {
      el.innerHTML = '<div style="color:#aab4e6;">No contestants have joined yet…</div>';
      return;
    }
    el.innerHTML = players.map((p, i) => `
      <div class="lobby-player-chip">
        <span class="dot ${p.connected ? 'on' : 'off'}"></span>
        <span style="color:${PLAYER_COLORS[i % 4]}">${escapeHtml(p.name)}</span>
      </div>
    `).join('');
  }

  function renderScoreBars(players) {
    const html = players.map((p, i) => `
      <div class="score-chip ${p.connected ? '' : 'offline'}">
        <div class="name" style="color:${PLAYER_COLORS[i % 4]}">${escapeHtml(p.name)}</div>
        <div class="score ${p.score < 0 ? 'neg' : ''}">${formatMoney(p.score)}</div>
      </div>
    `).join('');
    ['score-bar', 'clue-score-bar', 'final-score-bar'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  function renderBoard(view) {
    document.getElementById('board-title').textContent = view.board.name;
    const grid = document.getElementById('board-grid');
    grid.innerHTML = '';
    for (const cat of view.board.categories) {
      const catEl = document.createElement('div');
      catEl.className = 'board-cat';
      catEl.textContent = cat.name;
      grid.appendChild(catEl);
    }
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      for (const cat of view.board.categories) {
        const clue = cat.clues[r];
        const cell = document.createElement('div');
        cell.className = 'board-cell' + (clue.used ? ' used' : '');
        cell.textContent = clue.used ? '' : `$${clue.value}`;
        grid.appendChild(cell);
      }
    }
  }

  function renderClue(view) {
    const ac = view.activeClue;
    if (!ac) return;
    const clueKey = `${view.currentBoardIndex}`;

    if (ac.isDailyDouble) {
      renderDailyDouble(ac);
      return;
    }

    if (ac.status !== 'answer-shown') {
      showOnly('clue');
    }

    document.getElementById('clue-category').textContent = ac.category;
    document.getElementById('clue-value').textContent = `$${ac.value}`;

    const body = document.getElementById('clue-body');

    if (ac.status === 'answer-shown') {
      showOnly('clue');
      body.innerHTML = `
        <div class="answer-card">
          <div class="label">CORRECT RESPONSE</div>
          <div class="text">${escapeHtml(ac.answer)}</div>
        </div>
      `;
      if (prevStatus !== 'answer-shown') {
        // sound cue handled by host actions elsewhere; keep display quiet here to avoid double-fire
      }
    } else {
      let banner = '';
      if (ac.status === 'buzzed' && ac.buzzedPlayerName) {
        banner = `<div class="clue-buzzed-banner">🔔 ${escapeHtml(ac.buzzedPlayerName)}</div>`;
        if (prevStatus !== 'buzzed') JeopardySounds.buzz();
      }
      body.innerHTML = `<div class="clue-text">${escapeHtml(ac.revealedText || '')}</div>${banner}`;
    }

    prevStatus = ac.status;
  }

  function renderDailyDouble(ac) {
    if (ac.status === 'dd-select-player' || ac.status === 'dd-wager') {
      showOnly('dd');
      const sub = document.getElementById('dd-sub');
      if (ac.status === 'dd-select-player') {
        sub.textContent = 'Host is choosing who wagers…';
      } else {
        sub.textContent = `${ac.wagerPlayerName || 'A contestant'} is placing a wager…`;
      }
      if (sawDdSplashFor !== `${ac.category}-${ac.value}`) {
        JeopardySounds.dailyDouble();
        sawDdSplashFor = `${ac.category}-${ac.value}`;
      }
      return;
    }
    showOnly('clue');
    document.getElementById('clue-category').textContent = ac.category;
    document.getElementById('clue-value').textContent = ac.wager != null ? `Wager: $${ac.wager}` : `$${ac.value}`;
    const body = document.getElementById('clue-body');
    if (ac.status === 'answer-shown') {
      body.innerHTML = `
        <div class="answer-card">
          <div class="label">CORRECT RESPONSE</div>
          <div class="text">${escapeHtml(ac.answer)}</div>
        </div>
      `;
    } else if (ac.status === 'dd-revealed') {
      body.innerHTML = `
        <div>
          <div style="font-family: var(--font-display); color: var(--jp-gold-soft); margin-bottom: 16px; font-size: clamp(18px,2.4vw,28px);">
            ${escapeHtml(ac.wagerPlayerName || '')} wagered ${formatMoney(ac.wager || 0)}
          </div>
          <div class="clue-text">${escapeHtml(ac.question || '')}</div>
        </div>
      `;
    }
  }

  function renderFinal(view) {
    const fj = view.finalJeopardy;
    const body = document.getElementById('final-body');
    if (!fj) { body.innerHTML = ''; return; }

    if (fj.phase === 'final-wager') {
      const waitingCount = Object.values(fj.entries).filter((e) => !e.wagerKnown).length;
      body.innerHTML = `
        <div class="final-category">${escapeHtml(fj.category)}</div>
        <div class="final-question">Contestants are placing their wagers…</div>
        <div style="color:#aab4e6;">${waitingCount} still deciding</div>
      `;
      return;
    }
    if (fj.phase === 'final-answer') {
      body.innerHTML = `
        <div class="final-category">${escapeHtml(fj.category)}</div>
        <div class="final-question">${escapeHtml(fj.question)}</div>
        <div class="final-countdown" id="final-countdown"></div>
      `;
      const el = () => document.getElementById('final-countdown');
      if (window._finalTimer) clearInterval(window._finalTimer);
      const tick = () => {
        const t = el();
        if (!t) return;
        const remaining = Math.max(0, Math.ceil((fj.deadline - Date.now()) / 1000));
        t.textContent = remaining > 0 ? `⏱ ${remaining}` : "Time's up!";
      };
      tick();
      window._finalTimer = setInterval(tick, 250);
      return;
    }
    if (fj.phase === 'final-reveal' || fj.phase === 'ended') {
      const cards = Object.entries(fj.entries).map(([pid, e]) => {
        const player = view.players.find((p) => p.id === pid);
        const name = player ? player.name : '???';
        if (!e.revealed) {
          return `<div class="final-reveal-card"><div class="fname">${escapeHtml(name)}</div><div class="fanswer">🔒 Hidden</div></div>`;
        }
        return `
          <div class="final-reveal-card ${e.correct ? 'correct' : 'incorrect'}">
            <div class="fname">${escapeHtml(name)}</div>
            <div class="fanswer">"${escapeHtml(e.answer || '(no answer)')}"</div>
            <div class="fscore">${e.correct ? '+' : '-'}${formatMoney(e.wager)}</div>
          </div>
        `;
      }).join('');
      body.innerHTML = `
        <div class="final-category">${escapeHtml(fj.category)}</div>
        ${fj.answer ? `<div class="final-question">Correct response: <strong>${escapeHtml(fj.answer)}</strong></div>` : ''}
        <div class="final-reveal-grid">${cards}</div>
      `;
    }
  }

  function renderEnded(view) {
    const sorted = [...view.players].sort((a, b) => b.score - a.score);
    const top = sorted[0] ? sorted[0].score : null;
    document.getElementById('standings').innerHTML = sorted.map((p, i) => `
      <div class="standing-row ${p.score === top && top !== null ? 'winner' : ''}">
        <span>${i + 1}. ${escapeHtml(p.name)}</span>
        <span>${formatMoney(p.score)}</span>
      </div>
    `).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();
