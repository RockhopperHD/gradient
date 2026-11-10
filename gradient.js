"use strict";

const byId = (id) => document.getElementById(id);
const canvas = byId("gradient");
const preview = byId("preview");
const pointLayer = byId("color-points");
const style = byId("style");
const shape = byId("shape");
const width = byId("width");
const height = byId("height");
const warp = byId("warp");
const size = byId("size");
const noise = byId("noise");
const list = byId("colors");
const picker = byId("color-picker");
const pickerSquare = byId("picker-square");
const pickerMarker = byId("picker-marker");
const hueSlider = byId("picker-hue");
const status = byId("status");
const upload = byId("photo-input");
const download = byId("download");
const maxColors = 12;

let colors = ["92B3C9", "C6D1D1", "7B8E54", "F66E56", "F96656", "F3F4EC"];
const movedPoints = [];
let pendingFrame = 0;
let importSequence = 0;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rgb = (hex) => [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
const hex = (channels) => channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase();
const dimension = (input) => clamp(Math.round(input.valueAsNumber || 648), 1, 4096);

function hash(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, curve = smooth) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = curve(x - ix);
  const v = curve(y - iy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), u),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}

function cellNoise(x, y, edges) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let nearest = Infinity;
  let next = Infinity;
  for (let row = iy - 1; row <= iy + 1; row++) {
    for (let column = ix - 1; column <= ix + 1; column++) {
      const dx = column + hash(column, row) - x;
      const dy = row + hash(row + 17, column) - y;
      const distance = dx * dx + dy * dy;
      if (distance < nearest) {
        next = nearest;
        nearest = distance;
      } else if (distance < next) {
        next = distance;
      }
    }
  }
  return edges ? Math.sqrt(next) - Math.sqrt(nearest) : Math.sqrt(nearest);
}

const smoother = (t) => t ** 3 * (t * (6 * t - 15) + 10);

function steppedOffset(position) {
  const band = position * 15;
  const step = Math.floor(band);
  return (step + smooth(clamp((band - step) * 4))) / 15 - 0.5;
}

const diagonalWarps = {
  "Simplex Noise": (x, y) => valueNoise(x + y * 0.58, y - x * 0.58) * 2 - 1,
  "Value Noise": (x, y) => valueNoise(x, y) * 2 - 1,
  "Worley Noise": (x, y) => clamp(cellNoise(x, y, false) * 2 - 1, -1, 1),
  "FBM Noise": (x, y) => valueNoise(x, y) + 0.5 * valueNoise(x * 2, y * 2)
    + 0.25 * valueNoise(x * 4, y * 4) - 0.875,
  "Voronoi Noise": (x, y) => clamp(cellNoise(x, y, true) * 2 - 1, -1, 1),
  Waves: (x, y) => (Math.sin(3 * x) + Math.sin(3 * y)) / 3
    + (Math.sin(2.8 * (x - y)) + Math.sin(2.8 * (x + y))) / 6,
  "Smooth Noise": (x, y) => valueNoise(x, y, smoother) * 2 - 1,
};

function makeWarp(preset, strength, scale) {
  if (strength === 0 || scale === 0 || preset === "Flat") {
    return (x, y, point) => { point[0] = x; point[1] = y; };
  }

  // Fade in from zero and keep displacement bounded as the pattern gets denser.
  const sizeGain = scale / (0.65 + scale);
  const amount = strength / 1.5 * 0.32 * sizeGain;
  const diagonal = diagonalWarps[preset];
  if (diagonal) {
    return (x, y, point) => {
      const offset = amount * diagonal(x * scale, y * scale);
      point[0] = x + offset;
      point[1] = y + offset;
    };
  }

  return (x, y, point) => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    let offsetX = 0;
    let offsetY = 0;
    switch (preset) {
      case "Circular": {
        const phase = Math.hypot(dx, dy) * scale * 4;
        offsetX = Math.sin(phase);
        offsetY = Math.cos(phase);
        break;
      }
      case "Domain Warping": {
        const u = x * scale;
        const v = y * scale;
        offsetX = valueNoise(u + valueNoise(u, v), v) * 2 - 1;
        offsetY = valueNoise(u, v + valueNoise(u + 5, v + 5)) * 2 - 1;
        break;
      }
      case "Oval": {
        const falloff = 1 - smooth(clamp(Math.hypot(dx, dy * 1.5) * 1.7));
        offsetX = falloff;
        offsetY = falloff;
        break;
      }
      case "Rows":
        offsetX = steppedOffset(y);
        break;
      case "Columns":
        offsetY = steppedOffset(x);
        break;
      case "Gravity": {
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) + radius * scale;
        const pull = 1 - smooth(clamp(radius / 0.75));
        offsetX = -dx * pull + Math.cos(angle) * radius * pull;
        offsetY = -dy * pull + Math.sin(angle) * radius * pull;
        break;
      }
    }
    point[0] = x + amount * offsetX;
    point[1] = y + amount * offsetY;
  };
}

function defaultPoint(index, count, mode) {
  if (mode === "Simple") {
    const position = index / (count - 1);
    return { x: position, y: position };
  }

  const columns = Math.ceil(count / 2);
  const isTop = index < columns;
  const column = isTop ? index : index - columns;
  const rowLength = isTop ? columns : count - columns;
  const position = rowLength === 1 ? 0.5 : column / (rowLength - 1);
  if (mode === "Mesh Static") {
    return { x: position, y: isTop ? 0.12 + (column % 2) * 0.11 : 0.82 - (column % 2) * 0.13 };
  }
  if (mode === "Mesh Grid") return { x: position, y: isTop ? 0 : 1 };
  return { x: mix(0.12, 0.88, position), y: isTop ? 0.12 : 0.75 };
}

function withMovedPoints(sample, points) {
  // Simple and Mesh Grid interpolate on a fixed layout. Map the moved handles
  // back to that layout so they can reshape it without changing the blend mode.
  const offsets = points.map(({ position, origin }) => ({
    position,
    dx: origin.x - position.x,
    dy: origin.y - position.y,
  }));
  return (x, y, output, index, grain) => {
    let dx = 0;
    let dy = 0;
    let total = 0;
    for (const offset of offsets) {
      const distance = (x - offset.position.x) ** 2 + (y - offset.position.y) ** 2;
      const weight = 1 / (distance + 0.0001);
      dx += offset.dx * weight;
      dy += offset.dy * weight;
      total += weight;
    }
    sample(x + dx / total, y + dy / total, output, index, grain);
  };
}

function makeSampler(palette, mode, points) {
  if (mode === "Simple") {
    return (x, y, output, index, grain) => {
      const position = clamp(x * 0.65 + y * 0.35) * (palette.length - 1);
      const left = Math.floor(position);
      const right = Math.min(left + 1, palette.length - 1);
      for (let c = 0; c < 3; c++) {
        output[index + c] = mix(palette[left][c], palette[right][c], position - left) + grain;
      }
    };
  }

  const columns = Math.ceil(palette.length / 2);
  const top = palette.slice(0, columns);
  const bottom = palette.slice(columns);
  const sharp = mode === "Sharp Bézier";
  const soft = mode === "Soft Bézier";
  const mesh = mode === "Mesh Static";

  if (mesh || sharp || soft) {
    const spread = sharp ? 24 : 9;
    return (x, y, output, index, grain) => {
      let red = 0;
      let green = 0;
      let blue = 0;
      let total = 0;
      for (const { color, position } of points) {
        const distance = (x - position.x) ** 2 + (y - position.y) ** 2;
        const weight = mesh ? 1 / (distance + 0.012) ** 2 : Math.exp(-spread * distance);
        red += color[0] * weight;
        green += color[1] * weight;
        blue += color[2] * weight;
        total += weight;
      }
      output[index] = red / total + grain;
      output[index + 1] = green / total + grain;
      output[index + 2] = blue / total + grain;
    };
  }

  return (x, y, output, index, grain) => {
    const topPosition = clamp(x) * (top.length - 1);
    const bottomPosition = clamp(x) * (bottom.length - 1);
    const topLeft = Math.floor(topPosition);
    const bottomLeft = Math.floor(bottomPosition);
    const topRight = Math.min(topLeft + 1, top.length - 1);
    const bottomRight = Math.min(bottomLeft + 1, bottom.length - 1);
    const topT = topPosition - topLeft;
    const bottomT = bottomPosition - bottomLeft;
    const t = clamp(y);

    for (let c = 0; c < 3; c++) {
      const a = mix(top[topLeft][c], top[topRight][c], topT);
      const b = mix(bottom[bottomLeft][c], bottom[bottomRight][c], bottomT);
      output[index + c] = mix(a, b, t) + grain;
    }
  };
}

function render(target, w, h) {
  target.width = w;
  target.height = h;
  const context = target.getContext("2d", { alpha: false });
  const image = context.createImageData(w, h);
  const mode = style.value;
  const palette = colors.map(rgb);
  const points = palette.map((color, index) => {
    const origin = defaultPoint(index, palette.length, mode);
    return { color, origin, position: movedPoints[index] ?? origin };
  });
  const baseSample = makeSampler(palette, mode, points);
  let sample = baseSample;
  if ((mode === "Simple" || mode === "Mesh Grid") && movedPoints.some(Boolean)) {
    sample = withMovedPoints(baseSample, points);
  }
  const deform = makeWarp(shape.value, Number(warp.value), Number(size.value));
  const point = [0, 0];
  const grainAmount = Number(noise.value) * 255;
  const dx = 1 / Math.max(1, w - 1);
  const dy = 1 / Math.max(1, h - 1);

  for (let row = 0, index = 0; row < h; row++) {
    const y = row * dy;
    for (let column = 0; column < w; column++, index += 4) {
      const x = column * dx;
      deform(x, y, point);
      sample(point[0], point[1], image.data, index, (hash(column, row) - 0.5) * grainAmount);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function queuePreview() {
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    const w = dimension(width);
    const h = dimension(height);
    const longestSide = Math.max(w, h);
    const scale = Math.min(1, 768 / longestSide);
    preview.style.width = w / longestSide * 100 + "%";
    preview.style.height = h / longestSide * 100 + "%";
    updatePointHandles();
    render(canvas, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  });
}

function setStatus(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function rowIcon(pathData) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function updatePointHandles() {
  colors.forEach((color, index) => {
    const handle = pointLayer.children[index];
    const position = movedPoints[index] ?? defaultPoint(index, colors.length, style.value);
    handle.style.left = position.x * 100 + "%";
    handle.style.top = position.y * 100 + "%";
    handle.style.setProperty("--point-color", "#" + color);
    handle.setAttribute("aria-label", "Move color " + (index + 1) + ", #" + color);
  });
}

function movePoint(index, x, y) {
  movedPoints[index] = { x: clamp(x), y: clamp(y) };
  queuePreview();
}

const arrowOffsets = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function makePointHandle(index) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "color-point";
  let drag;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const center = handle.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      dx: event.clientX - center.left - center.width / 2,
      dy: event.clientY - center.top - center.height / 2,
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const bounds = pointLayer.getBoundingClientRect();
    movePoint(index, (event.clientX - bounds.left - drag.dx) / bounds.width,
      (event.clientY - bounds.top - drag.dy) / bounds.height);
  });
  handle.addEventListener("lostpointercapture", (event) => {
    if (drag?.id === event.pointerId) drag = undefined;
  });
  handle.addEventListener("keydown", (event) => {
    const offset = arrowOffsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const point = movedPoints[index] ?? defaultPoint(index, colors.length, style.value);
    const step = event.shiftKey ? 0.05 : 0.01;
    movePoint(index, point.x + offset[0] * step, point.y + offset[1] * step);
  });
  return handle;
}

let activePicker;
let pickerColor;

function toHsv(color) {
  const [red, green, blue] = rgb(color).map((channel) => channel / 255);
  const value = Math.max(red, green, blue);
  const chroma = value - Math.min(red, green, blue);
  let sector = 0;
  if (chroma) {
    if (value === red) sector = (green - blue) / chroma;
    else if (value === green) sector = 2 + (blue - red) / chroma;
    else sector = 4 + (red - green) / chroma;
  }
  return { hue: (sector * 60 + 360) % 360, saturation: value ? chroma / value : 0, value };
}

function fromHsv({ hue, saturation, value }) {
  const sector = hue / 60;
  const chroma = value * saturation;
  const middle = chroma * (1 - Math.abs(sector % 2 - 1));
  const channels = [
    [chroma, middle, 0], [middle, chroma, 0], [0, chroma, middle],
    [0, middle, chroma], [middle, 0, chroma], [chroma, 0, middle],
  ][Math.floor(sector)];
  return hex(channels.map((channel) => clamp(channel + value - chroma) * 255));
}

function updatePicker() {
  const { hue, saturation, value } = pickerColor;
  pickerSquare.style.setProperty("--picker-hue", "hsl(" + hue + " 100% 50%)");
  pickerMarker.style.left = saturation * 100 + "%";
  pickerMarker.style.top = (1 - value) * 100 + "%";
  hueSlider.value = Math.min(359, Math.round(hue));
  pickerSquare.setAttribute("aria-valuenow", Math.round(saturation * 100));
  pickerSquare.setAttribute("aria-valuetext",
    Math.round(saturation * 100) + "% saturation, " + Math.round(value * 100) + "% brightness");
}

function positionPicker() {
  if (!activePicker || !picker.matches(":popover-open")) return;
  const anchor = activePicker.swatch.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  const above = anchor.top - picker.offsetHeight - gap;
  const top = above >= margin ? above : anchor.bottom + gap;
  picker.style.left = clamp(anchor.left, margin, window.innerWidth - picker.offsetWidth - margin) + "px";
  picker.style.top = clamp(top, margin, window.innerHeight - picker.offsetHeight - margin) + "px";
}

function openPicker(swatch, color, apply) {
  if (picker.matches(":popover-open")) {
    picker.hidePopover();
    if (activePicker?.swatch === swatch) return;
  }
  activePicker?.swatch.setAttribute("aria-expanded", "false");
  activePicker = { swatch, apply };
  pickerColor = toHsv(color);
  updatePicker();
  swatch.setAttribute("aria-expanded", "true");
  picker.showPopover({ source: swatch });
  positionPicker();
}

picker.addEventListener("toggle", () => {
  if (picker.matches(":popover-open")) return;
  activePicker?.swatch.setAttribute("aria-expanded", "false");
  activePicker = undefined;
});
window.addEventListener("resize", positionPicker);
window.addEventListener("scroll", positionPicker, { capture: true, passive: true });

function applyPickerColor() {
  updatePicker();
  activePicker.apply(fromHsv(pickerColor));
}

function pickSquarePosition(event) {
  const bounds = pickerSquare.getBoundingClientRect();
  pickerColor.saturation = clamp((event.clientX - bounds.left) / bounds.width);
  pickerColor.value = 1 - clamp((event.clientY - bounds.top) / bounds.height);
  applyPickerColor();
}

pickerSquare.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  pickerSquare.setPointerCapture(event.pointerId);
  pickSquarePosition(event);
});
pickerSquare.addEventListener("pointermove", (event) => {
  if (pickerSquare.hasPointerCapture(event.pointerId)) pickSquarePosition(event);
});
pickerSquare.addEventListener("keydown", (event) => {
  const offset = arrowOffsets[event.key];
  if (!offset) return;
  event.preventDefault();
  const step = event.shiftKey ? 0.05 : 0.01;
  pickerColor.saturation = clamp(pickerColor.saturation + offset[0] * step);
  pickerColor.value = clamp(pickerColor.value - offset[1] * step);
  applyPickerColor();
});
hueSlider.addEventListener("input", () => {
  pickerColor.hue = hueSlider.valueAsNumber;
  applyPickerColor();
});

let colorDrag;

function moveColor(from, to) {
  movedPoints.length = colors.length;
  colors.splice(to, 0, colors.splice(from, 1)[0]);
  movedPoints.splice(to, 0, movedPoints.splice(from, 1)[0]);
  showColors();
  list.children[to].querySelector(".row-grip").focus({ preventScroll: true });
}

function finishColorDrag(event, commit) {
  if (colorDrag?.pointerId !== event.pointerId) return;
  const { from, to, row } = colorDrag;
  colorDrag = undefined;

  const rows = Array.from(list.children);
  const positions = rows.map((item) => item.getBoundingClientRect().top);
  const target = commit ? to : from;
  if (target !== from) {
    positions.splice(target, 0, positions.splice(from, 1)[0]);
    moveColor(from, target);
  } else {
    delete row.dataset.dragging;
    rows.forEach((item) => item.style.removeProperty("--row-offset"));
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches || target === from) return;
  Array.from(list.children).forEach((item, index) => {
    const offset = positions[index] - item.getBoundingClientRect().top;
    if (Math.abs(offset) < 1 && index !== target) return;
    item.animate([
      { transform: "translateY(" + offset + "px)" + (index === target ? " scale(1.025)" : "") },
      { transform: "translateY(0)" },
    ], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}

list.addEventListener("pointermove", (event) => {
  if (colorDrag?.pointerId !== event.pointerId) return;
  const { from, to, row, startY, rowHeight } = colorDrag;
  const distance = event.clientY - list.getBoundingClientRect().top - startY;
  row.style.setProperty("--row-offset", distance + "px");

  const next = clamp(from + Math.round(distance / rowHeight), 0, colors.length - 1);
  if (next === to) return;
  Array.from(list.children).forEach((item, index) => {
    if (index === from) return;
    let shift = 0;
    if (index > from && index <= next) shift = -rowHeight;
    if (index < from && index >= next) shift = rowHeight;
    item.style.setProperty("--row-offset", shift + "px");
  });
  colorDrag.to = next;
});
list.addEventListener("pointerup", (event) => finishColorDrag(event, true));
list.addEventListener("lostpointercapture", (event) => finishColorDrag(event, false));

function makeRowGrip(row, index) {
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "icon row-grip";
  grip.title = "Drag to reorder";
  grip.setAttribute("aria-label", "Reorder color " + (index + 1) + ". Use Up and Down to move.");
  const dots = document.createElement("span");
  dots.className = "grip-dots";
  dots.setAttribute("aria-hidden", "true");
  grip.append(dots);

  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || colorDrag) return;
    colorDrag = {
      pointerId: event.pointerId,
      row,
      from: index,
      to: index,
      startY: event.clientY - list.getBoundingClientRect().top,
      rowHeight: row.getBoundingClientRect().height,
    };
    row.dataset.dragging = "";
    list.setPointerCapture(event.pointerId);
  });
  grip.addEventListener("keydown", (event) => {
    if (colorDrag || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const next = clamp(index + (event.key === "ArrowUp" ? -1 : 1), 0, colors.length - 1);
    if (next !== index) moveColor(index, next);
  });
  return grip;
}

function showColors() {
  if (colorDrag) {
    const { pointerId } = colorDrag;
    colorDrag = undefined;
    if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId);
  }
  if (picker.matches(":popover-open")) picker.hidePopover();
  list.replaceChildren();
  pointLayer.replaceChildren(...colors.map((_, index) => makePointHandle(index)));
  updatePointHandles();
  byId("add").disabled = colors.length >= maxColors;
  colors.forEach((value, index) => {
    const row = document.createElement("li");
    row.className = "color-row";

    const swatch = document.createElement("button");
    swatch.className = "swatch";
    swatch.type = "button";
    swatch.style.backgroundColor = "#" + value;
    swatch.setAttribute("aria-label", "Pick color " + (index + 1));
    swatch.setAttribute("aria-haspopup", "dialog");
    swatch.setAttribute("aria-expanded", "false");
    swatch.setAttribute("popovertarget", picker.id);

    const field = document.createElement("input");
    field.className = "hex";
    field.value = value;
    field.maxLength = 7;
    field.spellcheck = false;
    field.setAttribute("aria-label", "Hex value for color " + (index + 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon";
    remove.setAttribute("aria-label", "Remove color " + (index + 1));
    remove.title = "Remove color";
    remove.disabled = colors.length <= 2;
    remove.append(rowIcon("M5 12h14"));

    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.className = "icon";
    duplicate.setAttribute("aria-label", "Duplicate color " + (index + 1));
    duplicate.title = "Duplicate color";
    duplicate.disabled = colors.length >= maxColors;
    duplicate.append(rowIcon("M12 5v14M5 12h14"));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(remove, duplicate);

    const setColor = (color) => {
      colors[index] = color;
      swatch.style.backgroundColor = "#" + color;
      queuePreview();
    };
    swatch.addEventListener("click", (event) => {
      event.preventDefault();
      openPicker(swatch, colors[index], (color) => {
        setColor(color);
        field.value = color;
      });
    });
    field.addEventListener("input", () => {
      const candidate = field.value.replace(/^#/, "").toUpperCase();
      if (/^[0-9A-F]{6}$/.test(candidate)) setColor(candidate);
    });
    field.addEventListener("blur", () => { field.value = colors[index]; });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") field.blur();
    });
    remove.addEventListener("click", () => {
      colors.splice(index, 1);
      movedPoints.splice(index, 1);
      showColors();
      list.children[Math.min(index, colors.length - 1)].querySelector(".hex").focus();
    });
    duplicate.addEventListener("click", () => {
      movedPoints.length = colors.length;
      colors.splice(index + 1, 0, colors[index]);
      movedPoints.splice(index + 1, 0, undefined);
      showColors();
      list.children[index + 1].querySelector(".hex").focus();
    });
    row.append(makeRowGrip(row, index), swatch, field, actions);
    list.append(row);
  });
  queuePreview();
}

async function importPhoto(file) {
  if (!file) return;
  const sequence = ++importSequence;
  const url = URL.createObjectURL(file);
  setStatus();
  try {
    const photo = new Image();
    photo.src = url;
    await photo.decode();
    if (sequence !== importSequence) return;

    const source = document.createElement("canvas");
    source.width = 90;
    source.height = 60;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 90, 60);
    context.drawImage(photo, 0, 0, 90, 60);
    colors = Array.from({ length: 6 }, (_, index) => {
      const x = (index % 3) * 30;
      const y = Math.floor(index / 3) * 30;
      const pixels = context.getImageData(x, y, 30, 30).data;
      const totals = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) {
        for (let c = 0; c < 3; c++) totals[c] += pixels[i + c];
      }
      return hex(totals.map((value) => value / 900));
    });
    movedPoints.length = 0;
    showColors();
  } catch {
    if (sequence === importSequence) setStatus("This image couldn’t be opened. Try a PNG or JPEG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

for (const control of [style, shape, width, height]) control.addEventListener("input", queuePreview);
for (const input of [width, height]) {
  input.addEventListener("change", () => {
    input.value = dimension(input);
    queuePreview();
  });
}
for (const slider of [warp, size, noise]) {
  const update = () => {
    const progress = (slider.value - slider.min) / (slider.max - slider.min);
    slider.style.setProperty("--fill", progress * 100 + "%");
    queuePreview();
  };
  slider.addEventListener("input", update);
  update();
}
byId("import").addEventListener("click", () => upload.click());
upload.addEventListener("change", () => {
  importPhoto(upload.files[0]);
  upload.value = "";
});
preview.addEventListener("dragover", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  preview.dataset.drop = "";
});
preview.addEventListener("dragleave", () => { delete preview.dataset.drop; });
preview.addEventListener("drop", (event) => {
  event.preventDefault();
  delete preview.dataset.drop;
  importPhoto(event.dataTransfer.files[0]);
});
byId("shuffle").addEventListener("click", () => {
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  showColors();
});
byId("add").addEventListener("click", () => {
  if (colors.length >= maxColors) return;
  colors.push(hex(Array.from({ length: 3 }, () => Math.floor(Math.random() * 256))));
  showColors();
  list.lastElementChild.querySelector(".hex").focus();
});
download.addEventListener("click", () => {
  setStatus();
  download.disabled = true;
  const output = document.createElement("canvas");
  try {
    render(output, dimension(width), dimension(height));
    output.toBlob((blob) => {
      download.disabled = false;
      if (!blob) {
        setStatus("The gradient couldn’t be exported. Try smaller dimensions.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "photo-gradient.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  } catch {
    download.disabled = false;
    setStatus("The gradient couldn’t be exported. Try smaller dimensions.");
  }
});

showColors();
