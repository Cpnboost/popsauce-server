// --- Dépendances ---
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const csv = require("csv-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Sert les fichiers statiques ---
app.use(express.static(__dirname));

// --- Données du jeu ---
let allQuestions = [];
let usedQuestions = [];
let players = {};
let currentQuestion = null;
let foundPlayers = new Set();
let timer = null;
let timeLeft = 20;
let gameStarted = false;

// --- Chargement du CSV ---
fs.createReadStream("questions.csv")
  .pipe(csv())
  .on("data", (row) => allQuestions.push(row))
  .on("end", () =>
    console.log(`✅ ${allQuestions.length} questions chargées depuis questions.csv`)
  );

// --- Sélection d'une question non répétée ---
function pickRandomQuestion() {
  const remaining = allQuestions.filter((q) => !usedQuestions.includes(q.Question));
  if (remaining.length === 0) usedQuestions = [];

  const available = allQuestions.filter((q) => !usedQuestions.includes(q.Question));
  const chosen = available[Math.floor(Math.random() * available.length)];
  usedQuestions.push(chosen.Question);
  return chosen;
}

// --- Timer ---
function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    timeLeft--;
    io.emit("timerUpdate", timeLeft);

    if (timeLeft <= 0 || foundPlayers.size === Object.keys(players).length) {
      clearInterval(timer);
      io.emit("showAnswer", currentQuestion.Reponse);
      setTimeout(() => resetRound(), 4000);
    }
  }, 1000);
}

// --- Nouveau tour ---
function resetRound() {
  const maxScore = Math.max(...Object.values(players).map((p) => p.score || 0));
  if (maxScore >= 100) return endGame();

  currentQuestion = pickRandomQuestion();
  foundPlayers = new Set();
  timeLeft = 20;

  console.log("➡️ Nouvelle question :", currentQuestion.Question);
  io.emit("newQuestion", { question: currentQuestion.Question });

  startTimer();
}

// --- Fin de partie ---
function endGame() {
  clearInterval(timer);
  gameStarted = false;

  const sorted = Object.values(players).sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  if (!winner) return;

  io.emit("gameOver", {
    winnerName: winner.name,
    winnerScore: winner.score,
  });

  setTimeout(() => {
    Object.values(players).forEach((p) => (p.score = 0));
    usedQuestions = [];
    io.emit("updatePlayers", Object.values(players));
    io.emit("backToLobby");
  }, 5000);
}

// --- Distance Levenshtein pour tolérance fautes ---
function levenshtein(a, b) {
  const dp = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

// --- Gestion des sockets ---
io.on("connection", (socket) => {
  console.log(`🟢 ${socket.id} connecté`);

  socket.on("joinGame", (name) => {
    players[socket.id] = { id: socket.id, name, score: 0 };
    io.emit("updatePlayers", Object.values(players));
    socket.emit("joinedLobby", Object.values(players));
  });

  socket.on("startGame", () => {
    if (!gameStarted) {
      gameStarted = true;
      usedQuestions = [];
      resetRound();
    }
  });

  socket.on("answer", (answer) => {
    if (!currentQuestion) return;
    const player = players[socket.id];
    if (!player) return;

    const correct = currentQuestion.Reponse.trim().toLowerCase();
    const attempt = answer.trim().toLowerCase();
    const dist = levenshtein(correct, attempt);

    const close = dist <= 4 || correct.includes(attempt) || attempt.includes(correct);

    if ((attempt === correct || close) && !foundPlayers.has(socket.id)) {
      foundPlayers.add(socket.id);

      let scoreGain = 0;
      if (foundPlayers.size === 1) scoreGain = 10;
      else if (timeLeft > 15) scoreGain = 9;
      else if (timeLeft > 13) scoreGain = 8;
      else if (timeLeft > 11) scoreGain = 7;
      else if (timeLeft > 9) scoreGain = 6;
      else if (timeLeft > 7) scoreGain = 5;
      else if (timeLeft > 5) scoreGain = 4;
      else if (timeLeft > 3) scoreGain = 2;
      else scoreGain = 1;

      player.score += scoreGain;

      io.emit("playerFound", {
        found: Array.from(foundPlayers),
        scores: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, p.score])),
      });

      if (player.score >= 100) endGame();
    } else {
      io.emit("wrongAttempt", { playerId: socket.id, attempt: answer });
    }
  });

  socket.on("chatMessage", (msg) => {
    const player = players[socket.id];
    if (player) io.emit("chatMessage", { player: player.name, text: msg });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("updatePlayers", Object.values(players));
    console.log(`🔴 ${socket.id} déconnecté`);
  });
});

// --- Lancement serveur (Render-compatible) ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Pop Sauce lancé sur le port ${PORT}`);
});
