export type InpaintResult = {
  imageData: ImageData;
  hasMask: boolean;
};

const CTX_RADIUS = 5;
const SEARCH_RADIUS = 80;
const SEARCH_STRIDE = 4;
const PATCH_RADIUS = 1;

const computeDistanceMap = (
  mask: Uint8Array,
  w: number,
  h: number
): Float32Array => {
  const dist = new Float32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (!mask[idx]) {
        dist[idx] = 0;
        continue;
      }
      if (
        (x > 0 && !mask[idx - 1]) ||
        (x < w - 1 && !mask[idx + 1]) ||
        (y > 0 && !mask[idx - w]) ||
        (y < h - 1 && !mask[idx + w])
      ) {
        dist[idx] = 1;
        queue.push(idx);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head]!;
    head += 1;
    const cx = idx % w;
    const cy = (idx - cx) / w;
    const d = dist[idx]!;
    for (const [nx, ny] of [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as const) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
        continue;
      }
      const nidx = ny * w + nx;
      if (dist[nidx]! < 0 || dist[nidx]! > d + 1) {
        dist[nidx] = d + 1;
        queue.push(nidx);
      }
    }
  }
  return dist;
};

const isPatchValid = (
  mask: Uint8Array,
  sx: number,
  sy: number,
  w: number,
  h: number
): boolean => {
  const patchSize = 2 * PATCH_RADIUS + 1;
  let hits = 0;
  const total = patchSize * patchSize;
  for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy += 1) {
    for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx += 1) {
      const px = sx + dx;
      const py = sy + dy;
      if (px < 0 || px >= w || py < 0 || py >= h) {
        return false;
      }
      if (mask[py * w + px]) {
        hits += 1;
      }
    }
  }
  return hits < total * 0.05;
};

// eslint-disable-next-line complexity
const contextSSD = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  w: number,
  h: number
): number => {
  let ssd = 0;
  let count = 0;
  for (let dy = -CTX_RADIUS; dy <= CTX_RADIUS; dy += 1) {
    for (let dx = -CTX_RADIUS; dx <= CTX_RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const tx = cx + dx;
      const ty = cy + dy;
      const ssx = sx + dx;
      const ssy = sy + dy;
      if (
        tx < 0 ||
        tx >= w ||
        ty < 0 ||
        ty >= h ||
        ssx < 0 ||
        ssx >= w ||
        ssy < 0 ||
        ssy >= h
      ) {
        continue;
      }
      const tidx = ty * w + tx;
      if (mask[tidx]) {
        continue;
      }
      const sidx = ssy * w + ssx;
      const dr = (r[tidx] ?? 0) - (r[sidx] ?? 0);
      const dg = (g[tidx] ?? 0) - (g[sidx] ?? 0);
      const db = (b[tidx] ?? 0) - (b[sidx] ?? 0);
      ssd += dr * dr + dg * dg + db * db;
      count += 1;
    }
  }
  return count >= 3 ? ssd / count : Number.POSITIVE_INFINITY;
};

const searchRange = (
  center: number,
  radius: number,
  limit: number
): [number, number] => [
  Math.max(PATCH_RADIUS + CTX_RADIUS, center - radius),
  Math.min(limit - PATCH_RADIUS - CTX_RADIUS - 1, center + radius),
];

const findBestPatch = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  cx: number,
  cy: number,
  w: number,
  h: number,
  hintX: number,
  hintY: number
): number => {
  let bestSSD = Number.POSITIVE_INFINITY;
  let bestIdx = -1;
  const [xMin, xMax] = searchRange(cx, SEARCH_RADIUS, w);
  const [yMin, yMax] = searchRange(cy, SEARCH_RADIUS, h);

  const evaluate = (sx: number, sy: number) => {
    const sidx = sy * w + sx;
    if (mask[sidx] || !isPatchValid(mask, sx, sy, w, h)) {
      return;
    }
    const ssd = contextSSD(r, g, b, mask, cx, cy, sx, sy, w, h);
    if (ssd < bestSSD) {
      bestSSD = ssd;
      bestIdx = sidx;
    }
  };

  if (hintX > 0 || hintY > 0) {
    const [hxn, hxx] = searchRange(hintX, 25, w);
    const [hyn, hxy] = searchRange(hintY, 25, h);
    for (let sy = hyn; sy <= hxy; sy += 1) {
      for (let sx = hxn; sx <= hxx; sx += 1) {
        evaluate(sx, sy);
      }
    }
  }

  for (let sy = yMin; sy <= yMax; sy += SEARCH_STRIDE) {
    for (let sx = xMin; sx <= xMax; sx += SEARCH_STRIDE) {
      evaluate(sx, sy);
    }
  }

  if (bestSSD < Number.POSITIVE_INFINITY) {
    for (
      let sy = Math.max(PATCH_RADIUS + CTX_RADIUS, cy - SEARCH_STRIDE + 1);
      sy <= Math.min(h - PATCH_RADIUS - CTX_RADIUS - 1, cy + SEARCH_STRIDE - 1);
      sy += 1
    ) {
      for (
        let sx = Math.max(PATCH_RADIUS + CTX_RADIUS, cx - SEARCH_STRIDE + 1);
        sx <=
        Math.min(w - PATCH_RADIUS - CTX_RADIUS - 1, cx + SEARCH_STRIDE - 1);
        sx += 1
      ) {
        evaluate(sx, sy);
      }
    }
  }
  return bestIdx;
};

const copyPatch = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  srcIdx: number,
  dstIdx: number
): void => {
  r[dstIdx] = r[srcIdx]!;
  g[dstIdx] = g[srcIdx]!;
  b[dstIdx] = b[srcIdx]!;
};

const fillRegion = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  distMap: Float32Array,
  size: number,
  w: number,
  h: number,
  onProgress?: (pct: number) => void
): void => {
  const boundaryPixels: number[] = [];
  for (let i = 0; i < size; i += 1) {
    if (mask[i]) {
      boundaryPixels.push(i);
    }
  }
  boundaryPixels.sort((a, b) => (distMap[a] ?? 0) - (distMap[b] ?? 0));

  let lastX = 0;
  let lastY = 0;
  const total = boundaryPixels.length;

  for (let pi = 0; pi < total; pi += 1) {
    const idx = boundaryPixels[pi]!;
    if (!mask[idx]) {
      continue;
    }
    const px = idx % w;
    const py = (idx - px) / w;
    const mi = findBestPatch(r, g, b, mask, px, py, w, h, lastX, lastY);
    if (mi >= 0) {
      copyPatch(r, g, b, mi, idx);
    }
    mask[idx] = 0;
    lastX = px;
    lastY = py;

    if (onProgress && pi % 100 === 0) {
      onProgress(0.1 + (pi / total) * 0.8);
    }
  }

  onProgress?.(1);
};

const buildResult = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  w: number,
  h: number
): ImageData => {
  const size = w * h;
  const result = new ImageData(w, h);
  for (let i = 0; i < size; i += 1) {
    result.data[i * 4] = Math.max(0, Math.min(255, Math.round(r[i]!)));
    result.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g[i]!)));
    result.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b[i]!)));
    result.data[i * 4 + 3] = 255;
  }
  return result;
};

export const inpaintImage = (
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  onProgress?: (pct: number) => void
): InpaintResult => {
  const { width, height } = sourceCanvas;
  const srcCtx = sourceCanvas.getContext("2d");
  const maskCtx = maskCanvas.getContext("2d");
  if (!srcCtx || !maskCtx) {
    throw new Error("Failed to get canvas context");
  }

  const srcImage = srcCtx.getImageData(0, 0, width, height);
  const maskImage = maskCtx.getImageData(0, 0, width, height);
  const size = width * height;
  const mask = new Uint8Array(size);
  let maskCount = 0;
  for (let i = 0; i < size; i += 1) {
    const alpha = maskImage.data[i * 4 + 3];
    if (alpha !== undefined && alpha > 128) {
      mask[i] = 1;
      maskCount += 1;
    }
  }
  if (maskCount === 0) {
    return {
      hasMask: false,
      imageData: new ImageData(
        new Uint8ClampedArray(srcImage.data),
        width,
        height
      ),
    };
  }

  const r = new Float32Array(size);
  const g = new Float32Array(size);
  const b = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    r[i] = srcImage.data[i * 4]!;
    g[i] = srcImage.data[i * 4 + 1]!;
    b[i] = srcImage.data[i * 4 + 2]!;
  }

  const distMap = computeDistanceMap(mask, width, height);
  fillRegion(r, g, b, mask, distMap, size, width, height, onProgress);

  return { hasMask: true, imageData: buildResult(r, g, b, width, height) };
};

export const drawInpaintedResult = (
  canvas: HTMLCanvasElement,
  result: ImageData
): void => {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.putImageData(result, 0, 0);
  }
};
