const breeds = [
  { id: "kijitora", ja: "キジトラ", en: "MACKEREL TABBY" },
  { id: "chatora", ja: "チャトラ", en: "ORANGE TABBY" },
  { id: "white", ja: "白猫", en: "WHITE CAT" },
  { id: "black", ja: "黒猫", en: "BLACK CAT" },
];

const actions = [
  { id: "idle", ja: "待機", en: "IDLE", stamp: "READY!", index: "00" },
  { id: "attack", ja: "攻撃", en: "ATTACK", stamp: "PAW!", index: "01" },
  { id: "hit", ja: "被弾", en: "HIT", stamp: "OUCH!", index: "02" },
  { id: "hiss", ja: "シャー", en: "HISS", stamp: "HISS!", index: "03" },
  { id: "defeat", ja: "敗北", en: "DEFEAT", stamp: "OH NO…", index: "04" },
];

let selectedBreed = breeds[0];
let selectedAction = actions[0];
let sequenceTimer = 0;

const stage = document.querySelector("#motion-stage");
const heroCat = document.querySelector("#hero-cat");
const breedPicker = document.querySelector("#breed-picker");
const actionPicker = document.querySelector("#action-picker");

function framePath(breed, action) {
  return `/assets/cats/v1/frames/${breed.id}/jumping/${action.index}.png`;
}

function replayStage() {
  stage.classList.remove("is-playing");
  void stage.offsetWidth;
  stage.classList.add("is-playing");
}

function renderSelection({ replay = true } = {}) {
  const path = framePath(selectedBreed, selectedAction);
  stage.dataset.action = selectedAction.id;
  heroCat.src = path;
  heroCat.alt = `${selectedBreed.ja}の${selectedAction.ja}ポーズ`;
  document.querySelector("#breed-ja").textContent = selectedBreed.ja;
  document.querySelector("#breed-en").textContent = selectedBreed.en;
  document.querySelector("#state-ja").textContent = selectedAction.ja;
  document.querySelector("#state-en").textContent = selectedAction.en;
  document.querySelector("#action-stamp").textContent = selectedAction.stamp;

  document.querySelectorAll(".synced-cat").forEach((image) => {
    image.src = path;
    image.closest(".fighter-card").dataset.action = selectedAction.id;
  });
  document.querySelectorAll("[data-breed]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.breed === selectedBreed.id);
    button.setAttribute("aria-pressed", String(button.dataset.breed === selectedBreed.id));
  });
  document.querySelectorAll("[data-action-button]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.actionButton === selectedAction.id);
    button.setAttribute("aria-pressed", String(button.dataset.actionButton === selectedAction.id));
  });
  if (replay) replayStage();
}

breeds.forEach((breed) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "breed-button";
  button.dataset.breed = breed.id;
  button.innerHTML = `<img src="/assets/cats/v1/base/${breed.id}.png" alt=""><span>${breed.ja}<small>${breed.en}</small></span>`;
  button.addEventListener("click", () => {
    selectedBreed = breed;
    renderSelection();
  });
  breedPicker.append(button);
});

actions.forEach((action, number) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.dataset.actionButton = action.id;
  button.innerHTML = `<span>0${number + 1}</span><strong>${action.en}</strong><small>${action.ja}</small>`;
  button.addEventListener("click", () => {
    window.clearInterval(sequenceTimer);
    selectedAction = action;
    renderSelection();
  });
  actionPicker.append(button);
});

document.querySelector("#random-button").addEventListener("click", () => {
  window.clearInterval(sequenceTimer);
  selectedBreed = breeds[Math.floor(Math.random() * breeds.length)];
  selectedAction = actions[Math.floor(Math.random() * actions.length)];
  renderSelection();
});

document.querySelector("#play-sequence").addEventListener("click", () => {
  window.clearInterval(sequenceTimer);
  let index = 0;
  selectedAction = actions[index];
  renderSelection();
  sequenceTimer = window.setInterval(() => {
    index = (index + 1) % actions.length;
    selectedAction = actions[index];
    renderSelection();
  }, 1600);
});

const libraryGrid = document.querySelector("#library-grid");
breeds.forEach((breed) => {
  const group = document.createElement("article");
  group.className = "library-group";
  group.innerHTML = `<header><strong>${breed.ja}</strong><span>${breed.en}</span></header>`;
  const poses = document.createElement("div");
  poses.className = "pose-row";
  actions.forEach((action) => {
    const figure = document.createElement("figure");
    figure.innerHTML = `<div><img src="${framePath(breed, action)}" alt="${breed.ja}の${action.ja}"></div><figcaption><b>${action.en}</b><span>${action.ja}</span></figcaption>`;
    poses.append(figure);
  });
  group.append(poses);
  libraryGrid.append(group);
});

renderSelection({ replay: false });
