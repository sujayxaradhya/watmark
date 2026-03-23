export type InpaintResult = {
  imageData: ImageData;
  hasMask: boolean;
};

const CTX_RADIUS = 5;
const SEARCH_RADIUS = 100;
const SEARCH_STRIDE = 3;
const SMOOTH_RADIUS = 3;
const SMOOTH_THRESHOLD = 30;
const BLEND_BAND = 15;
const BILATERAL_RADIUS = 3;
const BILATERAL_SIGMA_S = 3;
const BILATERAL_SIGMA_R = 20;

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

const diffusionFill = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  maxIter: number
): void => {
  const size = w * h;
  let changed = true;
  let iter = 0;
  while (changed && iter < maxIter) {
    changed = false;
    iter += 1;
    for (let i = 0; i < size; i += 1) {
      if (!mask[i]) {
        continue;
      }
      const x = i % w;
      const y = (i - x) / w;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let cc = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
            continue;
          }
          const ni = ny * w + nx;
          if (!mask[ni]) {
            const wt = 1 / (Math.abs(dx) + Math.abs(dy));
            cr += (r[ni] ?? 0) * wt;
            cg += (g[ni] ?? 0) * wt;
            cb += (b[ni] ?? 0) * wt;
            cc += wt;
          }
        }
      }
      if (cc > 0) {
        r[i] = cr / cc;
        g[i] = cg / cc;
        b[i] = cb / cc;
        mask[i] = 0;
        changed = true;
      }
    }
  }
};

const isPatchValid = (
  mask: Uint8Array,
  sx: number,
  sy: number,
  w: number,
  h: number
): boolean => {
  let hits = 0;
  const total = (2 * CTX_RADIUS + 1) ** 2;
  for (let dy = -CTX_RADIUS; dy <= CTX_RADIUS; dy += 1) {
    for (let dx = -CTX_RADIUS; dx <= CTX_RADIUS; dx += 1) {
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
  return hits < total * 0.1;
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
  Math.max(CTX_RADIUS, center - radius),
  Math.min(limit - CTX_RADIUS - 1, center + radius),
];

const findBestPixel = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  cx: number,
  cy: number,
  w: number,
  h: number,
  hx: number,
  hy: number
): number => {
  let bestSSD = Number.POSITIVE_INFINITY;
  let bestIdx = -1;
  const [xMin, xMax] = searchRange(cx, SEARCH_RADIUS, w);
  const [yMin, yMax] = searchRange(cy, SEARCH_RADIUS, h);
  const eval_ = (sx: number, sy: number) => {
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
  if (hx > 0 || hy > 0) {
    const [hxn, hxx] = searchRange(hx, 30, w);
    const [hyn, hxy] = searchRange(hy, 30, h);
    for (let sy = hyn; sy <= hxy; sy += 1) {
      for (let sx = hxn; sx <= hxx; sx += 1) {
        eval_(sx, sy);
      }
    }
  }
  for (let sy = yMin; sy <= yMax; sy += SEARCH_STRIDE) {
    for (let sx = xMin; sx <= xMax; sx += SEARCH_STRIDE) {
      eval_(sx, sy);
    }
  }
  if (bestSSD < Number.POSITIVE_INFINITY) {
    for (
      let sy = Math.max(CTX_RADIUS, cy - SEARCH_STRIDE + 1);
      sy <= Math.min(h - CTX_RADIUS - 1, cy + SEARCH_STRIDE - 1);
      sy += 1
    ) {
      for (
        let sx = Math.max(CTX_RADIUS, cx - SEARCH_STRIDE + 1);
        sx <= Math.min(w - CTX_RADIUS - 1, cx + SEARCH_STRIDE - 1);
        sx += 1
      ) {
        eval_(sx, sy);
      }
    }
  }
  return bestIdx;
};

const smoothPixel = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  idx: number,
  w: number,
  h: number
): { r: number; g: number; b: number } => {
  const cx = idx % w;
  const cy = (idx - cx) / w;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let c = 0;
  for (let dy = -SMOOTH_RADIUS; dy <= SMOOTH_RADIUS; dy += 1) {
    for (let dx = -SMOOTH_RADIUS; dx <= SMOOTH_RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
        continue;
      }
      const nidx = ny * w + nx;
      sr += r[nidx] ?? 0;
      sg += g[nidx] ?? 0;
      sb += b[nidx] ?? 0;
      c += 1;
    }
  }
  if (c === 0) {
    return { r: r[idx] ?? 0, g: g[idx] ?? 0, b: b[idx] ?? 0 };
  }
  const ar = sr / c;
  const ag = sg / c;
  const ab = sb / c;
  const cr = r[idx] ?? 0;
  const cg = g[idx] ?? 0;
  const cb = b[idx] ?? 0;
  if (
    Math.abs(cr - ar) + Math.abs(cg - ag) + Math.abs(cb - ab) >
    SMOOTH_THRESHOLD
  ) {
    return { r: (cr + ar) / 2, g: (cg + ag) / 2, b: (cb + ab) / 2 };
  }
  return { r: cr, g: cg, b: cb };
};

const applySmoothing = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  distMap: Float32Array,
  w: number,
  h: number
) => {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (distMap[idx]! > 0 && distMap[idx]! <= 10) {
        const s = smoothPixel(r, g, b, idx, w, h);
        r[idx] = s.r;
        g[idx] = s.g;
        b[idx] = s.b;
      }
    }
  }
};

const bilateralPixel = (
  sr: Float32Array,
  sg: Float32Array,
  sb: Float32Array,
  x: number,
  y: number,
  w: number,
  h: number
): { r: number; g: number; b: number } => {
  const cr = sr[y * w + x] ?? 0;
  const cg = sg[y * w + x] ?? 0;
  const cb = sb[y * w + x] ?? 0;
  let ws = 0;
  let rs = 0;
  let gs = 0;
  let bs = 0;
  for (let ky = -BILATERAL_RADIUS; ky <= BILATERAL_RADIUS; ky += 1) {
    for (let kx = -BILATERAL_RADIUS; kx <= BILATERAL_RADIUS; kx += 1) {
      const nx = x + kx;
      const ny = y + ky;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
        continue;
      }
      const nidx = ny * w + nx;
      const nr = sr[nidx] ?? 0;
      const ng = sg[nidx] ?? 0;
      const nb = sb[nidx] ?? 0;
      const wt =
        Math.exp(
          -(kx * kx + ky * ky) / (2 * BILATERAL_SIGMA_S * BILATERAL_SIGMA_S)
        ) *
        Math.exp(
          -((nr - cr) ** 2 + (ng - cg) ** 2 + (nb - cb) ** 2) /
            (2 * BILATERAL_SIGMA_R * BILATERAL_SIGMA_R)
        );
      ws += wt;
      rs += nr * wt;
      gs += ng * wt;
      bs += nb * wt;
    }
  }
  return { r: rs / ws, g: gs / ws, b: bs / ws };
};

const bilateralFilter = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  distMap: Float32Array,
  w: number,
  h: number
): void => {
  const size = w * h;
  const tr = new Float32Array(size);
  const tg = new Float32Array(size);
  const tb = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    if (distMap[i]! > 0) {
      const f = bilateralPixel(r, g, b, i % w, (i - (i % w)) / w, w, h);
      tr[i] = f.r;
      tg[i] = f.g;
      tb[i] = f.b;
    } else {
      tr[i] = r[i]!;
      tg[i] = g[i]!;
      tb[i] = b[i]!;
    }
  }
  for (let i = 0; i < size; i += 1) {
    if (distMap[i]! > 0) {
      const f = bilateralPixel(tr, tg, tb, i % w, (i - (i % w)) / w, w, h);
      r[i] = f.r;
      g[i] = f.g;
      b[i] = f.b;
    }
  }
};

const blendBoundary = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  sr: Float32Array,
  sg: Float32Array,
  sb: Float32Array,
  distMap: Float32Array,
  w: number,
  h: number
): void => {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      const d = distMap[idx]!;
      if (d <= 0 || d > BLEND_BAND) {
        continue;
      }
      const t = (d / BLEND_BAND) ** 0.5;
      r[idx] = sr[idx]! * (1 - t) + r[idx]! * t;
      g[idx] = sg[idx]! * (1 - t) + g[idx]! * t;
      b[idx] = sb[idx]! * (1 - t) + b[idx]! * t;
    }
  }
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

const hybridFill = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  origR: Float32Array,
  origG: Float32Array,
  origB: Float32Array,
  distMap: Float32Array,
  maskCount: number,
  size: number,
  w: number,
  h: number,
  onProgress?: (pct: number) => void
): void => {
  const dr = new Float32Array(r);
  const dg = new Float32Array(g);
  const db = new Float32Array(b);
  const dm = new Uint8Array(mask);
  diffusionFill(dr, dg, db, dm, w, h, 100);
  onProgress?.(0.15);

  const fm = new Uint8Array(mask);
  const sorted: number[] = [];
  for (let i = 0; i < size; i += 1) {
    if (fm[i]) {
      sorted.push(i);
    }
  }
  sorted.sort((a, b) => (distMap[a] ?? 0) - (distMap[b] ?? 0));

  let lx = 0;
  let ly = 0;
  for (let pi = 0; pi < sorted.length; pi += 1) {
    const idx = sorted[pi]!;
    if (!fm[idx]) {
      continue;
    }
    const px = idx % w;
    const py = (idx - px) / w;
    const mi = findBestPixel(r, g, b, fm, px, py, w, h, lx, ly);
    if (mi >= 0) {
      const d = distMap[idx] ?? 0;
      const ew = Math.min(0.7, 0.3 + d * 0.05);
      r[idx] = r[mi]! * ew + dr[idx]! * (1 - ew);
      g[idx] = g[mi]! * ew + dg[idx]! * (1 - ew);
      b[idx] = b[mi]! * ew + db[idx]! * (1 - ew);
    }
    fm[idx] = 0;
    lx = px;
    ly = py;
    if (onProgress && pi % 30 === 0) {
      onProgress(0.15 + Math.min(pi / maskCount, 0.7) * 0.72);
    }
  }

  for (let i = 0; i < size; i += 1) {
    if (fm[i]) {
      r[i] = dr[i]!;
      g[i] = dg[i]!;
      b[i] = db[i]!;
      fm[i] = 0;
    }
  }
  applySmoothing(r, g, b, fm, distMap, w, h);
  onProgress?.(0.9);
  bilateralFilter(r, g, b, distMap, w, h);
  onProgress?.(0.95);
  blendBoundary(r, g, b, origR, origG, origB, distMap, w, h);
  onProgress?.(1);
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

  const origR = new Float32Array(size);
  const origG = new Float32Array(size);
  const origB = new Float32Array(size);
  const r = new Float32Array(size);
  const g = new Float32Array(size);
  const b = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    origR[i] = srcImage.data[i * 4]!;
    origG[i] = srcImage.data[i * 4 + 1]!;
    origB[i] = srcImage.data[i * 4 + 2]!;
    r[i] = origR[i]!;
    g[i] = origG[i]!;
    b[i] = origB[i]!;
  }

  const distMap = computeDistanceMap(mask, width, height);
  hybridFill(
    r,
    g,
    b,
    mask,
    origR,
    origG,
    origB,
    distMap,
    maskCount,
    size,
    width,
    height,
    onProgress
  );

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
