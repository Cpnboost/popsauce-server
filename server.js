// server.js — Pop Sauce (Socket.IO) — version corrigée et robuste
// ——————————————————————————————————————————————————————————
// * Rend les fichiers statiques (index.html, client.js, styles.css)
// * Charge un CSV (facultatif). Les colonnes attendues sont: "Question","Reponse"
// * Emet *toujours* des clés en minuscules vers le client: {question}, {answer}
// * Corrige l'incohérence de casse qui empêchait l'affichage des questions
// * Compatible Render (port fourni via process.env.PORT)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Fichiers statiques (index.html, client.js, styles.css)
app.use(express.static(path.join(__dirname)));

// ————————— Données —————————
let allQuestions = [];
let players = {}; // id -> { id, name, score }
let currentQuestion = null; // { Question, Reponse }
let foundPlayers = new Set();
let timeLeft = 0;
let roundTimer = null;
let roundNumber = 0;
const ROUND_DURATION = 20;
const WIN_SCORE = 100;

// ————————— Utilitaires —————————
function normalize(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function loadCsvIfExists() {
  return new Promise((resolve) => {
    const filePath = path.join(__dirname, "questions.csv"); // facultatif
    if (!fs.existsSync(filePath)) {
      // fallback minimal si pas de CSV présent dans le repo
      allQuestions = [
        { Question: "Capitale de la France ?", Reponse: "Paris" },
        { Question: "2 + 2 ?", Reponse: "4" },
        { Question: "Couleur du ciel par temps clair ?", Reponse: "Bleu" },
      ];
      console.log("ℹ️ Aucun CSV trouvé. Utilisation d'un petit jeu de questions par défaut.");
      return resolve();
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        // On tolère différentes casses pour les entêtes CSV
        const q = row.Question ?? row.question ?? row.QUESTION ?? row["Question "] ?? row["question "];
        const r = row.Reponse ?? row.reponse ?? row.REPONSE ?? row.Réponse ?? row["Réponse"];
        if (q && r) results.push({ Question: String(q), Reponse: String(r) });
      })
      .on("end", () => {
        if (results.length > 0) {
          allQuestions = results;
          console.log(`📥 ${allQuestions.length} questions chargées depuis CSV.`);
        } else {
          allQuestions = [
            { Question: "Capitale de la France ?", Reponse: "Paris" },
            { Question: "2 + 2 ?", Reponse: "4" },
            { Question: "Couleur du ciel par temps clair ?", Reponse: "Bleu" },
          ];
          console.log("⚠️ CSV vide/invalide. Utilisation d'un petit jeu par défaut.");
        }
        resolve();
      })
      .on("error", (err) => {
        console.error("Erreur lecture CSV:", err);
        allQuestions = [
          { Question: "Capitale de la France ?", Reponse: "Paris" },
          { Question: "2 + 2 ?", Reponse: "4" },
          { Question: "Couleur du ciel par temps clair ?", Reponse: "Bleu" },
        ];
        resolve();
      });
  });
}

function pickRandomQuestion() {
  if (!allQuestions.length) return null;
  const idx = Math.floor(Math.random() * allQuestions.length);
  return allQuestions[idx];
}

function startRound() {
  currentQuestion = pickRandomQuestion();
  foundPlayers = new Set();
  timeLeft = ROUND_DURATION;
  roundNumber += 1;
  if (!currentQuestion) return;

  // IMPORTANT: on émet *toujours* des clés en minuscules vers le client
  io.emit("newQuestion", {
    question: currentQuestion.Question,
    round: roundNumber,
    timeLeft,
  });

  if (roundTimer) clearInterval(roundTimer);
  roundTimer = setInterval(() => {
    timeLeft -= 1;
    io.emit("timer", { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(roundTimer);
      io.emit("showAnswer", { answer: currentQuestion.Reponse });
      setTimeout(() => maybeNextRound(), 1500);
    }
  }, 1000);
}

function endGameIfNeeded() {
  const top = Object.values(players).sort((a, b) => b.score - a.score)[0];
  if (top && top.score >= WIN_SCORE) {
    io.emit("gameOver", { winner: top });
    if (roundTimer) clearInterval(roundTimer);
    return true;
  }
  return false;
}

function maybeNextRound() {
  if (!endGameIfNeeded()) startRound();
}

function updatePlayers() {
  io.emit("updatePlayers", Object.values(players));
}

// ————————— Socket.IO —————————
io.on("connection", (socket) => {
  console.log("🟢 Client:", socket.id);

  // Envoyer l'état initial
  socket.emit("hello", {
    round: roundNumber,
    timeLeft,
    hasQuestion: !!currentQuestion,
  });
  if (currentQuestion) {
    socket.emit("newQuestion", {
      question: currentQuestion.Question,
      round: roundNumber,
      timeLeft,
    });
  }
  updatePlayers();

  // Player join
  socket.on("join", ({ name }) => {
    const cleanName = String(name || "Joueur").slice(0, 20);
    players[socket.id] = { id: socket.id, name: cleanName, score: 0 };
    updatePlayers();
  });

  // Start game (anyone can lancer; à toi de restreindre si besoin)
  socket.on("startGame", () => {
    if (roundTimer) return; // évite de relancer pendant un round
    startRound();
  });

  // Réception d'une tentative
  socket.on("submitAnswer", ({ answer }) => {
    if (!currentQuestion) return;
    if (!players[socket.id]) return;
    if (foundPlayers.has(socket.id)) return;

    const guess = normalize(answer);
    const target = normalize(currentQuestion.Reponse);

    // match exact "normalisé" (tu peux remplacer par un includes si tu veux)
    if (guess && guess === target) {
      foundPlayers.add(socket.id);
      players[socket.id].score = (players[socket.id].score || 0) + 10;
      io.emit("playerFound", {
        playerId: socket.id,
        found: Array.from(foundPlayers),
        scores: Object.values(players),
      });

      // si tout le monde a trouvé ou temps fini → on révèle puis on passe
      const allActive = Object.keys(players).length || 1;
      if (foundPlayers.size >= allActive) {
        if (roundTimer) clearInterval(roundTimer);
        io.emit("showAnswer", { answer: currentQuestion.Reponse });
        setTimeout(() => maybeNextRound(), 1200);
      } else {
        endGameIfNeeded();
      }
    } else {
      socket.emit("wrongAttempt", {});
    }
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    foundPlayers.delete(socket.id);
    updatePlayers();
    console.log("🔴 Déconnecté:", socket.id);
  });
});

// ————————— Lancement —————————
loadCsvIfExists().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur :${PORT}`);
  });
});
