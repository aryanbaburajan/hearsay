import "./style.css";
import { characterName, loadDialogueTree } from "./dialogue.js";
import courtroomAmbienceUrl from "./assets/courtroom-ambience.mp3";
import typewriterUrl from "./assets/typewriter.mp3";

const canvas = document.querySelector("#canvas");
const context = canvas.getContext("2d");
const MILLISECONDS_PER_CHARACTER = 32;
const TRANSCRIPT_FONT = '"Roboto Mono", monospace';
const TYPEWRITER_START = 50;
const TYPEWRITER_END = 59;
const courtroomAmbience = new Audio(courtroomAmbienceUrl);
const typewriterAudio = new Audio(typewriterUrl);
courtroomAmbience.loop = true;
courtroomAmbience.volume = 0.18;
typewriterAudio.volume = 0.16;
courtroomAmbience.preload = "auto";
typewriterAudio.preload = "auto";

let tree = loadDialogueTree();
let currentNodeId = tree.startNodeId;
let selectedOption = 0;
let optionHitboxes = [];
let transcript = [];
let visibleCharacters = 0;
let typingStartedAt = 0;
let typingFrame = 0;
let audioUnlocked = false;

function keepTypewriterInSegment() {
  if (typewriterAudio.readyState < 1) return;
  if (typewriterAudio.currentTime < TYPEWRITER_START || typewriterAudio.currentTime >= TYPEWRITER_END) {
    typewriterAudio.currentTime = TYPEWRITER_START;
  }
}

function playTypewriter() {
  if (!audioUnlocked) return;
  if (typewriterAudio.readyState < 1) {
    typewriterAudio.addEventListener("loadedmetadata", playTypewriter, { once: true });
    return;
  }
  keepTypewriterInSegment();
  typewriterAudio.play().catch(() => {});
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  courtroomAmbience.play().catch(() => {});
  if (isTyping()) playTypewriter();
}

typewriterAudio.addEventListener("loadedmetadata", keepTypewriterInSegment);
typewriterAudio.addEventListener("timeupdate", keepTypewriterInSegment);

function capitalizeEnglish(text) {
  return text
    .replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`)
    .replace(/\bi\b/g, "I");
}

function formatDialogue(text) {
  return capitalizeEnglish(text.trimStart().replace(/^\*\s*/, ""));
}

function speakerName(node) {
  return characterName(tree, node?.speaker).toLocaleUpperCase();
}

const currentNode = () => tree.nodes[currentNodeId] ?? tree.nodes[tree.startNodeId];
const renderedDialogue = () => formatDialogue(currentNode()?.text ?? "");
const isTyping = () => visibleCharacters < renderedDialogue().length;

function startTyping() {
  cancelAnimationFrame(typingFrame);
  visibleCharacters = 0;
  typingStartedAt = performance.now();
  playTypewriter();

  function type(timestamp) {
    visibleCharacters = Math.max(0, Math.min(
      renderedDialogue().length,
      Math.floor((timestamp - typingStartedAt) / MILLISECONDS_PER_CHARACTER),
    ));
    draw();
    if (isTyping()) typingFrame = requestAnimationFrame(type);
    else typewriterAudio.pause();
  }

  typingFrame = requestAnimationFrame(type);
}

function skipTyping() {
  cancelAnimationFrame(typingFrame);
  typewriterAudio.pause();
  visibleCharacters = renderedDialogue().length;
  draw();
}

function wrapText(text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function draw() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#f4f4f2";
  context.fillRect(0, 0, width, height);

  const node = currentNode();
  if (!node) return;

  const pageWidth = Math.min(920, width - 48);
  const pageX = (width - pageWidth) / 2;
  const topMargin = Math.min(72, Math.max(32, height * 0.07));
  const fontSize = width < 600 ? 13 : 15;
  const lineHeight = Math.round(fontSize * 1.55);
  const paragraphGap = lineHeight / 2;
  const rows = [];

  context.font = `${fontSize}px ${TRANSCRIPT_FONT}`;
  context.textAlign = "left";
  context.textBaseline = "top";

  function addText(text, type = "text", optionIndex = null) {
    wrapText(text, pageWidth).forEach((line) => rows.push({ line, type, optionIndex }));
  }

  rows.push({ line: "COURTROOM TRIAL TRANSCRIPT", type: "heading" });
  rows.push({ line: "─".repeat(Math.max(12, Math.floor(pageWidth / context.measureText("─").width))), type: "rule" });
  rows.push({ gap: paragraphGap });

  transcript.forEach((entry) => {
    addText(`${entry.speaker}: ${entry.text}`);
    if (entry.choice) rows.push({ line: `YOU: ${entry.choice}`, type: "text" });
    rows.push({ gap: paragraphGap });
  });

  addText(`${speakerName(node)}: ${renderedDialogue().slice(0, visibleCharacters)}`);
  if (!isTyping() && node.options.length) {
    rows.push({ gap: lineHeight / 2 });
    node.options.forEach((option, index) => {
      const marker = index === selectedOption ? ">" : " ";
      addText(`${marker} [${index + 1}] ${capitalizeEnglish(option.text)}`, "option", index);
    });
  } else if (!isTyping() && tree.nodes[node.nextNodeId]) {
    rows.push({ gap: lineHeight / 2 });
    rows.push({ line: "> ...", type: "continue" });
  } else if (!isTyping() && !node.options.length) {
    rows.push({ gap: lineHeight / 2 });
    rows.push({ line: "END OF TRANSCRIPT", type: "rule" });
  }

  let documentHeight = 0;
  rows.forEach((row) => { documentHeight += row.gap ?? lineHeight; });
  const scrollOffset = Math.max(0, topMargin + documentHeight - (height - 42));
  let y = topMargin - scrollOffset;
  optionHitboxes = [];

  rows.forEach((row) => {
    if (row.gap) {
      y += row.gap;
      return;
    }

    if ((row.type === "option" && row.optionIndex === selectedOption) || row.type === "continue") {
      context.fillStyle = "#dededb";
      context.fillRect(pageX - 8, y - 3, pageWidth + 16, lineHeight);
      context.fillStyle = "#222";
    } else if (row.type === "heading") {
      context.fillStyle = "#333";
    } else if (row.type === "rule") {
      context.fillStyle = "#777";
    } else {
      context.fillStyle = "#222";
    }

    context.fillText(row.line, pageX, y);
    context.font = `${fontSize}px ${TRANSCRIPT_FONT}`;

    if (row.type === "option") {
      optionHitboxes.push({ x: pageX - 8, y: y - 3, width: pageWidth + 16, height: lineHeight, action: "option", index: row.optionIndex });
    } else if (row.type === "continue") {
      optionHitboxes.push({ x: pageX - 8, y: y - 3, width: pageWidth + 16, height: lineHeight, action: "continue" });
    }
    y += lineHeight;
  });

  context.fillStyle = "#777";
  context.font = `12px ${TRANSCRIPT_FONT}`;
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.fillText("UP/DOWN SELECT · Z/ENTER CONFIRM · X SKIP", width - 18, height - 14);
}

function chooseOption(index = selectedOption) {
  const node = currentNode();
  const option = node?.options[index];
  if (!option || !tree.nodes[option.nextNodeId]) return;
  transcript.push({
    speaker: speakerName(node),
    text: renderedDialogue(),
    choice: capitalizeEnglish(option.text),
  });
  currentNodeId = option.nextNodeId;
  selectedOption = 0;
  startTyping();
}

function continueDialogue() {
  const node = currentNode();
  if (!node) return;
  if (node.options.length || !tree.nodes[node.nextNodeId]) return;
  transcript.push({ speaker: speakerName(node), text: renderedDialogue(), choice: null });
  currentNodeId = node.nextNodeId;
  selectedOption = 0;
  startTyping();
}

window.addEventListener("keydown", (event) => {
  unlockAudio();
  const count = currentNode()?.options.length ?? 0;
  if (event.key.toLowerCase() === "x" && isTyping()) {
    event.preventDefault();
    skipTyping();
    return;
  }
  if (isTyping()) return;
  const confirms = event.key.toLowerCase() === "z" || event.key === "Enter" || event.key === " ";
  if (!count) {
    if (confirms && tree.nodes[currentNode()?.nextNodeId]) {
      event.preventDefault();
      continueDialogue();
    }
    return;
  }
  if (event.key === "ArrowUp") selectedOption = (selectedOption - 1 + count) % count;
  else if (event.key === "ArrowDown") selectedOption = (selectedOption + 1) % count;
  else if (confirms) chooseOption();
  else if (/^[1-9]$/.test(event.key)) chooseOption(Number(event.key) - 1);
  else return;
  event.preventDefault();
  draw();
});

function hitOption(event) {
  return optionHitboxes.find(({ x, y, width, height }) =>
    event.offsetX >= x && event.offsetX <= x + width && event.offsetY >= y && event.offsetY <= y + height);
}

canvas.addEventListener("mousemove", (event) => {
  const hit = hitOption(event);
  canvas.style.cursor = hit ? "pointer" : "default";
  if (hit?.action === "option" && hit.index !== selectedOption) {
    selectedOption = hit.index;
    draw();
  }
});
window.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    courtroomAmbience.pause();
    typewriterAudio.pause();
  } else if (audioUnlocked) {
    courtroomAmbience.play().catch(() => {});
    if (isTyping()) playTypewriter();
  }
});
canvas.addEventListener("click", (event) => {
  const hit = hitOption(event);
  if (hit?.action === "continue") continueDialogue();
  else if (hit) chooseOption(hit.index);
});
window.addEventListener("storage", () => {
  tree = loadDialogueTree();
  currentNodeId = tree.startNodeId;
  selectedOption = 0;
  transcript = [];
  startTyping();
});
window.addEventListener("resize", draw);
document.fonts.ready.then(draw);
startTyping();
