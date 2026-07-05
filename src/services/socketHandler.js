import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateGameData, verifyGuess } from './geminiService.js';

// Resolve directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local backup questions
const offlineDataPath = path.join(__dirname, '..', 'data', 'offline_questions.json');
let offlineQuestions = {};
try {
  const rawData = fs.readFileSync(offlineDataPath, 'utf8');
  offlineQuestions = JSON.parse(rawData);
  console.log('Successfully preloaded offline fallback database.');
} catch (error) {
  console.error('Warning: Failed to load offline fallback questions file:', error.message);
}

// In-memory room store
const rooms = new Map();

// Global history to prevent duplicate answers
const globalAnswerHistory = new Set();

// Default timer constants
const DEFAULT_HINT_DURATION = 30000;
const DEFAULT_BUZZER_DURATION = 15000;

// Secret Demo mode fast-timer constants
const DEMO_HINT_DURATION = 8000;
const DEMO_BUZZER_DURATION = 5000;
const HINT_INTERVAL_MS = 5000;

// Helper to generate a random 4-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Selects a backup question matching category and difficulty from local file
function getOfflineFallback(category, difficulty) {
  const catData = offlineQuestions[category] || offlineQuestions[Object.keys(offlineQuestions)[0]];
  if (!catData) return null;
  const list = catData[difficulty] || catData['Medium'] || catData[Object.keys(catData)[0]];
  if (!list || list.length === 0) return null;

  // Filter out questions that have already been played
  const unused = list.filter((item) => !globalAnswerHistory.has(item.answer.toLowerCase().trim()));
  const selectionPool = unused.length > 0 ? unused : list;
  const selected = selectionPool[Math.floor(Math.random() * selectionPool.length)];
  
  return JSON.parse(JSON.stringify(selected)); // return clone
}

export function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    function getRoomOfSocket() {
      for (const room of rooms.values()) {
        if (room.players.some((p) => p.socketId === socket.id)) return room;
      }
      return null;
    }

    function clearRoomTimers(room) {
      if (room.hintTimer) {
        clearInterval(room.hintTimer);
        clearTimeout(room.hintTimer);
        room.hintTimer = null;
      }
      if (room.buzzerLockTimer) {
        clearTimeout(room.buzzerLockTimer);
        room.buzzerLockTimer = null;
      }
    }

    function calculatePoints(room) {
      return Math.max(10, 100 - (room.currentHintIndex * 10));
    }

    async function initializeRoomGame(room) {
      room.status = 'loading';
      io.to(room.roomId).emit('loadingGame', {
        message: room.demoMode
          ? 'Loading preloaded demo questions...'
          : 'Consulting Gemini API for mystery data...'
      });

      let gameData = null;
      let loadOffline = false;

      if (room.demoMode) {
        console.log(`Judge Demo Mode active: bypassing Gemini and loading offline fallback for room ${room.roomId}.`);
        gameData = getOfflineFallback(room.category, room.difficulty);
        if (!gameData) {
          io.to(room.roomId).emit('errorMsg', { message: 'Failed to load preloaded demo questions' });
          clearRoomTimers(room);
          rooms.delete(room.roomId);
          return;
        }
      } else {
        try {
          let duplicateFree = false;
          let apiAttempts = 0;
          while (!duplicateFree && apiAttempts < 3) {
            gameData = await generateGameData(room.category, room.hintsCount, room.difficulty);
            const answerNormalized = gameData.answer.toLowerCase().trim();
            if (!globalAnswerHistory.has(answerNormalized)) {
              duplicateFree = true;
            } else {
              console.warn(`Gemini returned duplicate answer: "${gameData.answer}". Retrying...`);
              apiAttempts++;
            }
          }
          if (!duplicateFree) {
            throw new Error('Repeated duplicate answers from Gemini API');
          }
        } catch (err) {
          console.error('Gemini error. Switching to offline backup mode:', err.message);
          loadOffline = true;
        }
      }

      if (loadOffline) {
        gameData = getOfflineFallback(room.category, room.difficulty);
        if (!gameData) {
          io.to(room.roomId).emit('errorMsg', { message: 'Gemini and offline fallbacks both failed to initialize game.' });
          clearRoomTimers(room);
          rooms.delete(room.roomId);
          return;
        }
        io.to(room.roomId).emit('errorMsg', { message: 'AI error. Running on local backup dataset.' });
      }

      globalAnswerHistory.add(gameData.answer.toLowerCase().trim());

      room.answer = gameData.answer;
      room.hints = gameData.hints;
      room.currentHintIndex = 0;
      room.status = 'playing';

      io.to(room.roomId).emit('startGame', {
        category: room.category,
        totalHints: room.hintsCount,
        firstHint: room.hints[0],
        players: room.players.map((p) => ({ username: p.username, score: p.score })),
        demoMode: room.demoMode,
        mode: room.mode
      });

      startHintTimer(room);
    }

    function progressToNextHint(room) {
      clearRoomTimers(room);
      room.buzzerLockedBy = null;
      room.currentHintIndex += 1;

      if (room.currentHintIndex >= room.hints.length) {
        io.to(room.roomId).emit('roundEnd', {
          winner: null,
          answer: room.answer,
          explanation: 'All hints were revealed, but no player guessed correctly!'
        });
        room.status = 'roundEnd';
        return;
      }

      room.players.forEach((p) => {
        p.guessedWrongThisHint = false;
      });

      io.to(room.roomId).emit('nextHint', {
        hintText: room.hints[room.currentHintIndex],
        currentHintIndex: room.currentHintIndex,
        totalHints: room.hints.length,
        hasMore: room.currentHintIndex < room.hints.length - 1
      });

      startHintTimer(room);
    }

    function startHintTimer(room) {
      clearRoomTimers(room);

      room.hintTimer = setInterval(() => {
        if (room.status !== 'playing' || !rooms.has(room.roomId)) {
          clearRoomTimers(room);
          return;
        }

        if (room.currentHintIndex >= room.hints.length - 1) {
          clearRoomTimers(room);
          io.to(room.roomId).emit('roundEnd', {
            winner: null,
            answer: room.answer,
            explanation: 'All hints were revealed, but no player guessed correctly!'
          });
          room.status = 'roundEnd';
          return;
        }

        room.currentHintIndex += 1;
        room.players.forEach((p) => {
          p.guessedWrongThisHint = false;
        });

        io.to(room.roomId).emit('nextHint', {
          hintText: room.hints[room.currentHintIndex],
          currentHintIndex: room.currentHintIndex,
          totalHints: room.hints.length,
          hasMore: room.currentHintIndex < room.hints.length - 1
        });
      }, HINT_INTERVAL_MS);

      io.to(room.roomId).emit('timerUpdate', { duration: HINT_INTERVAL_MS });
    }

    // Event: createRoom
    socket.on('createRoom', ({ username, category, hintsCount, difficulty, demoMode, mode }) => {
      try {
        if (!username || !category || !hintsCount) {
          return socket.emit('errorMsg', { message: 'Invalid creation parameters' });
        }

        const roomMode = mode === 'solo' ? 'solo' : 'duo';
        const roomId = generateRoomCode();
        const newRoom = {
          roomId,
          category,
          difficulty: difficulty || 'Medium',
          hintsCount: parseInt(hintsCount, 10),
          mode: roomMode,
          players: [
            {
              socketId: socket.id,
              username,
              score: 0,
              guessedWrongThisHint: false
            }
          ],
          answer: '',
          hints: [],
          currentHintIndex: 0,
          buzzerLockedBy: null,
          buzzerLockTimer: null,
          hintTimer: null,
          status: 'waiting',
          demoMode: !!demoMode
        };

        rooms.set(roomId, newRoom);
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, username, mode: roomMode });
        console.log(`Room created: ${roomId} by ${username} (Mode: ${roomMode}, Demo Mode: ${newRoom.demoMode}, Difficulty: ${newRoom.difficulty})`);

        if (roomMode === 'solo') {
          void initializeRoomGame(newRoom);
        }
      } catch (err) {
        socket.emit('errorMsg', { message: 'Failed to create room' });
      }
    });

    // Event: joinRoom
    socket.on('joinRoom', async ({ username, roomId }) => {
      try {
        if (!username || !roomId) {
          return socket.emit('errorMsg', { message: 'Username and Room Code are required' });
        }

        const cleanCode = roomId.trim().toUpperCase();
        const room = rooms.get(cleanCode);

        if (!room) {
          return socket.emit('errorMsg', { message: 'Room not found' });
        }

        if (room.mode === 'solo') {
          return socket.emit('errorMsg', { message: 'This room is set to solo mode.' });
        }

        if (room.players.length >= 2) {
          return socket.emit('errorMsg', { message: 'Room is full (max 2 players)' });
        }

        const newPlayer = {
          socketId: socket.id,
          username,
          score: 0,
          guessedWrongThisHint: false
        };
        room.players.push(newPlayer);
        socket.join(cleanCode);

        socket.emit('roomJoined', { roomId: cleanCode, players: room.players, mode: room.mode });
        socket.to(cleanCode).emit('playerJoined', { players: room.players });

        console.log(`${username} joined room ${cleanCode}`);

        // Automatically start game once room is filled
        if (room.players.length === 2) {
          await initializeRoomGame(room);
        }
      } catch (err) {
        socket.emit('errorMsg', { message: 'Failed to join room' });
      }
    });

    // Event: buzz
    socket.on('buzz', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== 'playing' || room.mode === 'solo') return;

      if (room.buzzerLockedBy) {
        return socket.emit('buzzerFeedback', { status: 'failed', message: 'Buzzer locked by opponent!' });
      }

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.guessedWrongThisHint) {
        return socket.emit('buzzerFeedback', { status: 'failed', message: 'You are locked out of this hint!' });
      }

      room.buzzerLockedBy = socket.id;
      if (room.hintTimer) {
        clearTimeout(room.hintTimer);
        room.hintTimer = null;
      }

      const duration = room.demoMode ? DEMO_BUZZER_DURATION : DEFAULT_BUZZER_DURATION;

      io.to(roomId).emit('buzzLocked', {
        buzzedBy: socket.id,
        username: player.username,
        duration
      });

      // Handle buzzer duration timeout
      room.buzzerLockTimer = setTimeout(() => {
        console.log(`Buzzer timeout for ${player.username} in room ${roomId}`);
        
        player.guessedWrongThisHint = true;
        room.buzzerLockedBy = null;
        room.buzzerLockTimer = null;

        io.to(roomId).emit('answerResult', {
          correct: false,
          buzzedBy: socket.id,
          username: player.username,
          explanation: 'Buzzer time expired!'
        });

        const allGuessedWrong = room.players.every((p) => p.guessedWrongThisHint);
        if (allGuessedWrong) {
          progressToNextHint(room);
        } else {
          io.to(roomId).emit('buzzerUnlocked');
          startHintTimer(room);
        }
      }, duration);
    });

    // Event: submitAnswer
    socket.on('submitAnswer', async ({ roomId, guess }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== 'playing') return;

      const isSoloMode = room.mode === 'solo';

      if (!isSoloMode && room.buzzerLockedBy !== socket.id) {
        return socket.emit('errorMsg', { message: 'You do not have answering rights.' });
      }

      if (!isSoloMode && room.buzzerLockTimer) {
        clearTimeout(room.buzzerLockTimer);
        room.buzzerLockTimer = null;
      }

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      const trimmedGuess = guess ? guess.trim() : '';
      if (!trimmedGuess) {
        if (isSoloMode) {
          io.to(roomId).emit('answerResult', {
            correct: false,
            buzzedBy: socket.id,
            username: player.username,
            explanation: 'Submitted empty guess!'
          });
          return;
        }

        player.guessedWrongThisHint = true;
        room.buzzerLockedBy = null;
        io.to(roomId).emit('answerResult', {
          correct: false,
          buzzedBy: socket.id,
          username: player.username,
          explanation: 'Submitted empty guess!'
        });

        const allGuessedWrong = room.players.every((p) => p.guessedWrongThisHint);
        if (allGuessedWrong) {
          progressToNextHint(room);
        } else {
          io.to(roomId).emit('buzzerUnlocked');
          startHintTimer(room);
        }
        return;
      }

      try {
        let result = null;
        
        // In Judge Demo Mode or if offline fallback triggered: use local string comparing to avoid Gemini latency/errors
        if (room.demoMode) {
          const correct = room.answer.toLowerCase().trim() === trimmedGuess.toLowerCase().trim();
          result = {
            correct,
            explanation: correct 
              ? `Correct! "${trimmedGuess}" is a exact match.` 
              : `Incorrect match for "${trimmedGuess}".`
          };
        } else {
          result = await verifyGuess(room.answer, trimmedGuess);
        }

        if (result.correct) {
          const pts = calculatePoints(room);
          player.score += pts;
          room.status = 'roundEnd';
          clearRoomTimers(room);

          io.to(roomId).emit('scoreUpdate', {
            players: room.players.map((p) => ({ username: p.username, score: p.score })),
            scoredPlayer: player.username,
            points: pts
          });

          io.to(roomId).emit('answerResult', {
            correct: true,
            buzzedBy: socket.id,
            username: player.username,
            explanation: result.explanation
          });

          io.to(roomId).emit('roundEnd', {
            winner: player.username,
            answer: room.answer,
            explanation: result.explanation
          });
        } else {
          if (isSoloMode) {
            io.to(roomId).emit('answerResult', {
              correct: false,
              buzzedBy: socket.id,
              username: player.username,
              explanation: result.explanation
            });
            return;
          }

          player.guessedWrongThisHint = true;
          room.buzzerLockedBy = null;

          io.to(roomId).emit('answerResult', {
            correct: false,
            buzzedBy: socket.id,
            username: player.username,
            explanation: result.explanation
          });

          const allGuessedWrong = room.players.every((p) => p.guessedWrongThisHint);
          if (allGuessedWrong) {
            progressToNextHint(room);
          } else {
            io.to(roomId).emit('buzzerUnlocked');
            startHintTimer(room);
          }
        }
      } catch (err) {
        console.error('Error verifying answer in socketHandler:', err);
        // Direct string match fallback
        const correct = room.answer.toLowerCase().trim() === trimmedGuess.toLowerCase().trim();
        if (correct) {
          const pts = calculatePoints(room);
          player.score += pts;
          room.status = 'roundEnd';
          clearRoomTimers(room);
          io.to(roomId).emit('scoreUpdate', {
            players: room.players.map((p) => ({ username: p.username, score: p.score })),
            scoredPlayer: player.username,
            points: pts
          });
          io.to(roomId).emit('roundEnd', {
            winner: player.username,
            answer: room.answer,
            explanation: 'Semantic verification fell back to direct match.'
          });
        } else {
          if (isSoloMode) {
            io.to(roomId).emit('answerResult', {
              correct: false,
              buzzedBy: socket.id,
              username: player.username,
              explanation: 'Incorrect.'
            });
            return;
          }

          player.guessedWrongThisHint = true;
          room.buzzerLockedBy = null;
          io.to(roomId).emit('answerResult', {
            correct: false,
            buzzedBy: socket.id,
            username: player.username,
            explanation: 'Incorrect.'
          });
          const allGuessedWrong = room.players.every((p) => p.guessedWrongThisHint);
          if (allGuessedWrong) {
            progressToNextHint(room);
          } else {
            io.to(roomId).emit('buzzerUnlocked');
            startHintTimer(room);
          }
        }
      }
    });

    // Event: disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      const room = getRoomOfSocket();
      if (room) {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        io.to(room.roomId).emit('playerLeft', {
          players: room.players,
          message: 'An opponent disconnected. Returning to setup.'
        });
        clearRoomTimers(room);
        room.status = 'waiting';

        if (room.players.length === 0) {
          console.log(`Deleting empty room: ${room.roomId}`);
          rooms.delete(room.roomId);
        }
      }
    });
  });
}
