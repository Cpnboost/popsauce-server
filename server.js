const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname)));

/* ===== Chargement des questions ===== */
let questions = [];
fs.createReadStream("questions.csv")
  .pipe(csv())
  .on("data", (row) => {
    questions.push({
      question: String(row.question || ""),
      answer: String(row.answer || "").toLowerCase(),
      synonyms: row.synonyms
        ? String(row.synonyms)
            .split(";")
            .map((s) => s.trim().toLowerCase())
        : [],
    });
  })
  .on("end", () => {
    console.log(`✅ ${questions.length} questions chargées.`);
  });

/* ===== État du jeu ===== */
let players = {};
let scores = {};
let foundThisRound = new Set();
let currentQuestion = null;
let roundStartTime = null;
let timerInterval = null;

const ROUND_DURATION = 20; // secondes
const PAUSE_DURATION = 4000; // ms

/* ===== Socket.IO ===== */
io.on("connection", (socket) => {
  socket.on("joinGame", (name) => {
    const pseudo = (name || "").trim();
    if (!pseudo) return;

    players[socket.id] = pseudo;
    scores[socket.id] = scores[socket.id] || 0;

    io.emit("updatePlayers", getPlayersList());
    socket.emit("joinedLobby", getPlayersList());
  });

  socket.on("startGame", () => startNewRound());

  // ===== Réponse d'un joueur =====
  socket.on("answer", (msg) => {
    if (!currentQuestion) return;
    const response = String(msg || "").trim().toLowerCase();
    const delay = Math.floor((Date.now() - roundStartTime) / 1000);

    if (isAnswerClose(response, currentQuestion.answer, currentQuestion.synonyms)) {
      if (!foundThisRound.has(socket.id)) {
        const isFirst = foundThisRound.size === 0;
        const gained = computePoints(delay, isFirst);
        scores[socket.id] = (scores[socket.id] || 0) + gained;
        foundThisRound.add(socket.id);
      }

      io.emit("playerFound", {
        playerId: socket.id,
        player: players[socket.id],
        scores,
        found: Array.from(foundThisRound),
      });

      // si tout le monde a trouvé
      if (foundThisRound.size === Object.keys(players).length) {
        endRound();
      }
    }
  });

  // ===== Tentatives visibles (fausses) =====
  socket.on("attempt", (msg) => {
    if (!currentQuestion) return;
    const response = String(msg || "").trim().toLowerCase();

    if (!isAnswerClose(response, currentQuestion.answer, currentQuestion.synonyms)) {
      io.emit("wrongAttempt", { playerId: socket.id, attempt: response });
    }
  });

  // ===== Chat =====
  socket.on("chatMessage", (msg) => {
    const pseudo = players[socket.id];
    if (pseudo && String(msg).trim() !== "") {
      io.emit("chatMessage", { player: pseudo, text: String(msg) });
    }
  });

  // ===== Déconnexion =====
  socket.on("disconnect", () => {
    delete players[socket.id];
    delete scores[socket.id];
    foundThisRound.delete(socket.id);
    io.emit("updatePlayers", getPlayersList());
  });
});

/* ===== Fonctions principales ===== */
function startNewRound() {
  clearInterval(timerInterval);
  if (questions.length === 0) return;

  currentQuestion = questions[Math.floor(Math.random() * questions.length)];
  foundThisRound = new Set();
  roundStartTime = Date.now();

  io.emit("newQuestion", { question: currentQuestion.question });

  let timeLeft = ROUND_DURATION;
  io.emit("timerUpdate", timeLeft);

  timerInterval = setInterval(() => {
    timeLeft--;
    io.emit("timerUpdate", timeLeft);
    if (timeLeft <= 0) endRound();
  }, 1000);
}

function endRound() {
  clearInterval(timerInterval);
  io.emit("showAnswer", currentQuestion.answer);

  setTimeout(() => startNewRound(), PAUSE_DURATION);
}

/* ===== Barème des points ===== */
function computePoints(delay, isFirst) {
  if (isFirst) return 10;
  if (delay <= 5) return 9;
  if (delay <= 7) return 8;
  if (delay <= 9) return 7;
  if (delay <= 11) return 6;
  if (delay <= 12) return 5;
  if (delay <= 13) return 3;
  if (delay <= 14) return 2;
  return 1;
}

/* ===== Utils ===== */
function getPlayersList() {
  return Object.keys(players).map((id) => ({
    id,
    name: players[id],
    score: scores[id] || 0,
  }));
}

function isAnswerClose(given, expected, synonyms) {
  if (levenshtein(given, expected) <= 4) return true;
  for (const s of synonyms) if (levenshtein(given, s) <= 4) return true;
  return false;
}

function levenshtein(a, b) {
  const matrix = [];
  const L1 = a.length,
    L2 = b.length;
  for (let i = 0; i <= L2; i++) matrix[i] = [i];
  for (let j = 0; j <= L1; j++) matrix[0][j] = j;
  for (let i = 1; i <= L2; i++) {
    for (let j = 1; j <= L1; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[L2][L1];
}

/* ===== Lancement ===== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});

