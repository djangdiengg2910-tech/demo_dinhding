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
        clearTimeout(room.hintTimer);
        room.hintTimer = null;
      }
      if (room.buzzerLockTimer) {
        clearTimeout(room.buzzerLockTimer);
        room.buzzerLockTimer = null;
      }
    }

    async function progressToNextHint(room) {
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
      if (room.hintTimer) clearTimeout(room.hintTimer);
      
      const duration = room.demoMode ? DEMO_HINT_DURATION : DEFAULT_HINT_DURATION;
      
      room.hintTimer = setTimeout(() => {
        console.log(`Hint timeout in room ${room.roomId}.`);
        progressToNextHint(room);
      }, duration);

      io.to(room.roomId).emit('timerUpdate', { duration });
    }

    // Event: createRoom
    socket.on('createRoom', ({ username, category, hintsCount, difficulty, demoMode }) => {
      try {
        if (!username || !category || !hintsCount) {
          return socket.emit('errorMsg', { message: 'Invalid creation parameters' });
        }

        const roomId = generateRoomCode();
        const newRoom = {
          roomId,
          category,
          difficulty: difficulty || 'Medium',
          hintsCount: parseInt(hintsCount, 10),
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
        socket.emit('roomCreated', { roomId, username });
        console.log(`Room created: ${roomId} by ${username} (Demo Mode: ${newRoom.demoMode}, Difficulty: ${newRoom.difficulty})`);
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

        socket.emit('roomJoined', { roomId: cleanCode, players: room.players });
        socket.to(cleanCode).emit('playerJoined', { players: room.players });

        console.log(`${username} joined room ${cleanCode}`);

        // Automatically start game once room is filled
        if (room.players.length === 2) {
          room.status = 'loading';
          io.to(cleanCode).emit('loadingGame', { 
            message: room.demoMode 
              ? 'Loading preloaded demo questions...' 
              : 'Consulting Gemini API for mystery data...' 
          });

          let gameData = null;
          let loadOffline = false;

          // In Judge Demo Mode: instantly load from offline file to ensure zero latency/absolute stability
          if (room.demoMode) {
            console.log(`Judge Demo Mode active: bypassing Gemini and loading offline fallback.`);
            gameData = getOfflineFallback(room.category, room.difficulty);
            if (!gameData) {
              return io.to(cleanCode).emit('errorMsg', { message: 'Failed to load preloaded demo questions' });
            }
          } else {
            // Normal mode: Try Gemini first, with backup offline failover
            try {
              let duplicateFree = false;
              let apiAttempts = 0;
              // Prevent duplicate answers within global session history
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

          // Fallback to offline questions if Gemini failed
          if (loadOffline) {
            gameData = getOfflineFallback(room.category, room.difficulty);
            if (!gameData) {
              io.to(cleanCode).emit('errorMsg', { message: 'Gemini and offline fallbacks both failed to initialize game.' });
              clearRoomTimers(room);
              rooms.delete(cleanCode);
              return;
            }
            io.to(cleanCode).emit('errorMsg', { message: 'AI error. Running on local backup dataset.' });
          }

          // Record in global history to prevent duplicates in next rounds
          globalAnswerHistory.add(gameData.answer.toLowerCase().trim());

          room.answer = gameData.answer;
          room.hints = gameData.hints;
          room.currentHintIndex = 0;
          room.status = 'playing';

          io.to(cleanCode).emit('startGame', {
            category: room.category,
            totalHints: room.hintsCount,
            firstHint: room.hints[0],
            players: room.players.map((p) => ({ username: p.username, score: p.score })),
            demoMode: room.demoMode
          });

          startHintTimer(room);
        }
      } catch (err) {
        socket.emit('errorMsg', { message: 'Failed to join room' });
      }
    });

    // Event: buzz
    socket.on('buzz', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== 'playing') return;

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

      if (room.buzzerLockedBy !== socket.id) {
        return socket.emit('errorMsg', { message: 'You do not have answering rights.' });
      }

      if (room.buzzerLockTimer) {
        clearTimeout(room.buzzerLockTimer);
        room.buzzerLockTimer = null;
      }

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      const trimmedGuess = guess ? guess.trim() : '';
      if (!trimmedGuess) {
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
          const pts = Math.max(10, 100 - (room.currentHintIndex * 10));
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
          const pts = Math.max(10, 100 - (room.currentHintIndex * 10));
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
