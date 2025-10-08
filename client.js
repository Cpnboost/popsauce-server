const socket = io();

/* DOM */
const loginScreen = document.getElementById("loginScreen");
const lobby = document.getElementById("lobby");
const gameScreen = document.getElementById("gameScreen");

const lobbyPlayers = document.getElementById("lobbyPlayers");
const gamePlayers = document.getElementById("gamePlayers");

const playerNameInput = document.getElementById("playerName");
const joinButton = document.getElementById("joinButton");
const startGameButton = document.getElementById("startGameButton");

const questionCard = document.getElementById("questionCard");
const questionText = document.getElementById("questionText");
const timerEl = document.getElementById("timer");
const answerInput = document.getElementById("answerInput");

const revealScreen = document.getElementById("revealScreen");
const revealAnswer = document.getElementById("revealAnswer");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChat");

let myId = null;
let foundSet = new Set();
let lastAttempts = {}; // mémorise la dernière réponse pour chaque joueur

/* Connexion */
socket.on("connect", () => (myId = socket.id));

/* Rejoindre */
joinButton.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert("Entre ton pseudo !");
  socket.emit("joinGame", name);
});

socket.on("joinedLobby", (players) => {
  loginScreen.style.display = "none";
  lobby.style.display = "block";
  renderLobby(players);
});

socket.on("updatePlayers", (players) => {
  renderLobby(players);
  renderGamePlayers(players);
});

startGameButton.addEventListener("click", () => socket.emit("startGame"));

/* Nouveau tour */
socket.on("newQuestion", (q) => {
  lobby.style.display = "none";
  gameScreen.style.display = "block";

  questionCard.classList.remove("hidden");
  revealScreen.classList.add("hidden");

  questionText.textContent = q.question;
  answerInput.disabled = false;
  answerInput.value = "";
  answerInput.focus();

  timerEl.textContent = "20";
  foundSet = new Set();
  lastAttempts = {};
  clearFoundHighlights();

  document.querySelectorAll(".lastAttempt").forEach(el => {
    el.textContent = "";
  });
});

/* Timer */
socket.on("timerUpdate", (t) => (timerEl.textContent = t));

/* Correction (affiche aussi toutes les tentatives finales) */
socket.on("showAnswer", (answer) => {
  answerInput.disabled = true;
  questionCard.classList.add("hidden");
  revealScreen.style.display = "flex";
  revealScreen.classList.remove("hidden");
  revealAnswer.textContent = answer || "—";

  // Montre toutes les dernières tentatives
  Object.entries(lastAttempts).forEach(([id, text]) => {
    const el = document.getElementById(`attempt-${id}`);
    if (el) {
      el.textContent = text;
      el.style.display = "inline";
      el.style.opacity = "1";
      el.style.color = "#4D2F57";
      el.style.fontStyle = "italic";
      el.style.fontWeight = "400";
    }
  });
});

/* Un joueur a trouvé */
socket.on("playerFound", (data) => {
  foundSet = new Set(data.found);
  updateScores(data.scores);
  applyFoundHighlights();
});

/* Mauvaise tentative */
socket.on("wrongAttempt", (data) => {
  console.log("❌ mauvaise tentative reçue :", data);
  lastAttempts[data.playerId] = data.attempt;

  const el = document.getElementById(`attempt-${data.playerId}`);
  if (!foundSet.has(data.playerId) && el) {
    el.textContent = data.attempt;
    el.style.display = "inline";   // ✅ garantit affichage
    el.style.opacity = "1";        // ✅ supprime l’effet invisible
    el.style.color = "#4D2F57";    // violet foncé lisible
    el.style.fontStyle = "italic";
    el.style.fontWeight = "400";
  }
});

/* Envoi d'une réponse */
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = answerInput.value.trim();
    if (val) {
      console.log("Tentative envoyée :", val);
      socket.emit("answer", val);
      socket.emit("attempt", val);
    }
    answerInput.value = "";
  }
});

/* Chat */
sendChatBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => e.key === "Enter" && sendChat());
socket.on("chatMessage", (msg) => {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${msg.player}:</strong> ${msg.text}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

function sendChat() {
  const txt = chatInput.value.trim();
  if (txt) socket.emit("chatMessage", txt);
  chatInput.value = "";
}

/* Affichage des joueurs */
function renderLobby(players) {
  lobbyPlayers.innerHTML = "";
  players.forEach((p) => {
    const el = document.createElement("div");
    el.className = "playerCard";
    el.innerHTML = cardInner(p);
    if (p.id === myId) el.classList.add("me");
    lobbyPlayers.appendChild(el);
  });
}

function renderGamePlayers(players) {
  gamePlayers.innerHTML = "";
  players.forEach((p) => {
    const el = document.createElement("div");
    el.id = `player-${p.id}`;
    el.className = "playerCard";
    el.innerHTML = cardInner(p);
    if (p.id === myId) el.classList.add("me");
    if (foundSet.has(p.id)) el.classList.add("found");
    gamePlayers.appendChild(el);
  });
}

/* Structure d'une carte joueur */
function cardInner(p) {
  return `
    <div class="playerCardInner">
      <div class="avatarWrapper">
        <img class="avatar" src="https://cdn-icons-png.flaticon.com/512/1077/1077012.png" alt="avatar" />
        <div class="playerScoreMini">${p.score}</div>
      </div>
      <div class="playerInfo">
        <span class="playerName">${p.name}</span>
        <span class="lastAttempt" id="attempt-${p.id}"></span>
      </div>
    </div>
  `;
}


/* Scores */
function updateScores(scores) {
  Object.entries(scores).forEach(([id, sc]) => {
    const el = document.querySelector(`#player-${id} .playerScoreMini`);
    if (el) el.textContent = sc;
  });
}

/* Surbrillance joueurs */
function clearFoundHighlights() {
  document.querySelectorAll("#gamePlayers .playerCard").forEach((el) =>
    el.classList.remove("found")
  );
}

function applyFoundHighlights() {
  document.querySelectorAll("#gamePlayers .playerCard").forEach((el) => {
    const id = el.id.replace("player-", "");
    if (foundSet.has(id)) el.classList.add("found");
  });
}
