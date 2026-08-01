(function () {
  const socket = io();
  let latestView = null;

  const el = (id) => document.getElementById(id);

  socket.on('connect', () => {
    el('conn-dot').classList.add('on');
    el('conn-dot').classList.remove('off');
    el('conn-label').textContent = 'Connected';
    socket.emit('host:hello', {}, () => {});
  });

  socket.on('disconnect', () => {
    el('conn-dot').classList.add('off');
    el('conn-dot').classList.remove('on');
    el('conn-label').textContent = 'Disconnected';
  });

  socket.on('state', (view) => {
    if (view.role !== 'host') return;
    const prevView = latestView;
    latestView = view;
    render(view, prevView);
  });

  function send(event, payload) {
    return ack(socket, event, payload || {});
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ================= Rendering root =================

  function render(view, prevView) {
    renderTopbar(view);
    renderPlayerPanel(view);

    const phases = ['lobby', 'board', 'clue', 'final', 'ended'];
    const phaseToSection = {
      lobby: 'phase-lobby',
      board: 'phase-board',
      clue: 'phase-clue',
      'final-wager': 'phase-final',
      'final-answer': 'phase-final',
      'final-reveal': 'phase-final',
      ended: 'phase-ended',
    };
    const activeSection = phaseToSection[view.phase] || 'phase-board';
    for (const key of phases) {
      const sec = el(`phase-${key}`);
      if (sec) sec.style.display = `phase-${key}` === activeSection ? 'block' : 'none';
    }

    if (view.phase === 'lobby') renderLobby(view);
    if (view.phase === 'board') renderBoard(view);
    if (view.phase === 'clue') renderCluePanel(view);
    if (['final-wager', 'final-answer', 'final-reveal'].includes(view.phase)) renderFinalPanel(view);
    if (view.phase === 'ended') renderEnded(view);

    // Sound cues on transitions
    if (prevView && prevView.activeClue && view.activeClue) {
      if (prevView.activeClue.status !== 'buzzed' && view.activeClue.status === 'buzzed') {
        JeopardySounds.buzz();
      }
    }
  }

  function renderTopbar(view) {
    const tabs = el('board-tabs');
    tabs.innerHTML = '';
    view.boards.forEach((board, i) => {
      const btn = document.createElement('button');
      btn.className = 'board-tab' + (i === view.currentBoardIndex ? ' active' : '');
      btn.textContent = board.name;
      const disabled = !['lobby', 'board'].includes(view.phase);
      btn.disabled = disabled;
      btn.addEventListener('click', () => send('host:selectBoard', { boardIndex: i }));
      tabs.appendChild(btn);
    });
  }

  // ================= Player side panel =================

  const QUICK_DELTAS = [-500, -100, 100, 500];

  function renderPlayerPanel(view) {
    const container = el('player-list');
    container.innerHTML = '';
    for (const player of view.players) {
      container.appendChild(buildPlayerCard(player));
    }
    for (let i = view.players.length; i < view.maxPlayers; i++) {
      const div = document.createElement('div');
      div.className = 'empty-slot';
      div.textContent = 'Open contestant slot';
      container.appendChild(div);
    }
  }

  function buildPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card';

    const top = document.createElement('div');
    top.className = 'player-card-top';
    top.innerHTML = `
      <span class="player-card-name">
        <span class="dot ${player.connected ? 'on' : 'off'}"></span>
        ${escapeHtml(player.name)}
      </span>
      <span class="player-card-score ${player.score < 0 ? 'neg' : ''}">${formatMoney(player.score)}</span>
    `;
    card.appendChild(top);

    const scoreRow = document.createElement('div');
    scoreRow.className = 'score-btn-row';
    QUICK_DELTAS.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm ' + (d < 0 ? 'btn-red' : 'btn-green');
      b.textContent = (d > 0 ? '+' : '') + d;
      b.addEventListener('click', () => send('host:adjustScore', { playerId: player.id, delta: d }));
      scoreRow.appendChild(b);
    });
    card.appendChild(scoreRow);

    const actions = document.createElement('div');
    actions.className = 'player-card-actions';
    actions.innerHTML = `
      <input type="number" placeholder="Amt" class="custom-amt" />
      <button class="btn btn-ghost btn-sm add-btn">Add</button>
      <button class="btn btn-ghost btn-sm set-btn">Set</button>
    `;
    card.appendChild(actions);
    const amtInput = actions.querySelector('.custom-amt');
    actions.querySelector('.add-btn').addEventListener('click', () => {
      const v = Number(amtInput.value);
      if (Number.isFinite(v) && v !== 0) send('host:adjustScore', { playerId: player.id, delta: v });
      amtInput.value = '';
    });
    actions.querySelector('.set-btn').addEventListener('click', () => {
      const v = Number(amtInput.value);
      if (Number.isFinite(v)) send('host:setScore', { playerId: player.id, score: v });
      amtInput.value = '';
    });

    const bottomActions = document.createElement('div');
    bottomActions.className = 'player-card-actions';
    bottomActions.style.marginTop = '6px';
    bottomActions.innerHTML = `
      <button class="btn btn-ghost btn-sm rename-btn" style="flex:1;">✎ Rename</button>
      <button class="btn btn-red btn-sm remove-btn">🗑</button>
    `;
    card.appendChild(bottomActions);
    bottomActions.querySelector('.rename-btn').addEventListener('click', () => {
      const name = prompt('New name for this contestant:', player.name);
      if (name && name.trim()) send('host:renamePlayer', { playerId: player.id, name: name.trim() });
    });
    bottomActions.querySelector('.remove-btn').addEventListener('click', () => {
      if (confirm(`Remove "${player.name}" from the game? This cannot be undone.`)) {
        send('host:removePlayer', { playerId: player.id });
      }
    });

    return card;
  }

  // ================= Lobby =================

  function renderLobby(view) {
    const list = el('lobby-player-list');
    if (view.players.length === 0) {
      list.innerHTML = '<div style="color:#8892c4;">No contestants have joined yet.</div>';
    } else {
      list.innerHTML = view.players.map((p) => `
        <div class="lobby-chip"><span class="dot ${p.connected ? 'on' : 'off'}"></span>${escapeHtml(p.name)}</div>
      `).join('');
    }
    const startBtn = el('start-game-btn');
    startBtn.disabled = view.players.length === 0;
  }

  el('start-game-btn').addEventListener('click', () => send('host:startGame'));

  el('reset-game-btn').addEventListener('click', () => {
    if (confirm('Reset the game? This clears the board progress. Scores will NOT be reset unless you choose "Full Reset".')) {
      send('host:resetGame', { resetScores: false });
    }
  });

  // ================= Board =================

  function renderBoard(view) {
    const board = view.boards[view.currentBoardIndex];
    el('board-name-label').textContent = board.name;
    const grid = el('host-board-grid');
    grid.innerHTML = '';
    board.categories.forEach((cat) => {
      const c = document.createElement('div');
      c.className = 'host-cat';
      c.textContent = cat.name;
      grid.appendChild(c);
    });
    for (let r = 0; r < 5; r++) {
      board.categories.forEach((cat, ci) => {
        const clue = cat.clues[r];
        const cell = document.createElement('div');
        cell.className = 'host-cell' + (clue.used ? ' used' : '');
        cell.textContent = clue.used ? '✓' : `$${clue.value}`;
        if (!clue.used) {
          cell.addEventListener('click', () => {
            send('host:openClue', { boardIndex: view.currentBoardIndex, categoryIndex: ci, clueIndex: r });
          });
        }
        grid.appendChild(cell);
      });
    }
  }

  el('final-jeopardy-btn').addEventListener('click', () => openFinalStartModal());

  // ================= Clue panel =================

  function highlightedWords(words, revealedCount) {
    return words.map((w, i) => `<span style="color:${i < revealedCount ? '#fff' : 'rgba(255,255,255,0.28)'}">${escapeHtml(w)}</span>`).join(' ');
  }

  function renderCluePanel(view) {
    const ac = view.activeClue;
    const content = el('clue-panel-content');
    if (!ac) { content.innerHTML = ''; return; }

    if (ac.isDailyDouble) {
      content.innerHTML = renderDailyDoubleHost(ac, view);
      wireDailyDoubleHandlers(ac, view);
      return;
    }

    let html = `
      <div class="clue-header-row">
        <div>
          <div style="color:var(--jp-gold-soft); font-weight:700;">${escapeHtml(ac.category)}</div>
          <div style="font-family:var(--font-display); font-size:26px; color:var(--jp-gold);">$${ac.value}</div>
        </div>
      </div>
      <div class="clue-question-box">${highlightedWords(ac.words, ac.revealedCount)}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round((ac.revealedCount / ac.words.length) * 100)}%"></div></div>
    `;

    if (ac.status === 'buzzed') {
      const player = view.players.find((p) => p.id === ac.buzzedPlayerId);
      html += `
        <div class="buzz-banner">
          <span>🔔 ${escapeHtml(player ? player.name : 'Unknown')} buzzed in!</span>
        </div>
        <div class="control-row">
          <button class="btn btn-green" id="judge-correct-btn">✓ Correct (+$${ac.value})</button>
          <button class="btn btn-red" id="judge-wrong-btn">✗ Wrong ${view.settings.deductOnWrong ? `(-$${ac.value})` : ''}</button>
        </div>
      `;
    } else if (ac.status === 'paused') {
      const wrongNames = ac.wrongPlayerIds.map((id) => (view.players.find((p) => p.id === id) || {}).name).filter(Boolean);
      html += `
        ${wrongNames.length ? `<div class="wrong-players-note">Already tried &amp; missed: ${wrongNames.map(escapeHtml).join(', ')}</div>` : ''}
        <div class="control-row">
          <button class="btn btn-gold" id="continue-btn">▶ Continue Reading</button>
          <button class="btn btn-blue" id="reveal-answer-btn">⏭ Reveal Answer (skip)</button>
        </div>
      `;
    } else if (ac.status === 'loading') {
      const wrongNames = ac.wrongPlayerIds.map((id) => (view.players.find((p) => p.id === id) || {}).name).filter(Boolean);
      html += `
        ${wrongNames.length ? `<div class="wrong-players-note">Already tried &amp; missed: ${wrongNames.map(escapeHtml).join(', ')}</div>` : ''}
        <div class="control-row">
          <button class="btn btn-blue" id="reveal-answer-btn">⏭ No One Buzzed / Reveal Answer</button>
        </div>
      `;
    } else if (ac.status === 'answer-shown') {
      html += `
        <div class="answer-box"><strong>Correct response:</strong> ${escapeHtml(ac.answer)}</div>
        <div class="control-row">
          <button class="btn btn-gold" id="close-clue-btn">↩ Back to Board</button>
        </div>
      `;
    }

    content.innerHTML = html;

    const correctBtn = el('judge-correct-btn');
    if (correctBtn) correctBtn.addEventListener('click', () => send('host:judgeClue', { correct: true }));
    const wrongBtn = el('judge-wrong-btn');
    if (wrongBtn) wrongBtn.addEventListener('click', () => send('host:judgeClue', { correct: false }));
    const continueBtn = el('continue-btn');
    if (continueBtn) continueBtn.addEventListener('click', () => send('host:continueClue'));
    const revealBtn = el('reveal-answer-btn');
    if (revealBtn) revealBtn.addEventListener('click', () => send('host:revealAnswer'));
    const closeBtn = el('close-clue-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => send('host:closeClue'));
  }

  function renderDailyDoubleHost(ac, view) {
    let html = `
      <div class="clue-header-row">
        <div>
          <div style="color:var(--jp-gold-soft); font-weight:700;">${escapeHtml(ac.category)} — ⭐ DAILY DOUBLE</div>
          <div style="font-family:var(--font-display); font-size:22px; color:var(--jp-gold);">Base value: $${ac.value}</div>
        </div>
      </div>
    `;

    if (ac.status === 'dd-select-player') {
      const connected = view.players.filter((p) => p.connected);
      html += `
        <p>Choose which contestant will wager:</p>
        <div class="dd-player-choice-grid">
          ${connected.map((p) => `<button class="btn btn-blue dd-choose-btn" data-id="${p.id}">${escapeHtml(p.name)} (${formatMoney(p.score)})</button>`).join('')}
        </div>
        ${connected.length === 0 ? '<p style="color:#ff8f80;">No connected contestants available.</p>' : ''}
      `;
    } else if (ac.status === 'dd-wager') {
      const player = view.players.find((p) => p.id === ac.wagerPlayerId);
      const max = player && player.score >= 1000 ? player.score : 1000;
      html += `
        <p>Waiting for <strong>${escapeHtml(player ? player.name : '?')}</strong> to submit a wager (max ${formatMoney(max)})…</p>
        <div class="control-row">
          <input type="number" id="dd-host-wager-input" placeholder="Wager amount" min="0" max="${max}" style="width:160px;" />
          <button class="btn btn-ghost" id="dd-host-wager-submit">Submit Wager For Them</button>
        </div>
      `;
    } else if (ac.status === 'dd-revealed') {
      const player = view.players.find((p) => p.id === ac.wagerPlayerId);
      html += `
        <p><strong>${escapeHtml(player ? player.name : '?')}</strong> wagered <strong>${formatMoney(ac.wager)}</strong></p>
        <div class="clue-question-box">${escapeHtml(ac.question)}</div>
        <div class="answer-box"><strong>Correct response:</strong> ${escapeHtml(ac.answer)}</div>
        <div class="control-row">
          <button class="btn btn-green" id="dd-judge-correct">✓ Correct (+${formatMoney(ac.wager)})</button>
          <button class="btn btn-red" id="dd-judge-wrong">✗ Wrong (-${formatMoney(ac.wager)})</button>
        </div>
      `;
    } else if (ac.status === 'answer-shown') {
      html += `
        <div class="clue-question-box">${escapeHtml(ac.question)}</div>
        <div class="answer-box"><strong>Correct response:</strong> ${escapeHtml(ac.answer)}</div>
        <div class="control-row">
          <button class="btn btn-gold" id="close-clue-btn">↩ Back to Board</button>
        </div>
      `;
    }
    return html;
  }

  function wireDailyDoubleHandlers(ac, view) {
    document.querySelectorAll('.dd-choose-btn').forEach((btn) => {
      btn.addEventListener('click', () => send('host:setDailyDoubleWagerPlayer', { playerId: btn.dataset.id }));
    });
    const submitBtn = el('dd-host-wager-submit');
    if (submitBtn) submitBtn.addEventListener('click', () => {
      const amount = Number(el('dd-host-wager-input').value);
      send('host:submitWagerForPlayer', { playerId: ac.wagerPlayerId, amount });
    });
    const correctBtn = el('dd-judge-correct');
    if (correctBtn) correctBtn.addEventListener('click', () => send('host:judgeDailyDouble', { correct: true }));
    const wrongBtn = el('dd-judge-wrong');
    if (wrongBtn) wrongBtn.addEventListener('click', () => send('host:judgeDailyDouble', { correct: false }));
    const closeBtn = el('close-clue-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => send('host:closeClue'));
  }

  // ================= Final Jeopardy =================

  function openFinalStartModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header"><h2>Start Final Jeopardy</h2><button class="btn btn-ghost btn-sm" id="fj-cancel">✕</button></div>
        <div class="modal-body">
          <label>Category</label>
          <input type="text" id="fj-category" placeholder="e.g. WORLD CAPITALS" style="width:100%; margin:6px 0 14px;" />
          <label>Clue / Question</label>
          <textarea id="fj-question" style="width:100%; min-height:80px; margin:6px 0 14px;" placeholder="The clue text read to contestants"></textarea>
          <label>Correct Response</label>
          <textarea id="fj-answer" style="width:100%; min-height:60px; margin:6px 0 14px;" placeholder="The correct answer"></textarea>
          <button class="btn btn-gold" id="fj-start-submit" style="width:100%;">Start Final Jeopardy</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#fj-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#fj-start-submit').addEventListener('click', async () => {
      const category = modal.querySelector('#fj-category').value;
      const question = modal.querySelector('#fj-question').value;
      const answer = modal.querySelector('#fj-answer').value;
      const res = await send('host:startFinalJeopardy', { category, question, answer });
      if (res.ok) modal.remove();
    });
  }

  function renderFinalPanel(view) {
    const fj = view.finalJeopardy;
    const content = el('final-panel-content');
    if (!fj) { content.innerHTML = ''; return; }

    if (view.phase === 'final-wager') {
      const rows = Object.entries(fj.entries).map(([pid, e]) => {
        const p = view.players.find((x) => x.id === pid);
        return `<div class="final-player-row"><span>${escapeHtml(p ? p.name : '?')}</span><span>${e.wager !== null ? `Locked: ${formatMoney(e.wager)}` : 'Waiting…'}</span></div>`;
      }).join('');
      content.innerHTML = `
        <h2 class="section-title">Final Jeopardy — ${escapeHtml(fj.category)}</h2>
        <p style="color:#c4cdf5;">${escapeHtml(fj.question)}</p>
        <div style="margin:16px 0;">${rows}</div>
        <button class="btn btn-gold" id="fj-advance-btn">▶ Reveal Question to Contestants</button>
      `;
      el('fj-advance-btn').addEventListener('click', () => send('host:advanceToFinalAnswer'));
    } else if (view.phase === 'final-answer') {
      const rows = Object.entries(fj.entries).map(([pid, e]) => {
        const p = view.players.find((x) => x.id === pid);
        return `<div class="final-player-row"><span>${escapeHtml(p ? p.name : '?')}</span><span>${e.answer !== null ? '✅ Answer locked' : 'Still answering…'}</span></div>`;
      }).join('');
      content.innerHTML = `
        <h2 class="section-title">Final Jeopardy — ${escapeHtml(fj.category)}</h2>
        <div class="clue-question-box">${escapeHtml(fj.question)}</div>
        <div id="fj-host-countdown" style="font-family:var(--font-display); color:var(--jp-gold); font-size:24px; margin-bottom:10px;"></div>
        <div style="margin:16px 0;">${rows}</div>
        <button class="btn btn-gold" id="fj-reveal-btn">⏭ Reveal Answers</button>
      `;
      el('fj-reveal-btn').addEventListener('click', () => send('host:revealFinalAnswers'));
      const cd = el('fj-host-countdown');
      const tick = () => {
        if (!document.body.contains(cd)) return;
        const remaining = Math.max(0, Math.ceil((fj.deadline - Date.now()) / 1000));
        cd.textContent = remaining > 0 ? `⏱ ${remaining}s remaining` : "Time's up!";
        if (remaining > 0) requestAnimationFrame(() => setTimeout(tick, 200));
      };
      tick();
    } else if (view.phase === 'final-reveal') {
      const entries = Object.entries(fj.entries)
        .map(([pid, e]) => ({ pid, e, player: view.players.find((x) => x.id === pid) }))
        .sort((a, b) => (a.e.wager || 0) - (b.e.wager || 0));

      const rows = entries.map(({ pid, e, player }) => {
        if (e.revealed) {
          return `
            <div class="final-player-row">
              <span>${escapeHtml(player ? player.name : '?')} — wagered ${formatMoney(e.wager)}<br/>
                <span class="final-answer-reveal">"${escapeHtml(e.answer || '(no answer)')}"</span>
              </span>
              <span style="color:${e.correct ? 'var(--jp-green)' : 'var(--jp-red)'}; font-weight:800;">
                ${e.correct ? '✓ Correct' : '✗ Wrong'}
              </span>
            </div>
          `;
        }
        return `
          <div class="final-player-row">
            <span>${escapeHtml(player ? player.name : '?')} — wagered ${formatMoney(e.wager)}<br/>
              <span class="final-answer-reveal">"${escapeHtml(e.answer || '(no answer)')}"</span>
            </span>
            <span class="control-row" style="margin:0;">
              <button class="btn btn-green btn-sm fj-judge-correct" data-id="${pid}">✓ Correct</button>
              <button class="btn btn-red btn-sm fj-judge-wrong" data-id="${pid}">✗ Wrong</button>
            </span>
          </div>
        `;
      }).join('');

      const allRevealed = entries.every((x) => x.e.revealed);

      content.innerHTML = `
        <h2 class="section-title">Final Jeopardy — ${escapeHtml(fj.category)}</h2>
        <div class="answer-box"><strong>Correct response:</strong> ${escapeHtml(fj.answer)}</div>
        <div style="margin:16px 0;">${rows}</div>
        <button class="btn btn-gold" id="fj-end-game-btn" ${allRevealed ? '' : 'disabled'}>🏆 End Game &amp; Show Standings</button>
      `;
      content.querySelectorAll('.fj-judge-correct').forEach((btn) => {
        btn.addEventListener('click', () => send('host:judgeFinal', { playerId: btn.dataset.id, correct: true }));
      });
      content.querySelectorAll('.fj-judge-wrong').forEach((btn) => {
        btn.addEventListener('click', () => send('host:judgeFinal', { playerId: btn.dataset.id, correct: false }));
      });
      const endBtn = el('fj-end-game-btn');
      if (endBtn) endBtn.addEventListener('click', () => send('host:endGame'));
    }
  }

  // ================= Ended =================

  function renderEnded(view) {
    const sorted = [...view.players].sort((a, b) => b.score - a.score);
    el('ended-standings').innerHTML = sorted.map((p, i) => `
      <div class="final-player-row"><span>${i + 1}. ${escapeHtml(p.name)}</span><span style="font-family:var(--font-display); color:var(--jp-gold);">${formatMoney(p.score)}</span></div>
    `).join('');
  }

  el('new-game-btn').addEventListener('click', async () => {
    if (!confirm('Start a brand new game? This resets scores, the board, and re-shuffles Daily Doubles.')) return;
    await send('host:resetGame', { resetScores: true });
    await send('host:randomizeDailyDouble', { boardIndex: 0 });
    await send('host:randomizeDailyDouble', { boardIndex: 1 });
  });

  // ================= Editor modal =================

  el('open-editor-btn').addEventListener('click', () => {
    if (!latestView) return;
    renderEditor(latestView);
    el('editor-modal').style.display = 'flex';
  });
  el('close-editor-btn').addEventListener('click', () => { el('editor-modal').style.display = 'none'; });

  let editorActiveBoard = 0;

  function renderEditor(view) {
    const body = el('editor-body');
    const board = view.boards[editorActiveBoard];

    let html = `
      <div class="editor-board-tabs">
        ${view.boards.map((b, i) => `<button class="board-tab editor-board-tab ${i === editorActiveBoard ? 'active' : ''}" data-idx="${i}">${escapeHtml(b.name)}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" id="editor-randomize-dd" style="margin-left:auto;">🎲 Randomize Daily Double</button>
      </div>
      <label>Board name</label>
      <input type="text" id="editor-board-name" value="${escapeHtml(board.name)}" style="width:100%; margin:6px 0 16px;" />
    `;

    board.categories.forEach((cat, ci) => {
      html += `<div class="editor-category-block" data-ci="${ci}">
        <input type="text" class="cat-name-input" value="${escapeHtml(cat.name)}" />
        <div class="editor-clue-rows">
          ${cat.clues.map((clue, vi) => `
            <div class="editor-clue-row" data-vi="${vi}">
              <input type="number" class="clue-value-input" value="${clue.value}" />
              <textarea class="clue-question-input" placeholder="Clue text">${escapeHtml(clue.question)}</textarea>
              <textarea class="clue-answer-input" placeholder="Correct answer">${escapeHtml(clue.answer)}</textarea>
              <div class="dd-toggle">
                <button class="btn btn-sm ${clue.dailyDouble ? 'btn-gold' : 'btn-ghost'} dd-toggle-btn">⭐ DD</button>
                ${clue.used ? '<span style="color:#7f8bb8;">used</span>' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    });

    body.innerHTML = html;

    body.querySelectorAll('.editor-board-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        editorActiveBoard = Number(tab.dataset.idx);
        renderEditor(latestView);
      });
    });

    el('editor-randomize-dd').addEventListener('click', () => send('host:randomizeDailyDouble', { boardIndex: editorActiveBoard }));

    const boardNameInput = el('editor-board-name');
    boardNameInput.addEventListener('blur', () => send('host:updateBoardMeta', { boardIndex: editorActiveBoard, name: boardNameInput.value }));

    body.querySelectorAll('.editor-category-block').forEach((block) => {
      const ci = Number(block.dataset.ci);
      const nameInput = block.querySelector('.cat-name-input');
      nameInput.addEventListener('blur', () => send('host:updateCategory', { boardIndex: editorActiveBoard, categoryIndex: ci, name: nameInput.value }));

      block.querySelectorAll('.editor-clue-row').forEach((row) => {
        const vi = Number(row.dataset.vi);
        const valueInput = row.querySelector('.clue-value-input');
        const questionInput = row.querySelector('.clue-question-input');
        const answerInput = row.querySelector('.clue-answer-input');
        const ddBtn = row.querySelector('.dd-toggle-btn');

        function pushUpdate() {
          send('host:updateClue', {
            boardIndex: editorActiveBoard,
            categoryIndex: ci,
            clueIndex: vi,
            value: Number(valueInput.value),
            question: questionInput.value,
            answer: answerInput.value,
          });
        }
        valueInput.addEventListener('blur', pushUpdate);
        questionInput.addEventListener('blur', pushUpdate);
        answerInput.addEventListener('blur', pushUpdate);
        ddBtn.addEventListener('click', () => {
          send('host:toggleDailyDouble', { boardIndex: editorActiveBoard, categoryIndex: ci, clueIndex: vi });
          ddBtn.classList.toggle('btn-gold');
          ddBtn.classList.toggle('btn-ghost');
          block.querySelectorAll('.dd-toggle-btn').forEach((otherBtn) => {
            if (otherBtn !== ddBtn) {
              otherBtn.classList.remove('btn-gold');
              otherBtn.classList.add('btn-ghost');
            }
          });
        });
      });
    });
  }

  // ================= Settings modal =================

  el('open-settings-btn').addEventListener('click', () => {
    if (!latestView) return;
    renderSettings(latestView);
    el('settings-modal').style.display = 'flex';
  });
  el('close-settings-btn').addEventListener('click', () => { el('settings-modal').style.display = 'none'; });

  function renderSettings(view) {
    const body = el('settings-body');
    body.innerHTML = `
      <div class="settings-row">
        <span>Deduct points on wrong answers</span>
        <label class="toggle-switch">
          <input type="checkbox" id="setting-deduct" ${view.settings.deductOnWrong ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-row">
        <span>Word reveal speed (ms/word)</span>
        <input type="number" id="setting-speed" value="${view.settings.wordIntervalMs}" style="width:90px;" min="150" max="3000" step="50" />
      </div>
      <div class="settings-row">
        <span>Final Jeopardy answer time (seconds)</span>
        <input type="number" id="setting-final-time" value="${view.settings.finalAnswerSeconds}" style="width:90px;" min="10" max="180" />
      </div>
    `;
    el('setting-deduct').addEventListener('change', (e) => send('host:updateSettings', { deductOnWrong: e.target.checked }));
    el('setting-speed').addEventListener('change', (e) => send('host:updateSettings', { wordIntervalMs: Number(e.target.value) }));
    el('setting-final-time').addEventListener('change', (e) => send('host:updateSettings', { finalAnswerSeconds: Number(e.target.value) }));
  }
})();
