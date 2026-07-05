// Initialize Socket.io client
const socket = io();

// Local multiplayer game state
let state = {
  roomId: null,
  username: '',
  opponentName: '',
  category: '',
  hintsCount: 5,
  revealedHints: [],
  scores: {},
  hasGuessedWrongThisHint: false,
  timerInterval: null,
  mode: 'duo'
};

// DOM references - Views
const setupView = document.getElementById('setup-view');
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');

// DOM references - Tabs & Forms
const tabCreate = document.getElementById('tab-create');
const tabJoin = document.getElementById('tab-join');
const createForm = document.getElementById('create-room-form');
const joinForm = document.getElementById('join-room-form');

// DOM references - Lobby
const lobbyRoomId = document.getElementById('lobby-room-id');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const lobbyInfoText = document.getElementById('lobby-info-text');

// DOM references - Game Header & Scoreboard
const displayCategory = document.getElementById('display-category');
const displayRoomCode = document.getElementById('display-room-code');
const displayProgress = document.getElementById('display-progress');
const scoresDisplay = document.getElementById('scores-display');

// DOM references - Game Body
const timerBar = document.getElementById('timer-bar');
const hintsList = document.getElementById('hints-list');
const actionPrompt = document.getElementById('action-prompt');
const buzzBtn = document.getElementById('buzz-btn');
const guessForm = document.getElementById('guess-form');
const guessInput = document.getElementById('guess-input');
const feedbackLog = document.getElementById('feedback-log');
const consoleCard = document.querySelector('.console-card');

// DOM references - Modals & Loader
const loadingOverlay = document.getElementById('loading-overlay');
const resultOverlay = document.getElementById('result-overlay');
const resultTitle = document.getElementById('result-title');
const resultAnswer = document.getElementById('result-answer');
const resultExplanation = document.getElementById('result-explanation');
const statHints = document.getElementById('stat-hints');
const restartBtn = document.getElementById('restart-btn');

// --- Tab Navigation Setup ---
tabCreate.addEventListener('click', () => {
  tabCreate.classList.add('active');
  tabJoin.classList.remove('active');
  createForm.classList.remove('hidden');
  joinForm.classList.add('hidden');
});

tabJoin.addEventListener('click', () => {
  tabJoin.classList.add('active');
  tabCreate.classList.remove('active');
  joinForm.classList.remove('hidden');
  createForm.classList.add('hidden');
});

// --- Loader Helper ---
function showLoading(show, message = '') {
  const loadingText = loadingOverlay.querySelector('.loading-text');
  loadingText.textContent = message;
  if (show) {
    loadingOverlay.classList.remove('hidden');
  } else {
    loadingOverlay.classList.add('hidden');
  }
}

// --- Render Helpers ---
function renderPlayersLobby(players) {
  lobbyPlayersList.innerHTML = '';
  players.forEach((p) => {
    const div = document.createElement('div');
    div.className = `player-tag ${p.socketId === socket.id ? 'self' : ''}`;
    div.textContent = p.username;
    lobbyPlayersList.appendChild(div);
  });
}

function renderScoreboard(players) {
  scoresDisplay.innerHTML = '';
  players.forEach((p) => {
    const div = document.createElement('div');
    div.className = `player-score-card ${p.username === state.username ? 'active' : ''}`;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-score-name';
    nameSpan.textContent = p.username;
    
    const numSpan = document.createElement('span');
    numSpan.className = 'player-score-num';
    numSpan.textContent = p.score;
    
    div.appendChild(nameSpan);
    div.appendChild(numSpan);
    scoresDisplay.appendChild(div);
  });
}

function addHintCard(hintText, index) {
  const card = document.createElement('div');
  card.className = 'hint-card';
  
  const badge = document.createElement('div');
  badge.className = 'hint-badge';
  badge.textContent = index + 1;
  
  const text = document.createElement('div');
  text.className = 'hint-text';
  text.textContent = hintText;
  
  card.appendChild(badge);
  card.appendChild(text);
  hintsList.appendChild(card);
  hintsList.scrollTop = hintsList.scrollHeight;
}

function addFeedbackItem(username, guess, explanation, correct = false) {
  const item = document.createElement('div');
  item.className = 'feedback-item';
  if (correct) {
    item.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
    item.style.borderColor = 'rgba(16, 185, 129, 0.15)';
  }
  
  const title = document.createElement('span');
  title.className = 'feedback-guess';
  title.style.color = correct ? 'var(--success-color)' : 'var(--error-color)';
  title.textContent = `${correct ? '✅' : '❌'} ${username}: "${guess}"`;
  
  const desc = document.createElement('span');
  desc.className = 'feedback-explanation';
  desc.textContent = explanation;
  
  item.appendChild(title);
  item.appendChild(desc);
  
  feedbackLog.prepend(item);
}

function animateTimer(duration) {
  if (state.timerInterval) clearInterval(state.timerInterval);
  
  const start = Date.now();
  timerBar.style.transform = 'scaleX(1)';
  
  state.timerInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const remainingRatio = Math.max(0, 1 - elapsed / duration);
    timerBar.style.transform = `scaleX(${remainingRatio})`;
    
    if (remainingRatio <= 0) {
      clearInterval(state.timerInterval);
    }
  }, 100);
}

function shakeConsole() {
  consoleCard.classList.remove('shake');
  void consoleCard.offsetWidth;
  consoleCard.classList.add('shake');
}

function resetBuzzerBtnState() {
  if (state.mode === 'solo') {
    updateActionCenter('solo');
    return;
  }

  buzzBtn.className = 'buzz-btn';
  buzzBtn.disabled = state.hasGuessedWrongThisHint;
  actionPrompt.textContent = state.hasGuessedWrongThisHint
    ? 'Locked out: You guessed wrong on this hint!'
    : 'Buzz fast to answer!';
  guessForm.classList.add('hidden');
}

function updateActionCenter(mode = 'duo') {
  if (mode === 'solo') {
    buzzBtn.classList.add('hidden');
    guessForm.classList.remove('hidden');
    actionPrompt.textContent = 'Answer anytime. Fewer hints used means more points!';
    guessInput.focus();
  } else {
    buzzBtn.classList.remove('hidden');
    guessForm.classList.add('hidden');
    resetBuzzerBtnState();
  }
}

// --- Outbound Forms ---
createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('create-username').value.trim();
  const category = document.getElementById('category-select').value;
  const hintsCountInput = document.querySelector('input[name="hints-count"]:checked');
  const hintsCount = parseInt(hintsCountInput.value, 10);
  const difficultyInput = document.querySelector('input[name="difficulty"]:checked');
  const difficulty = difficultyInput ? difficultyInput.value : 'Medium';
  const playModeInput = document.querySelector('input[name="play-mode"]:checked');
  const mode = playModeInput ? playModeInput.value : 'solo';
  const demoMode = document.getElementById('demo-mode-checkbox').checked;
  
  state.username = username;
  socket.emit('createRoom', { username, category, hintsCount, difficulty, demoMode, mode });
});

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('join-username').value.trim();
  const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
  
  state.username = username;
  socket.emit('joinRoom', { username, roomId: roomCode });
});

// --- Buzz Action ---
buzzBtn.addEventListener('click', () => {
  if (!state.roomId) return;
  socket.emit('buzz', { roomId: state.roomId });
});

// --- Answering Action ---
guessForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const guess = guessInput.value.trim();
  if (!guess || !state.roomId) return;
  
  showLoading(true, 'Gemini is evaluating your answer...');
  socket.emit('submitAnswer', { roomId: state.roomId, guess });
  guessInput.value = '';
});

// --- Restart / Play Again ---
restartBtn.addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  gameView.classList.add('hidden');
  setupView.classList.remove('hidden');
  setupView.className = 'card fade-in';
  
  // Clean states
  if (state.timerInterval) clearInterval(state.timerInterval);
  state = {
    roomId: null,
    username: '',
    opponentName: '',
    category: '',
    hintsCount: 5,
    revealedHints: [],
    scores: {},
    hasGuessedWrongThisHint: false,
    timerInterval: null,
    mode: 'duo'
  };
});

// --- Socket Inbound Events ---

socket.on('roomCreated', ({ roomId, mode }) => {
  state.roomId = roomId;
  state.mode = mode || 'duo';
  setupView.classList.add('hidden');
  lobbyView.classList.remove('hidden');
  lobbyRoomId.textContent = roomId;
  lobbyInfoText.textContent = mode === 'solo'
    ? 'Solo mode is active. The game will start immediately with a single player.'
    : 'Share the room code above with another player. Once they join, the game will automatically start!';
  renderPlayersLobby([{ socketId: socket.id, username: state.username }]);
});

socket.on('roomJoined', ({ roomId, players, mode }) => {
  state.roomId = roomId;
  state.mode = mode || 'duo';
  setupView.classList.add('hidden');
  lobbyView.classList.remove('hidden');
  lobbyRoomId.textContent = roomId;
  lobbyInfoText.textContent = mode === 'solo'
    ? 'Solo mode is active. The game will start immediately with a single player.'
    : 'Share the room code above with another player. Once they join, the game will automatically start!';
  renderPlayersLobby(players);
});

socket.on('playerJoined', ({ players }) => {
  renderPlayersLobby(players);
});

socket.on('loadingGame', ({ message }) => {
  showLoading(true, message);
});

socket.on('startGame', ({ category, totalHints, firstHint, players, mode }) => {
  showLoading(false);
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  gameView.className = 'fade-in';
  
  state.category = category;
  state.hintsCount = totalHints;
  state.revealedHints = [firstHint];
  state.hasGuessedWrongThisHint = false;
  state.mode = mode || 'duo';

  displayCategory.textContent = category;
  displayRoomCode.textContent = state.roomId;
  displayProgress.textContent = `1 / ${totalHints}`;
  
  hintsList.innerHTML = '';
  feedbackLog.innerHTML = '';
  guessInput.value = '';
  
  addHintCard(firstHint, 0);
  renderScoreboard(players);
  updateActionCenter(mode || 'duo');
});

socket.on('timerUpdate', ({ duration }) => {
  animateTimer(duration);
});

socket.on('buzzLocked', ({ buzzedBy, username, duration }) => {
  // Clear any existing countdown
  if (state.timerInterval) clearInterval(state.timerInterval);
  animateTimer(duration);

  if (buzzedBy === socket.id) {
    buzzBtn.className = 'buzz-btn locked-self';
    buzzBtn.disabled = true;
    actionPrompt.textContent = 'YOU BUZZED! Submitting answer...';
    guessForm.classList.remove('hidden');
    guessInput.focus();
  } else {
    buzzBtn.className = 'buzz-btn locked-other';
    buzzBtn.disabled = true;
    actionPrompt.textContent = `${username} is answering...`;
    guessForm.classList.add('hidden');
  }
});

socket.on('buzzerUnlocked', () => {
  resetBuzzerBtnState();
});

socket.on('answerResult', ({ correct, buzzedBy, username, explanation }) => {
  showLoading(false);
  
  if (correct) {
    addFeedbackItem(username, 'CORRECT ANSWER', explanation, true);
  } else {
    addFeedbackItem(username, 'WRONG ANSWER', explanation, false);
    if (buzzedBy === socket.id) {
      state.hasGuessedWrongThisHint = true;
      shakeConsole();
    }
    resetBuzzerBtnState();
  }
});

socket.on('nextHint', ({ hintText, currentHintIndex, totalHints, hasMore }) => {
  state.revealedHints.push(hintText);
  state.hasGuessedWrongThisHint = false;
  
  displayProgress.textContent = `${currentHintIndex + 1} / ${totalHints}`;
  addHintCard(hintText, currentHintIndex);
  if (state.mode === 'solo') {
    updateActionCenter('solo');
  } else {
    resetBuzzerBtnState();
  }
});

socket.on('scoreUpdate', ({ players, scoredPlayer, points }) => {
  renderScoreboard(players);
  
  if (scoredPlayer) {
    const cards = scoresDisplay.querySelectorAll('.player-score-card');
    cards.forEach((card) => {
      const nameEl = card.querySelector('.player-score-name');
      if (nameEl && nameEl.textContent === scoredPlayer) {
        card.classList.remove('scored-flash');
        void card.offsetWidth; // trigger reflow
        card.classList.add('scored-flash');
      }
    });
  }
});

socket.on('roundEnd', ({ winner, answer, explanation }) => {
  showLoading(false);
  if (state.timerInterval) clearInterval(state.timerInterval);
  
  if (winner) {
    resultTitle.textContent = winner === state.username ? '🏆 Victory is Yours!' : '🥈 Opponent Solved It!';
  } else {
    resultTitle.textContent = '⏰ Nobody Solved It!';
  }
  
  resultAnswer.textContent = answer;
  resultExplanation.textContent = explanation;
  statHints.textContent = state.revealedHints.length;
  
  resultOverlay.classList.remove('hidden');
});

socket.on('playerLeft', ({ message }) => {
  showLoading(false);
  alert(message);
  resultOverlay.classList.add('hidden');
  gameView.classList.add('hidden');
  lobbyView.classList.add('hidden');
  setupView.classList.remove('hidden');
  setupView.className = 'card fade-in';
  
  if (state.timerInterval) clearInterval(state.timerInterval);
  state = {
    roomId: null,
    username: '',
    opponentName: '',
    category: '',
    hintsCount: 5,
    revealedHints: [],
    scores: {},
    hasGuessedWrongThisHint: false,
    timerInterval: null
  };
});

socket.on('errorMsg', ({ message }) => {
  showLoading(false);
  alert(message);
});
