"use strict";

const byId = (id) => document.getElementById(id);
const canvas = byId("gradient");
const preview = byId("preview");
const style = byId("style");
const shape = byId("shape");
const width = byId("width");
const height = byId("height");
const warp = byId("warp");
const size = byId("size");
const noise = byId("noise");
const list = byId("colors");
const status = byId("status");
const upload = byId("photo-input");
const download = byId("download");
const maxColors = 12;

let colors = ["92B3C9", "C6D1D1", "7B8E54", "F66E56", "F96656", "F3F4EC"];
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

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = smooth(x - ix);
  const v = smooth(y - iy);
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

const wave = Math.sin;
const warps = {
  "Simplex Noise": (x, y) => valueNoise(x + y * 0.58, y - x * 0.58) * 2 - 1,
  Circular: (x, y, scale) => wave(Math.hypot(x - scale / 2, y - scale / 2) * 4),
  "Value Noise": (x, y) => valueNoise(x, y) * 2 - 1,
  "Worley Noise": (x, y) => cellNoise(x, y, false) * 2 - 1,
  "FBM Noise": (x, y) => valueNoise(x, y) + 0.5 * valueNoise(x * 2, y * 2)
    + 0.25 * valueNoise(x * 4, y * 4) - 0.875,
  "Voronoi Noise": (x, y) => cellNoise(x, y, true) * 2 - 1,
  "Domain Warping": (x, y) => valueNoise(x + 2 * valueNoise(x, y), y + 2 * valueNoise(y, x)) * 2 - 1,
  Waves: (x, y) => wave(3.4 * y + wave(x * 1.7) * 0.8),
  "Smooth Noise": (x, y) => valueNoise(x * 0.4, y * 0.4) * 2 - 1,
  Oval: (x, y, scale) => wave(Math.hypot(x - scale / 2, (y - scale / 2) * 2) * 3),
  Rows: (_x, y) => wave(y * 6),
  Columns: (x) => wave(x * 6),
  Flat: () => 0,
  Gravity: (x, y, scale) => (y / scale) ** 2 * wave((x / scale - 0.5) * 5),
};

function makeSampler(palette, mode) {
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

  if (mesh) {
    const points = palette.map((color, index) => {
      const row = index < columns ? 0 : 1;
      const count = row === 0 ? top.length : bottom.length;
      const column = row === 0 ? index : index - columns;
      return {
        color,
        x: count === 1 ? 0.5 : column / (count - 1),
        y: row === 0 ? 0.12 + (column % 2) * 0.11 : 0.82 - (column % 2) * 0.13,
      };
    });
    return (x, y, output, index, grain) => {
      let red = 0;
      let green = 0;
      let blue = 0;
      let total = 0;
      for (const point of points) {
        const distance = (x - point.x) ** 2 + (y - point.y) ** 2 + 0.012;
        const weight = 1 / (distance * distance);
        red += point.color[0] * weight;
        green += point.color[1] * weight;
        blue += point.color[2] * weight;
        total += weight;
      }
      output[index] = red / total + grain;
      output[index + 1] = green / total + grain;
      output[index + 2] = blue / total + grain;
    };
  }

  return (x, y, output, index, grain) => {
    const topPosition = clamp(x) * (top.length - 1);
    const bottomX = sharp ? (x - 0.39) / 0.45 + 0.5 : x;
    const bottomPosition = clamp(bottomX) * (bottom.length - 1);
    const topLeft = Math.floor(topPosition);
    const bottomLeft = Math.floor(bottomPosition);
    const topRight = Math.min(topLeft + 1, top.length - 1);
    const bottomRight = Math.min(bottomLeft + 1, bottom.length - 1);
    const topT = topPosition - topLeft;
    const bottomT = bottomPosition - bottomLeft;
    const blendY = sharp ? smooth(clamp((y - 0.015) / (0.37 + 0.13 * x))) : clamp(y);
    const t = soft ? smooth(blendY) : blendY;

    for (let c = 0; c < 3; c++) {
      const a = mix(top[topLeft][c], top[topRight][c], soft ? smooth(topT) : topT);
      const b = mix(bottom[bottomLeft][c], bottom[bottomRight][c], sharp || soft ? smooth(bottomT) : bottomT);
      output[index + c] = mix(a, b, t) + grain;
    }
  };
}

function render(target, w, h) {
  target.width = w;
  target.height = h;
  const context = target.getContext("2d", { alpha: false });
  const image = context.createImageData(w, h);
  const sample = makeSampler(colors.map(rgb), style.value);
  const deform = warps[shape.value];
  const amplitude = Number(warp.value) * 0.15;
  const frequency = 2.4 / Number(size.value);
  const grainAmount = Number(noise.value) * 255;
  const dx = 1 / Math.max(1, w - 1);
  const dy = 1 / Math.max(1, h - 1);

  for (let row = 0, index = 0; row < h; row++) {
    const y = row * dy;
    for (let column = 0; column < w; column++, index += 4) {
      const x = column * dx;
      const u = x + amplitude * deform(x * frequency, y * frequency, frequency);
      const v = y + amplitude * deform(y * frequency, x * frequency, frequency);
      sample(u, v, image.data, index, (hash(column, row) - 0.5) * grainAmount);
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
    const scale = Math.min(1, 768 / Math.max(w, h));
    preview.style.aspectRatio = w + " / " + h;
    preview.style.maxHeight = "min(900px, 135vw)";
    preview.style.maxWidth = "min(648px, " + (900 * w / h) + "px)";
    render(canvas, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  });
}

function setStatus(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function removeIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#close");
  svg.append(use);
  return svg;
}

function showColors() {
  list.replaceChildren();
  byId("add").disabled = colors.length >= maxColors;
  colors.forEach((value, index) => {
    const row = document.createElement("li");
    row.className = "color-row";

    const swatch = document.createElement("input");
    swatch.className = "swatch";
    swatch.type = "color";
    swatch.value = "#" + value;
    swatch.setAttribute("aria-label", "Pick color " + (index + 1));

    const field = document.createElement("input");
    field.className = "hex";
    field.value = value;
    field.maxLength = 7;
    field.spellcheck = false;
    field.setAttribute("aria-label", "Hex value for color " + (index + 1));

    const remove = document.createElement("button");
    remove.className = "icon remove";
    remove.setAttribute("aria-label", "Remove color " + (index + 1));
    remove.title = "Remove color";
    remove.disabled = colors.length <= 2;
    remove.append(removeIcon());

    swatch.addEventListener("input", () => {
      colors[index] = swatch.value.slice(1).toUpperCase();
      field.value = colors[index];
      queuePreview();
    });
    field.addEventListener("input", () => {
      const candidate = field.value.replace(/^#/, "").toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(candidate)) return;
      colors[index] = candidate;
      swatch.value = "#" + candidate;
      queuePreview();
    });
    field.addEventListener("blur", () => { field.value = colors[index]; });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") field.blur();
    });
    remove.addEventListener("click", () => {
      colors.splice(index, 1);
      showColors();
      list.children[Math.min(index, colors.length - 1)].querySelector(".hex").focus();
    });
    row.append(swatch, field, remove);
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
