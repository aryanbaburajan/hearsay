import shippedDialogueTree from "../save.json";

export const STORAGE_KEY = "hearsay.dialogue-tree.v1";

export const DEFAULT_DIALOGUE_TREE = shippedDialogueTree;

export function cloneDefaultTree() {
  return JSON.parse(JSON.stringify(DEFAULT_DIALOGUE_TREE));
}

export function createNodeId(existingNodes = {}) {
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 10)
      ?? Math.random().toString(36).slice(2, 12);
    id = `node_${random}`;
  } while (existingNodes[id]);
  return id;
}

export function createCharacterId(existingCharacters = []) {
  const existingIds = new Set(existingCharacters.map((character) => character.id));
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 10)
      ?? Math.random().toString(36).slice(2, 12);
    id = `character_${random}`;
  } while (existingIds.has(id));
  return id;
}

export function ensureCharacters(tree) {
  if (!Array.isArray(tree.characters) || !tree.characters.length) {
    tree.characters = DEFAULT_DIALOGUE_TREE.characters.map((character) => ({ ...character }));
  }
  const characterIds = new Set(tree.characters.map((character) => character.id));
  Object.values(tree.nodes ?? {}).forEach((node) => {
    if (!characterIds.has(node.speaker)) node.speaker = tree.characters[0].id;
  });
  return tree;
}

export function characterName(tree, characterId) {
  return tree.characters?.find((character) => character.id === characterId)?.name || "Unknown";
}

export function loadDialogueTree() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.nodes && saved.nodes[saved.startNodeId]) {
      return ensureCharacters(saved);
    }
  } catch (error) {
    console.warn("Could not load the saved dialogue tree.", error);
  }
  return ensureCharacters(cloneDefaultTree());
}

export function saveDialogueTree(tree) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

export function resetDialogueTree() {
  const tree = cloneDefaultTree();
  saveDialogueTree(tree);
  return tree;
}
