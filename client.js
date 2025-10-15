// client.js — Pop Sauce — version corrigée (tolérante aux clés)
// ——————————————————————————————————————————————————————————
// Affiche la question même si le serveur/CSV a des colonnes en majuscules.
// Utilise toujours les clés en minuscules si présentes (question/answer).

const socket = io();

// ————————— DOM helpers —————————
const $id = (id) => document.getElementById(id);

const loginScreen   = $id("loginScreen");
const lobby         = $id("lobby") || $id("loby") || $id("hall"); // tolérant
const gameScreen    = $id("gameScreen") || document.body;

const lobbyPlayers  = $id("lobbyPlayers");
const gamePlayers   = $id("gamePlayers");

const playerNameInput = $id("playerName");
const joinButton      = $id("joinButton");
const startGameButton = $id("startGameButton");

const questionText = $id("questionText") || document.querySelector("#questionCard #questionText, #question, .question");
let answerInput    = $id("answerInput") || document.querySelector("#answerInput, #reponse, input[placeholder*='réponse' i], #gameScreen input, input");
const timerEl      = $id("timer") || document.querySelector("#timer, .timer");

const answerReveal = $id("answerReveal") || document.querySelector("#answerReveal, .answer");

// ————————— Etat —————————
let me = null;
let foundSet = new Set();
let players = [];

// ————————— UI —————————
function show(el) { if (el) el.style.display = ""; }
function hide(el) { if (el) el.style.display = "none"; }

function renderPlayers(list, target) {
  if (!target) return;
  target.innerHTML = "";
  list.forEach((p) => {
    const div = document.createElement("div");
    div.className = "playerCard";
    div.id = "player-" + p.id;
    div.innerHTML = `<span class="name">${escapeHtml(p.name)}</span><span class="score">${p.score||0}</span>`;
    target.appendChild(div);
  });
}

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}

function updateScores(list) {
  players = list || players;
  renderPlayers(players, gamePlayers || lobbyPlayers);
}

function clearFoundHighlights() {
  document.querySelectorAll("#gamePlayers .playerCard, .playerCard").forEach((el) => el.classList.remove("found"));
}
function applyFoundHighlights() {
  document.querySelectorAll("#gamePlayers .playerCard, .playerCard").forEach((el) => {
    const id = el.id.replace("player-", "");
    if (foundSet.has(id)) el.classList.add("found");
  });
}

// ————————— Events UI —————————
if (joinButton) {
  joinButton.addEventListener("click", () => {
    const name = (playerNameInput?.value || "").trim() || "Joueur";
    me = { name };
    socket.emit("join", { name });
    hide(loginScreen);
    show(lobby || gameScreen);
  });
}

if (startGameButton) {
  startGameButton.addEventListener("click", () => socket.emit("startGame"));
}

// Envoi réponse sur Enter
if (answerInput) {
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = answerInput.value.trim();
      if (val) socket.emit("submitAnswer", { answer: val });
      answerInput.value = "";
    }
  });
}

// ————————— Socket events —————————
socket.on("hello", (state) => {
  if (state?.hasQuestion) {
    // Le serveur renverra ensuite "newQuestion"
  }
});

socket.on("updatePlayers", (list) => {
  updateScores(list);
});

socket.on("newQuestion", (payload) => {
  // Tolérant "question" / "Question"
  const q = payload?.question ?? payload?.Question ?? "—";
  if (questionText) questionText.textContent = q;
  if (answerReveal) answerReveal.textContent = "";
  foundSet = new Set();
  clearFoundHighlights();
  applyFoundHighlights();
  if (payload?.timeLeft && timerEl) timerEl.textContent = String(payload.timeLeft);
});

socket.on("timer", ({ timeLeft }) => {
  if (timerEl) timerEl.textContent = String(timeLeft);
});

socket.on("playerFound", (data) => {
  foundSet = new Set(data.found || []);
  updateScores(data.scores || players);
  applyFoundHighlights();
});

socket.on("showAnswer", (payload) => {
  const ans = payload?.answer ?? payload?.Answer ?? "";
  if (answerReveal) answerReveal.textContent = ans;
});

socket.on("gameOver", ({ winner }) => {
  // Si tu as un écran de victoire, tu peux l'activer ici
  const wName = winner?.name || "Quelqu'un";
  alert(`🏆 ${wName} a gagné !`);
});
