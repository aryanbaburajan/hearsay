import "./editor.css";
import { characterName, createNodeId, ensureCharacters, loadDialogueTree, resetDialogueTree, saveDialogueTree } from "./dialogue.js";

const viewport = document.querySelector("#graph-viewport");
const world = document.querySelector("#graph-world");
const nodeLayer = document.querySelector("#node-layer");
const edges = document.querySelector("#edges");
const inspector = document.querySelector("#inspector");
const saveStatus = document.querySelector("#save-status");
const undoToast = document.querySelector("#undo-toast");
const selectionBox = document.querySelector("#selection-box");
const NODE_WIDTH = 320;
const SVG_OFFSET = 5000;

let tree = loadDialogueTree();
let selectedNodeId = tree.startNodeId;
let selectedNodeIds = new Set([selectedNodeId]);
let view = { x: 80, y: 80, scale: 1 };
let saveTimer;
let undoTimer;
let deletedSnapshot = null;
let pointerAction = null;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function capitalizeName(value) {
  return String(value).replace(/(^|[\s'-])([a-z])/g, (_, separator, letter) =>
    `${separator}${letter.toLocaleUpperCase()}`);
}

function ensurePositions() {
  ensureCharacters(tree);
  Object.values(tree.nodes).forEach((node, index) => {
    if (!node.position) node.position = { x: (index % 3) * 340, y: Math.floor(index / 3) * 260 };
    if (!Array.isArray(node.options)) node.options = [];
  });
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

function offerUndo(snapshot, selectedId) {
  deletedSnapshot = { tree: snapshot, selectedId };
  undoToast.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    deletedSnapshot = null;
    undoToast.hidden = true;
  }, 5000);
}

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function nodeMarkup(node) {
  const preview = node.text || "Empty scene";
  const speaker = capitalizeName(characterName(tree, node.speaker));
  const selected = selectedNodeIds.has(node.id);
  const editing = node.id === selectedNodeId;
  return `
    <article class="graph-node ${selected ? "selected" : ""} ${editing ? "editing" : ""}" data-node-id="${escapeHtml(node.id)}"
      style="left:${node.position.x}px;top:${node.position.y}px">
      <div class="node-title"><span>${escapeHtml(speaker)}</span>${node.id === tree.startNodeId ? '<span class="start">★ Start</span>' : ""}</div>
      ${editing ? `
        <div class="inline-editor">
          <label class="inline-field"><select data-node-field="speaker" aria-label="Speaker">
            ${tree.characters.map((character) => `<option value="${escapeHtml(character.id)}" ${node.speaker === character.id ? "selected" : ""}>${escapeHtml(capitalizeName(character.name))}</option>`).join("")}
          </select></label>
          <label class="inline-field"><textarea data-node-field="text" aria-label="Dialogue" placeholder="Write dialogue…">${escapeHtml(node.text)}</textarea></label>
          <div class="node-options inline-options">
            ${node.options.length ? node.options.map((option, index) => `
              <div class="inline-option node-option" data-option-index="${index}">
                <input data-option-field="text" value="${escapeHtml(option.text)}" aria-label="Choice ${index + 1}">
                <button class="icon-button danger" data-action="remove-option" type="button" aria-label="Delete choice">×</button>
                <span class="port" title="Drag to connect"></span>
              </div>`).join("") : `
              <div class="inline-option node-option continuation-only" data-continuation>
                <span class="port" title="Drag to connect"></span>
              </div>`}
          </div>
          <div class="inline-section-title"><button data-action="add-option" type="button">＋ Add choice</button></div>
          <div class="inline-actions">
            ${node.id === tree.startNodeId
              ? '<span class="start-note">★ Permanent start node</span>'
              : ""}
          </div>
        </div>` : `
        <div class="node-preview">${escapeHtml(preview)}</div>
        <div class="node-options">
          ${node.options.map((option, index) => `
            <div class="node-option" data-option-index="${index}"><span>${escapeHtml(option.text || "Untitled option")}</span><span class="port"></span></div>
          `).join("")}
          ${!node.options.length ? '<div class="node-option continuation-only" data-continuation><span class="port" title="Drag to connect"></span></div>' : ""}
        </div>`}
    </article>`;
}

function renderGraph() {
  nodeLayer.innerHTML = Object.values(tree.nodes).map(nodeMarkup).join("");
  requestAnimationFrame(() => {
    nodeLayer.querySelectorAll("textarea").forEach(resizeTextarea);
    drawEdges();
  });
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function drawEdges() {
  const paths = [];
  Object.values(tree.nodes).forEach((node) => {
    const sourceElement = nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
    node.options.forEach((option, index) => {
      const target = tree.nodes[option.nextNodeId];
      const optionElement = sourceElement?.querySelector(`[data-option-index="${index}"]`);
      if (!target || !optionElement) return;
      const startX = node.position.x + NODE_WIDTH;
      const startY = node.position.y + optionElement.offsetTop + optionElement.offsetHeight / 2;
      const endX = target.position.x;
      const endY = target.position.y + 26;
      const bend = Math.max(80, Math.abs(endX - startX) * 0.45);
      const d = `M ${startX + SVG_OFFSET} ${startY + SVG_OFFSET} C ${startX + bend + SVG_OFFSET} ${startY + SVG_OFFSET}, ${endX - bend + SVG_OFFSET} ${endY + SVG_OFFSET}, ${endX + SVG_OFFSET} ${endY + SVG_OFFSET}`;
      paths.push(`<path class="edge ${selectedNodeIds.has(node.id) ? "selected" : ""}" d="${d}"></path>`);
    });
    if (!node.options.length && tree.nodes[node.nextNodeId]) {
      const target = tree.nodes[node.nextNodeId];
      const continuationElement = sourceElement?.querySelector("[data-continuation]");
      if (!continuationElement) return;
      const startX = node.position.x + NODE_WIDTH;
      const startY = node.position.y + continuationElement.offsetTop + continuationElement.offsetHeight / 2;
      const endX = target.position.x;
      const endY = target.position.y + 26;
      const bend = Math.max(80, Math.abs(endX - startX) * 0.45);
      const d = `M ${startX + SVG_OFFSET} ${startY + SVG_OFFSET} C ${startX + bend + SVG_OFFSET} ${startY + SVG_OFFSET}, ${endX - bend + SVG_OFFSET} ${endY + SVG_OFFSET}, ${endX + SVG_OFFSET} ${endY + SVG_OFFSET}`;
      paths.push(`<path class="edge ${selectedNodeIds.has(node.id) ? "selected" : ""}" d="${d}"></path>`);
    }
  });
  if (pointerAction?.type === "connection") {
    const { startX, startY, endX, endY } = pointerAction;
    const bend = Math.max(80, Math.abs(endX - startX) * 0.45);
    const d = `M ${startX + SVG_OFFSET} ${startY + SVG_OFFSET} C ${startX + bend + SVG_OFFSET} ${startY + SVG_OFFSET}, ${endX - bend + SVG_OFFSET} ${endY + SVG_OFFSET}, ${endX + SVG_OFFSET} ${endY + SVG_OFFSET}`;
    paths.push(`<path class="edge draft" d="${d}"></path>`);
  }
  edges.innerHTML = paths.join("");
}

function targetOptions(selectedId) {
  return Object.values(tree.nodes).map((node) => {
    const label = node.text.replace(/^\*\s*/, "").replace(/\n/g, " ").slice(0, 36) || "Empty scene";
    const speaker = capitalizeName(characterName(tree, node.speaker));
    return `<option value="${escapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${node.id === tree.startNodeId ? "★ " : ""}[${escapeHtml(speaker)}] ${escapeHtml(label)}</option>`;
  }).join("");
}

function renderInspector() {
  const node = tree.nodes[selectedNodeId];
  if (!node) {
    inspector.innerHTML = '<div class="empty-state"><p>Select a scene to edit it.</p></div>';
    return;
  }
  inspector.innerHTML = `
    <div class="inspector-header">
      <h2>Scene details</h2>
      <button id="delete-node" class="danger" type="button">Delete</button>
    </div>
    <label class="field"><span class="field-label">Speaker</span>
      <select id="node-speaker">
        ${tree.characters.map((character) => `<option value="${escapeHtml(character.id)}" ${node.speaker === character.id ? "selected" : ""}>${escapeHtml(capitalizeName(character.name))}</option>`).join("")}
      </select>
    </label>
    <label class="field"><span class="field-label">Dialogue</span><textarea id="node-text" placeholder="Write what happens in this scene…">${escapeHtml(node.text)}</textarea></label>
    <div class="option-heading"><h3>Player choices</h3><button id="add-option" type="button">＋ Add choice</button></div>
    <div class="inspector-options">
      ${node.options.length ? node.options.map((option, index) => `
        <section class="inspector-option" data-option-index="${index}">
          <div class="option-number"><span>Choice ${index + 1}</span><button class="icon-button danger remove-option" type="button" aria-label="Delete choice">×</button></div>
          <label class="field"><span class="field-label">Choice text</span><input data-field="text" value="${escapeHtml(option.text)}"></label>
          <label class="field"><span class="field-label">Continue to</span><select data-field="nextNodeId"><option value="">Not connected</option>${targetOptions(option.nextNodeId)}</select></label>
        </section>`).join("") : `
        <p class="empty-options">No choices. Continue directly to another scene, or leave this as the end.</p>
        <label class="field"><span class="field-label">Continue to</span>
          <select id="node-next"><option value="">End transcript</option>${targetOptions(node.nextNodeId)}</select>
        </label>`}
    </div>`;
}

function selectNode(id) {
  selectedNodeId = id;
  selectedNodeIds = new Set([id]);
  renderGraph();
  renderInspector();
}

function addNodeAt(x, y) {
  const id = createNodeId(tree.nodes);
  tree.nodes[id] = {
    id,
    speaker: tree.characters[0].id,
    text: "new dialogue.",
    options: [],
    position: { x: Math.round(x), y: Math.round(y) },
  };
  selectNode(id);
  persist();
}

function addNode() {
  const rect = viewport.getBoundingClientRect();
  addNodeAt(
    (rect.width / 2 - view.x) / view.scale - NODE_WIDTH / 2,
    (rect.height / 2 - view.y) / view.scale - 30,
  );
}

function deleteNode(nodeId) {
  if (nodeId === tree.startNodeId || Object.keys(tree.nodes).length === 1) return;
  const snapshot = JSON.parse(JSON.stringify(tree));
  delete tree.nodes[nodeId];
  const fallbackId = Object.keys(tree.nodes)[0];
  Object.values(tree.nodes).forEach((item) => {
    item.options.forEach((option) => {
      if (option.nextNodeId === nodeId) option.nextNodeId = null;
    });
    if (item.nextNodeId === nodeId) item.nextNodeId = null;
  });
  selectedNodeId = fallbackId;
  selectedNodeIds = new Set([fallbackId]);
  offerUndo(snapshot, nodeId);
}

function fitView() {
  const nodes = Object.values(tree.nodes);
  if (!nodes.length) return;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => node.position.y + 200));
  const scale = Math.min(1, (viewport.clientWidth - 100) / (maxX - minX), (viewport.clientHeight - 100) / (maxY - minY));
  view.scale = Math.max(.35, scale);
  view.x = (viewport.clientWidth - (maxX - minX) * view.scale) / 2 - minX * view.scale;
  view.y = (viewport.clientHeight - (maxY - minY) * view.scale) / 2 - minY * view.scale;
  applyView();
}

nodeLayer.addEventListener("pointerdown", (event) => {
  if (event.button === 2) return;
  const element = event.target.closest(".graph-node");
  if (!element) return;
  const port = event.target.closest(".port");
  if (event.target.closest("input, textarea, select, button")) return;
  if (event.target.closest(".inline-editor") && !port) return;
  event.stopPropagation();
  const node = tree.nodes[element.dataset.nodeId];
  if (port) {
    event.preventDefault();
    const row = port.closest(".node-option");
    const optionIndex = row?.hasAttribute("data-option-index") ? Number(row.dataset.optionIndex) : null;
    const startX = node.position.x + NODE_WIDTH;
    const startY = node.position.y + row.offsetTop + row.offsetHeight / 2;
    const rect = viewport.getBoundingClientRect();
    pointerAction = {
      type: "connection",
      sourceNodeId: node.id,
      optionIndex,
      startX,
      startY,
      endX: (event.clientX - rect.left - view.x) / view.scale,
      endY: (event.clientY - rect.top - view.y) / view.scale,
    };
    selectedNodeId = node.id;
    selectedNodeIds = new Set([node.id]);
    renderGraph();
    renderInspector();
    return;
  }
  if (!selectedNodeIds.has(node.id)) {
    selectedNodeId = node.id;
    selectedNodeIds = new Set([node.id]);
    renderGraph();
    renderInspector();
  }
  pointerAction = {
    type: "node",
    startX: event.clientX,
    startY: event.clientY,
    nodes: [...selectedNodeIds].map((id) => tree.nodes[id]).filter(Boolean)
      .map((item) => ({ node: item, x: item.position.x, y: item.position.y })),
  };
});

nodeLayer.addEventListener("input", (event) => {
  const element = event.target.closest(".graph-node");
  const node = tree.nodes[element?.dataset.nodeId];
  if (!node) return;
  if (event.target.dataset.nodeField === "text") {
    node.text = event.target.value;
    resizeTextarea(event.target);
    drawEdges();
  }
  else if (event.target.dataset.nodeField === "speaker") {
    node.speaker = event.target.value;
    renderGraph();
  } else if (event.target.dataset.optionField) {
    const optionElement = event.target.closest("[data-option-index]");
    node.options[Number(optionElement.dataset.optionIndex)][event.target.dataset.optionField] = event.target.value;
  } else return;
  persist();
});

nodeLayer.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const element = event.target.closest(".graph-node");
  const node = tree.nodes[element?.dataset.nodeId];
  if (!node) return;
  if (action === "add-option") {
    node.nextNodeId = null;
    node.options.push({ text: "new option", nextNodeId: null });
  } else if (action === "remove-option") {
    const optionElement = event.target.closest("[data-option-index]");
    node.options.splice(Number(optionElement.dataset.optionIndex), 1);
  } else if (action === "delete-node") {
    deleteNode(node.id);
  }
  renderGraph();
  renderInspector();
  persist(true);
});

viewport.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".graph-node")) return;
  if (event.button === 2) return;
  event.preventDefault();
  if (event.button === 0) {
    selectedNodeId = null;
    selectedNodeIds.clear();
    renderGraph();
    renderInspector();
  }
  if (event.shiftKey && event.button === 0) {
    const rect = viewport.getBoundingClientRect();
    pointerAction = {
      type: "selection",
      startX: event.clientX,
      startY: event.clientY,
      viewportX: event.clientX - rect.left,
      viewportY: event.clientY - rect.top,
    };
    selectionBox.hidden = false;
    selectionBox.style.left = `${pointerAction.viewportX}px`;
    selectionBox.style.top = `${pointerAction.viewportY}px`;
    selectionBox.style.width = "0";
    selectionBox.style.height = "0";
  } else {
    pointerAction = { type: "pan", startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    viewport.classList.add("panning");
  }
  viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const element = event.target.closest(".graph-node");
  if (element) {
    const nodeId = element.dataset.nodeId;
    if (nodeId === tree.startNodeId) return;
    deleteNode(nodeId);
    renderGraph();
    renderInspector();
    persist(true);
    return;
  }
  const rect = viewport.getBoundingClientRect();
  const worldX = (event.clientX - rect.left - view.x) / view.scale;
  const worldY = (event.clientY - rect.top - view.y) / view.scale;
  addNodeAt(worldX - NODE_WIDTH / 2, worldY - 30);
});

window.addEventListener("pointermove", (event) => {
  if (!pointerAction) return;
  const dx = event.clientX - pointerAction.startX;
  const dy = event.clientY - pointerAction.startY;
  if (pointerAction.type === "connection") {
    const rect = viewport.getBoundingClientRect();
    pointerAction.endX = (event.clientX - rect.left - view.x) / view.scale;
    pointerAction.endY = (event.clientY - rect.top - view.y) / view.scale;
    drawEdges();
  } else if (pointerAction.type === "selection") {
    const rect = viewport.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const left = Math.min(pointerAction.viewportX, currentX);
    const top = Math.min(pointerAction.viewportY, currentY);
    const right = Math.max(pointerAction.viewportX, currentX);
    const bottom = Math.max(pointerAction.viewportY, currentY);
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${right - left}px`;
    selectionBox.style.height = `${bottom - top}px`;

    const worldLeft = (left - view.x) / view.scale;
    const worldTop = (top - view.y) / view.scale;
    const worldRight = (right - view.x) / view.scale;
    const worldBottom = (bottom - view.y) / view.scale;
    selectedNodeIds = new Set(Object.values(tree.nodes).filter((item) => {
      const element = nodeLayer.querySelector(`[data-node-id="${CSS.escape(item.id)}"]`);
      return item.position.x <= worldRight && item.position.x + NODE_WIDTH >= worldLeft
        && item.position.y <= worldBottom && item.position.y + (element?.offsetHeight ?? 120) >= worldTop;
    }).map((item) => item.id));
    nodeLayer.querySelectorAll(".graph-node").forEach((element) => {
      element.classList.toggle("selected", selectedNodeIds.has(element.dataset.nodeId));
    });
    drawEdges();
  } else if (pointerAction.type === "pan") {
    view.x = pointerAction.x + dx;
    view.y = pointerAction.y + dy;
    applyView();
  } else {
    pointerAction.nodes.forEach((item) => {
      item.node.position.x = Math.round(item.x + dx / view.scale);
      item.node.position.y = Math.round(item.y + dy / view.scale);
      const element = nodeLayer.querySelector(`[data-node-id="${CSS.escape(item.node.id)}"]`);
      if (element) {
        element.style.left = `${item.node.position.x}px`;
        element.style.top = `${item.node.position.y}px`;
      }
    });
    drawEdges();
  }
});

window.addEventListener("pointerup", (event) => {
  if (pointerAction?.type === "connection") {
    const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest(".graph-node");
    const source = tree.nodes[pointerAction.sourceNodeId];
    const target = tree.nodes[targetElement?.dataset.nodeId];
    if (source && target) {
      if (pointerAction.optionIndex === null) source.nextNodeId = target.id;
      else source.options[pointerAction.optionIndex].nextNodeId = target.id;
      persist(true);
    } else if (source) {
      if (pointerAction.optionIndex === null) source.nextNodeId = null;
      else source.options[pointerAction.optionIndex].nextNodeId = null;
      persist(true);
    }
    pointerAction = null;
    renderGraph();
    renderInspector();
    viewport.classList.remove("panning");
    return;
  }
  if (pointerAction?.type === "selection") {
    selectionBox.hidden = true;
    selectedNodeId = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
    pointerAction = null;
    renderGraph();
    renderInspector();
    return;
  }
  if (pointerAction?.type === "node") persist(true);
  pointerAction = null;
  viewport.classList.remove("panning");
});

viewport.addEventListener("wheel", (event) => {
  if (event.target.closest("input, textarea, select")) return;
  event.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const worldX = (mouseX - view.x) / view.scale;
  const worldY = (mouseY - view.y) / view.scale;
  const nextScale = Math.min(1.6, Math.max(.3, view.scale * (event.deltaY > 0 ? .9 : 1.1)));
  view.x = mouseX - worldX * nextScale;
  view.y = mouseY - worldY * nextScale;
  view.scale = nextScale;
  applyView();
}, { passive: false });

inspector.addEventListener("input", (event) => {
  const node = tree.nodes[selectedNodeId];
  if (event.target.id === "node-text") node.text = event.target.value;
  if (event.target.id === "node-speaker") node.speaker = event.target.value;
  if (event.target.id === "node-next") node.nextNodeId = event.target.value || null;
  const option = event.target.closest("[data-option-index]");
  if (option && event.target.dataset.field)
    node.options[Number(option.dataset.optionIndex)][event.target.dataset.field] = event.target.value;
  renderGraph();
  persist();
});

inspector.addEventListener("click", (event) => {
  const node = tree.nodes[selectedNodeId];
  if (event.target.id === "add-option") {
    node.nextNodeId = null;
    node.options.push({ text: "NEW OPTION", nextNodeId: tree.startNodeId });
  }
  else if (event.target.matches(".remove-option")) node.options.splice(Number(event.target.closest("[data-option-index]").dataset.optionIndex), 1);
  else if (event.target.id === "delete-node") {
    deleteNode(selectedNodeId);
  } else return;
  renderGraph();
  renderInspector();
  persist();
});

document.querySelector("#add-node").addEventListener("click", addNode);
document.querySelector("#fit-view").addEventListener("click", fitView);
document.querySelector("#undo-delete").addEventListener("click", () => {
  if (!deletedSnapshot) return;
  tree = deletedSnapshot.tree;
  selectedNodeId = deletedSnapshot.selectedId;
  selectedNodeIds = new Set([selectedNodeId]);
  deletedSnapshot = null;
  clearTimeout(undoTimer);
  undoToast.hidden = true;
  renderGraph();
  renderInspector();
  persist(true);
});
document.querySelector("#reset-tree").addEventListener("click", () => {
  if (!confirm("RESET THE ENTIRE DIALOGUE GRAPH?")) return;
  tree = resetDialogueTree();
  selectedNodeId = tree.startNodeId;
  selectedNodeIds = new Set([selectedNodeId]);
  ensurePositions();
  renderGraph();
  renderInspector();
  fitView();
  persist(true);
});

window.addEventListener("storage", () => {
  tree = loadDialogueTree();
  ensurePositions();
  if (selectedNodeId && !tree.nodes[selectedNodeId]) selectedNodeId = tree.startNodeId;
  selectedNodeIds = new Set([...selectedNodeIds].filter((id) => tree.nodes[id]));
  if (selectedNodeId) selectedNodeIds.add(selectedNodeId);
  renderGraph();
  renderInspector();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (document.activeElement?.matches("input, textarea, select")) return;
  if (!selectedNodeId || selectedNodeId === tree.startNodeId) return;
  event.preventDefault();
  deleteNode(selectedNodeId);
  renderGraph();
  renderInspector();
  persist(true);
});

ensurePositions();
applyView();
renderGraph();
renderInspector();
requestAnimationFrame(fitView);
