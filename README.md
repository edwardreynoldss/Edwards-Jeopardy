# Jeopardy! — Local Party Game

A self-hosted, LAN-based Jeopardy game. One computer runs the server; everyone else
(a host, a TV/display, and up to 4 contestants) joins from a browser over your local
network. No internet connection is required once the app is installed — everything,
including the join QR code and sound effects, is generated locally.

## Features

- **Host console** — start the game, open clues, judge answers, adjust/edit/remove
  contestant scores, and fully edit both boards (categories, clue text, answers,
  dollar values, and which clue is the Daily Double).
- **Two boards** — a normal round and a "Double Jeopardy" round (values doubled by
  default), fully customizable from the in-app Board Editor.
- **Daily Double** — one clue per board (randomized automatically, or set manually
  in the editor). The host picks who wagers; that player can bet any amount, or up
  to $1000 if their score is below $1000 (even into negative territory).
- **Word-by-word clue reveal** — clues "type out" on the TV/host screen. Buzzing
  unlocks the instant a clue opens. The first buzz pauses the reveal; if the host
  marks the answer wrong, the reader resumes exactly where it left off and other
  contestants may buzz in again (the player who missed is locked out of that clue).
- **TV / Display view** — a full board + running scoreboard meant for a shared
  screen (cast/share this browser tab to your TV). Shows a lobby screen with a
  join QR code before the game starts, animated Daily Double splash, and an
  answer reveal card.
- **Contestant view** — minimal by design: the player's name + a giant buzzer that
  is grayed out until a clue is open. Handles Daily Double wagering and Final
  Jeopardy wagering/answers via full-screen prompts when it's that player's turn.
- **Persistent sessions** — closing the browser (or the whole game tab) does not
  lose a contestant's score. Reopening `/play/` automatically rejoins them, or, on
  a new device/browser, they can pick which existing contestant they are from a
  list. The server keeps the game running in the background regardless of who is
  connected, and periodically saves game state to disk so a server restart doesn't
  wipe scores or board progress.
- **Final Jeopardy** (bonus round) — trigger any time from the board screen: all
  connected contestants wager secretly, see the clue with a countdown, lock in an
  answer, and the host reveals/judges each contestant (lowest wager first, like the
  real show).
- **Score deduction toggle, adjustable reveal speed, and answer-time limit** are all
  configurable from the host Settings panel.
- **Synthesized sound effects** (buzz, correct/wrong dings, Daily Double sting) —
  generated in-browser, no audio files or internet needed.

## Requirements

- Node.js 18+ (uses `crypto.randomUUID`-style APIs and modern `express`).

## Setup

```bash
cd jeopardy
npm install
npm start
```

The server prints the URLs to use, for example:

```
Local:   http://localhost:3000
Network: http://192.168.1.42:3000
```

Open `http://localhost:3000` on the host's computer. From there:

- Click **Host** on the machine the game runner will use.
- Click **TV Display** on whichever screen/device should show the board (a laptop
  you screen-share to a TV works great — just pick that browser tab/window when
  sharing your screen).
- Contestants open `http://<network-ip>:3000/play/` on their phone/laptop (scan the
  QR code shown on the landing page or the TV lobby screen), pick a name, and get
  their buzzer.

All devices must be on the same local network (Wi-Fi/LAN) as the host machine.

## Customizing the boards

From the Host console, click **📝 Editor** at any time (before or during a game) to
rename each board, rename categories, edit clue text/answers/dollar values, and
toggle which clue is the Daily Double for each board. Click **🎲 Randomize Daily
Double** to have the game pick a random clue for you instead.

## Game flow at a glance

1. Contestants join from `/play/` and pick a name (up to 4).
2. Host clicks **Start Game** from the Lobby.
3. Host clicks a dollar value on the board to open that clue.
   - Normal clue: the text reveals word-by-word on the TV/host screen. Any
     contestant may buzz in while it's revealing. The host marks the buzzed-in
     contestant **Correct** (awards points, shows the answer) or **Wrong**
     (deducts points if enabled, locks that contestant out of the clue, and lets
     the host **Continue** the reveal for everyone else). The host can also skip
     straight to the answer if nobody buzzes.
   - Daily Double: the host picks which contestant wagers, that contestant enters
     their wager on their own device, then the full clue is shown and the host
     judges Correct/Wrong to award/deduct the wager.
4. After both boards, the host can start **Final Jeopardy** from the board screen.
5. At the end, click **End Game** to show final standings, or **Start a New Game**
   to reset scores/board and play again.

## Data & persistence

Game state (contestant names/scores/tokens, board content, and settings) is saved
to `jeopardy/data/state.json` a few hundred milliseconds after each change, and
immediately on shutdown (Ctrl+C). If the server restarts mid-clue, it safely
resumes at the board screen rather than trying to restore an in-progress clue.
