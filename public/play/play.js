(function () {
  const socket = io();
  const TOKEN_KEY = 'jeopardy_token';

  const joinScreen = document.getElementById('join-screen');
  const gameScreen = document.getElementById('game-screen');
  const existingPlayersEl = document.getElementById('existing-players');
  const newPlayerBlock = document.getElementById('new-player-block');
  const fullMessage = document.getElementById('full-message');
  const nameInput = document.getElementById('name-input');
  const joinBtn = document.getElementById('join-btn');

  const playerNameEl = document.getElementById('player-name');
  const playerScoreEl = document.getElementById('player-score');
  const buzzBtn = document.getElementById('buzz-btn');
  const buzzLabel = document.getElementById('buzz-label');
  const footerMsg = document.getElementById('footer-msg');
  const overlay = document.getElementById('overlay');
  const overlayContent = document.getElementById('overlay-content');

  let joined = false;
  let currentBuzzerState = 'disabled';
  let latestPlayers = [];
  let countdownTimer = null;

  function unlockAudioOnce() {
    JeopardySounds.unlock();
    window.removeEventListener('touchstart', unlockAudioOnce);
    window.removeEventListener('click', unlockAudioOnce);
  }
  window.addEventListener('touchstart', unlockAudioOnce, { once: true });
  window.addEventListener('click', unlockAudioOnce, { once: true });

  function showJoinScreen() {
    joined = false;
    joinScreen.style.display = 'flex';
    gameScreen.style.display = 'none';
    renderExistingPlayers();
  }

  function showGameScreen() {
    joined = true;
    joinScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
  }

  function renderExistingPlayers() {
    existingPlayersEl.innerHTML = '';
    if (latestPlayers.length > 0) {
      const heading = document.createElement('div');
      heading.style.cssText = 'font-weight:700; color: var(--jp-gold-soft); margin-bottom: 4px; text-align:left;';
      heading.textContent = 'Rejoin as a contestant already in the game:';
      existingPlayersEl.appendChild(heading);
    }
    for (const p of latestPlayers) {
      const row = document.createElement('div');
      row.className = 'existing-player-row';
      const nameWrap = document.createElement('div');
      nameWrap.className = 'name';
      nameWrap.innerHTML = `<span class="dot ${p.connected ? 'on' : 'off'}"></span> ${escapeHtml(p.name)}`;
      const btn = document.createElement('button');
      btn.className = 'btn btn-blue btn-sm';
      btn.textContent = p.connected ? 'Take over' : 'Rejoin';
      btn.addEventListener('click', async () => {
        if (p.connected) {
          const sure = confirm(`"${p.name}" appears to be connected on another device. Take over as this player?`);
          if (!sure) return;
        }
        const res = await ack(socket, 'player:claim', { playerId: p.id });
        if (res.ok) {
          localStorage.setItem(TOKEN_KEY, res.token);
          showGameScreen();
        }
      });
      row.appendChild(nameWrap);
      row.appendChild(btn);
      existingPlayersEl.appendChild(row);
    }
    const full = latestPlayers.length >= 4;
    newPlayerBlock.style.display = full ? 'none' : 'block';
    fullMessage.style.display = full ? 'block' : 'none';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  async function doJoin() {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Please enter a name.');
      return;
    }
    const res = await ack(socket, 'player:join', { name });
    if (res.ok) {
      localStorage.setItem(TOKEN_KEY, res.token);
      showGameScreen();
    }
  }

  socket.on('connect', () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      ack(socket, 'player:reconnect', { token }).then((res) => {
        if (res.ok) {
          showGameScreen();
        } else {
          localStorage.removeItem(TOKEN_KEY);
          showJoinScreen();
        }
      });
    } else {
      showJoinScreen();
    }
  });

  socket.on('lobby:players', (players) => {
    latestPlayers = players;
    if (!joined) renderExistingPlayers();
  });

  socket.on('player:kicked', ({ reason }) => {
    localStorage.removeItem(TOKEN_KEY);
    showToast(reason || 'Disconnected.', true);
    showJoinScreen();
  });

  socket.on('state', (view) => {
    if (view.role !== 'player') return;
    renderPlayerView(view);
  });

  function setBuzzerVisual(state, message) {
    if (state !== currentBuzzerState) {
      buzzBtn.classList.remove('ready', 'mine', 'locked', 'wrong-locked', 'disabled');
      buzzBtn.classList.add(state);
      if (state === 'ready') {
        JeopardySounds.tick();
      }
      currentBuzzerState = state;
    }
    buzzBtn.disabled = state !== 'ready';
    buzzLabel.textContent = state === 'ready' ? 'BUZZ IN!' : state === 'mine' ? "YOU'RE UP!" : (message || '').toUpperCase();
    footerMsg.textContent = state === 'ready' || state === 'mine' ? '' : (message || '');
  }

  let hasBuzzedThisClue = false;
  buzzBtn.addEventListener('click', () => {
    if (buzzBtn.disabled) return;
    JeopardySounds.buzz();
    if (navigator.vibrate) navigator.vibrate(80);
    buzzBtn.disabled = true;
    ack(socket, 'player:buzz', {});
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !buzzBtn.disabled) {
      e.preventDefault();
      buzzBtn.click();
    }
  });

  function renderPlayerView(view) {
    playerNameEl.textContent = view.me.name;
    playerScoreEl.textContent = formatMoney(view.me.score);
    playerScoreEl.style.color = view.me.score < 0 ? '#ff8f80' : '';

    setBuzzerVisual(view.buzzer.state, view.buzzer.message);

    if (view.dailyDouble && view.dailyDouble.youAreWagering) {
      renderDailyDoubleWagerOverlay(view.dailyDouble.max);
    } else if (view.finalJeopardy) {
      renderFinalOverlay(view.finalJeopardy);
    } else {
      hideOverlay();
    }
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    overlayContent.innerHTML = '';
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function quickWagerButtonsHtml(max) {
    const options = Array.from(new Set([
      0,
      Math.round(max * 0.25),
      Math.round(max * 0.5),
      max,
    ])).filter((v) => v >= 0 && v <= max);
    return options.map((v) => `<button class="btn btn-ghost btn-sm quick-wager" data-val="${v}">${formatMoney(v)}</button>`).join('');
  }

  function renderDailyDoubleWagerOverlay(max) {
    overlay.style.display = 'flex';
    overlayContent.innerHTML = `
      <h2>DAILY DOUBLE!</h2>
      <p>You control the wager. You can bet up to <strong>${formatMoney(max)}</strong>.</p>
      <input type="number" id="dd-wager-input" min="0" max="${max}" value="0" />
      <div class="wager-quick-buttons">${quickWagerButtonsHtml(max)}</div>
      <button class="btn btn-gold" id="dd-wager-submit" style="width:100%; margin-top:6px;">Lock In Wager</button>
    `;
    const input = document.getElementById('dd-wager-input');
    overlayContent.querySelectorAll('.quick-wager').forEach((btn) => {
      btn.addEventListener('click', () => { input.value = btn.dataset.val; });
    });
    document.getElementById('dd-wager-submit').addEventListener('click', async () => {
      const amount = Number(input.value);
      const res = await ack(socket, 'player:submitDailyDoubleWager', { amount });
      if (res.ok) JeopardySounds.dailyDouble();
    });
  }

  function renderFinalOverlay(fj) {
    if (fj.stage === 'spectating') {
      overlay.style.display = 'flex';
      overlayContent.innerHTML = `<h2>FINAL JEOPARDY!</h2><p>Category: <strong>${escapeHtml(fj.category)}</strong></p><p>Watch the TV screen!</p>`;
      return;
    }
    if (fj.stage === 'wager') {
      if (fj.locked) {
        overlay.style.display = 'flex';
        overlayContent.innerHTML = `<h2>FINAL JEOPARDY!</h2><p>Category: <strong>${escapeHtml(fj.category)}</strong></p><p>Wager locked in. Waiting for other contestants…</p>`;
        return;
      }
      overlay.style.display = 'flex';
      overlayContent.innerHTML = `
        <h2>FINAL JEOPARDY!</h2>
        <p>Category: <strong>${escapeHtml(fj.category)}</strong></p>
        <p>Place your wager (0 – ${formatMoney(fj.max)}):</p>
        <input type="number" id="fj-wager-input" min="0" max="${fj.max}" value="0" />
        <div class="wager-quick-buttons">${quickWagerButtonsHtml(fj.max)}</div>
        <button class="btn btn-gold" id="fj-wager-submit" style="width:100%; margin-top:6px;">Lock In Wager</button>
      `;
      const input = document.getElementById('fj-wager-input');
      overlayContent.querySelectorAll('.quick-wager').forEach((btn) => {
        btn.addEventListener('click', () => { input.value = btn.dataset.val; });
      });
      document.getElementById('fj-wager-submit').addEventListener('click', async () => {
        await ack(socket, 'player:submitFinalWager', { amount: Number(input.value) });
      });
      return;
    }
    if (fj.stage === 'answer') {
      overlay.style.display = 'flex';
      if (fj.locked) {
        overlayContent.innerHTML = `<h2>FINAL JEOPARDY!</h2><p><em>${escapeHtml(fj.question)}</em></p><p>Answer locked in. Waiting for other contestants…</p>`;
        return;
      }
      overlayContent.innerHTML = `
        <h2>FINAL JEOPARDY!</h2>
        <p><em>${escapeHtml(fj.question)}</em></p>
        <input type="text" id="fj-answer-input" placeholder="Your answer" maxlength="200" />
        <div id="fj-countdown" style="font-weight:800; color: var(--jp-gold); margin: 6px 0;"></div>
        <button class="btn btn-gold" id="fj-answer-submit" style="width:100%; margin-top:6px;">Lock In Answer</button>
      `;
      document.getElementById('fj-answer-submit').addEventListener('click', async () => {
        const text = document.getElementById('fj-answer-input').value;
        await ack(socket, 'player:submitFinalAnswer', { text });
      });
      startCountdown(fj.deadline);
      return;
    }
    if (fj.stage === 'reveal') {
      overlay.style.display = 'flex';
      if (!fj.revealed) {
        overlayContent.innerHTML = `<h2>FINAL JEOPARDY!</h2><p>Your wager: <strong>${formatMoney(fj.wager)}</strong></p><p>Your answer: <em>${escapeHtml(fj.yourAnswer || '(no answer)')}</em></p><p>Waiting for the host to reveal results…</p>`;
      } else {
        overlayContent.innerHTML = `
          <h2>${fj.correct ? '✅ CORRECT!' : '❌ INCORRECT'}</h2>
          <p>Your wager: <strong>${formatMoney(fj.wager)}</strong></p>
          <p>Your answer: <em>${escapeHtml(fj.yourAnswer || '(no answer)')}</em></p>
          <p>Correct response: <strong>${escapeHtml(fj.answer)}</strong></p>
        `;
      }
    }
  }

  function startCountdown(deadline) {
    if (countdownTimer) clearInterval(countdownTimer);
    const el = () => document.getElementById('fj-countdown');
    function tick() {
      const target = el();
      if (!target) { clearInterval(countdownTimer); countdownTimer = null; return; }
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      target.textContent = remaining > 0 ? `⏱ ${remaining}s remaining` : "Time's up!";
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
    tick();
    countdownTimer = setInterval(tick, 250);
  }
})();
