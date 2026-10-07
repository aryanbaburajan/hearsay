import "./characters.css";
import { createCharacterId, ensureCharacters, loadDialogueTree, saveDialogueTree } from "./dialogue.js";

const list = document.querySelector("#character-list");
const saveStatus = document.querySelector("#save-status");
const undoToast = document.querySelector("#undo-toast");
let tree = ensureCharacters(loadDialogueTree());
let saveTimer;
let undoTimer;
let deletedSnapshot = null;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function persist(immediate = false) {
  saveStatus.textContent = "Saving…";
  clearTimeout(saveTimer);
  const save = () => {
    saveDialogueTree(tree);
    saveStatus.textContent = "Saved";
  };
  if (immediate) save();
  else saveTimer = setTimeout(save, 180);
}

function render() {
  list.innerHTML = tree.characters.map((character, index) => `
    <article class="character-card" data-character-id="${escapeHtml(character.id)}">
      <span class="character-index">${String(index + 1).padStart(2, "0")}</span>
      <label class="character-name">
        <span>Name</span>
        <input value="${escapeHtml(character.name)}" maxlength="60" aria-label="Character name">
      </label>
      <button class="danger delete-character" type="button" ${tree.characters.length === 1 ? "disabled" : ""}>Delete</button>
    </article>
  `).join("");
}

document.querySelector("#add-character").addEventListener("click", () => {
  const character = { id: createCharacterId(tree.characters), name: "New character" };
  tree.characters.push(character);
  render();
  persist(true);
  const input = list.querySelector(`[data-character-id="${CSS.escape(character.id)}"] input`);
  input.focus();
  input.select();
});

list.addEventListener("input", (event) => {
  const card = event.target.closest("[data-character-id]");
  if (!card || !event.target.matches("input")) return;
  const character = tree.characters.find((item) => item.id === card.dataset.characterId);
  character.name = event.target.value;
  persist();
});

list.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-character");
  if (!button || tree.characters.length === 1) return;
  const card = button.closest("[data-character-id]");
  deletedSnapshot = JSON.parse(JSON.stringify(tree));
  const deletedId = card.dataset.characterId;
  tree.characters = tree.characters.filter((character) => character.id !== deletedId);
  const replacementId = tree.characters[0].id;
  Object.values(tree.nodes).forEach((node) => {
    if (node.speaker === deletedId) node.speaker = replacementId;
  });
  render();
  persist(true);
  undoToast.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    deletedSnapshot = null;
    undoToast.hidden = true;
  }, 5000);
});

document.querySelector("#undo-delete").addEventListener("click", () => {
  if (!deletedSnapshot) return;
  tree = deletedSnapshot;
  deletedSnapshot = null;
  clearTimeout(undoTimer);
  undoToast.hidden = true;
  render();
  persist(true);
});

window.addEventListener("storage", () => {
  tree = ensureCharacters(loadDialogueTree());
  render();
});

render();
