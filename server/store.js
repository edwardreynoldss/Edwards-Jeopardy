'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[store] Failed to read/parse state file, starting fresh:', err.message);
    return null;
  }
}

let writeTimer = null;
let pendingData = null;

function saveStateDebounced(getSerializable, delayMs = 400) {
  pendingData = getSerializable;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const data = pendingData;
    pendingData = null;
    try {
      ensureDataDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify(data(), null, 2), 'utf-8');
    } catch (err) {
      console.error('[store] Failed to save state:', err.message);
    }
  }, delayMs);
}

function saveStateNow(getSerializable) {
  ensureDataDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(getSerializable(), null, 2), 'utf-8');
  } catch (err) {
    console.error('[store] Failed to save state:', err.message);
  }
}

module.exports = { loadState, saveStateDebounced, saveStateNow, STATE_FILE };
