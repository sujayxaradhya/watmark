export type InpaintResult = {
  imageData: ImageData;
  hasMask: boolean;
};

const CTX_RADIUS = 7;
const SEARCH_RADIUS = 80;
const SEARCH_STRIDE = 3;
const SMOOTH_RADIUS = 2;
const SMOOTH_THRESHOLD = 40;
const BLEND_BAND = 5;

const computeDistanceMap = (
  mask: Uint8Array,
  width: number,
  height: number
): Float32Array => {
  const dist = new Float32Array(width * height).fill(-1);
  const queue: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!mask[idx]) {
        dist[idx] = 0;
        continue;
      }
      if (
        (x > 0 && !mask[idx - 1]) ||
        (x < width - 1 && !mask[idx + 1]) ||
        (y > 0 && !mask[idx - width]) ||
        (y < height - 1 && !mask[idx + width])
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
    const cx = idx % width;
    const cy = (idx - cx) / width;
    const d = dist[idx]!;

    const neighbors = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as const;

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const nidx = ny * width + nx;
      if (dist[nidx]! < 0 || dist[nidx]! > d + 1) {
        dist[nidx] = d + 1;
        queue.push(nidx);
      }
    }
  }

  return dist;
};

const isPatchClean = (
  mask: Uint8Array,
  sx: number,
  sy: number,
  width: number,
  height: number
): boolean => {
  for (let dy = -CTX_RADIUS; dy <= CTX_RADIUS; dy += 1) {
    for (let dx = -CTX_RADIUS; dx <= CTX_RADIUS; dx += 1) {
      const px = sx + dx;
      const py = sy + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) {
        return false;
      }
      if (mask[py * width + px]) {
        return false;
      }
    }
  }
  return true;
};

const pixelSSD = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  tidx: number,
  sidx: number
): number => {
  if (mask[tidx]) {
    return 0;
  }
  const dr = (r[tidx] ?? 0) - (r[sidx] ?? 0);
  const dg = (g[tidx] ?? 0) - (g[sidx] ?? 0);
  const db = (b[tidx] ?? 0) - (b[sidx] ?? 0);
  return dr * dr + dg * dg + db * db;
};

const computeContextSSD = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  width: number,
  height: number,
  _bestSSD: number
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
      if (tx < 0 || tx >= width || ty < 0 || ty >= height) {
        continue;
      }
      if (ssx < 0 || ssx >= width || ssy < 0 || ssy >= height) {
        continue;
      }
      ssd += pixelSSD(r, g, b, mask, ty * width + tx, ssy * width + ssx);
      count += 1;
    }
  }
  return count > 0 ? ssd / count : Number.POSITIVE_INFINITY;
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
  width: number,
  height: number
): { r: number; g: number; b: number; ssd: number } => {
  let bestSSD = Number.POSITIVE_INFINITY;
  let bestR = 128;
  let bestG = 128;
  let bestB = 128;

  const [xMin, xMax] = searchRange(cx, SEARCH_RADIUS, width);
  const [yMin, yMax] = searchRange(cy, SEARCH_RADIUS, height);

  const evaluate = (sx: number, sy: number) => {
    const sidx = sy * width + sx;
    if (mask[sidx]) {
      return;
    }
    if (!isPatchClean(mask, sx, sy, width, height)) {
      return;
    }
    const ssd = computeContextSSD(
      r,
      g,
      b,
      mask,
      cx,
      cy,
      sx,
      sy,
      width,
      height,
      bestSSD
    );
    if (ssd < bestSSD) {
      bestSSD = ssd;
      bestR = r[sidx] ?? 0;
      bestG = g[sidx] ?? 0;
      bestB = b[sidx] ?? 0;
    }
  };

  for (let sy = yMin; sy <= yMax; sy += SEARCH_STRIDE) {
    for (let sx = xMin; sx <= xMax; sx += SEARCH_STRIDE) {
      evaluate(sx, sy);
    }
  }

  if (bestSSD < Number.POSITIVE_INFINITY) {
    for (
      let sy = Math.max(CTX_RADIUS, cy - SEARCH_STRIDE + 1);
      sy <= Math.min(height - CTX_RADIUS - 1, cy + SEARCH_STRIDE - 1);
      sy += 1
    ) {
      for (
        let sx = Math.max(CTX_RADIUS, cx - SEARCH_STRIDE + 1);
        sx <= Math.min(width - CTX_RADIUS - 1, cx + SEARCH_STRIDE - 1);
        sx += 1
      ) {
        evaluate(sx, sy);
      }
    }
  }

  return { r: bestR, g: bestG, b: bestB, ssd: bestSSD };
};

const smoothPixel = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  _mask: Uint8Array,
  idx: number,
  width: number,
  height: number
): { r: number; g: number; b: number } => {
  const cx = idx % width;
  const cy = (idx - cx) / width;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let dy = -SMOOTH_RADIUS; dy <= SMOOTH_RADIUS; dy += 1) {
    for (let dx = -SMOOTH_RADIUS; dx <= SMOOTH_RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const nidx = ny * width + nx;
      sumR += r[nidx] ?? 0;
      sumG += g[nidx] ?? 0;
      sumB += b[nidx] ?? 0;
      count += 1;
    }
  }

  if (count === 0) {
    return { r: r[idx] ?? 0, g: g[idx] ?? 0, b: b[idx] ?? 0 };
  }

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;
  const cr = r[idx] ?? 0;
  const cg = g[idx] ?? 0;
  const cb = b[idx] ?? 0;

  const diff = Math.abs(cr - avgR) + Math.abs(cg - avgG) + Math.abs(cb - avgB);
  if (diff > SMOOTH_THRESHOLD) {
    return { r: avgR, g: avgG, b: avgB };
  }

  return { r: cr, g: cg, b: cb };
};

const applySmoothing = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  distMap: Float32Array,
  width: number,
  height: number
) => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (distMap[idx]! > 0 && distMap[idx]! <= 8) {
        const smoothed = smoothPixel(r, g, b, mask, idx, width, height);
        r[idx] = smoothed.r;
        g[idx] = smoothed.g;
        b[idx] = smoothed.b;
      }
    }
  }
};

const blurPixel = (
  srcR: Float32Array,
  srcG: Float32Array,
  srcB: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number; g: number; b: number } => {
  let wSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  for (let ky = -2; ky <= 2; ky += 1) {
    for (let kx = -2; kx <= 2; kx += 1) {
      const nx = x + kx;
      const ny = y + ky;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const nidx = ny * width + nx;
      const w = Math.exp(-(kx * kx + ky * ky) / 2.88);
      wSum += w;
      rSum += (srcR[nidx] ?? 0) * w;
      gSum += (srcG[nidx] ?? 0) * w;
      bSum += (srcB[nidx] ?? 0) * w;
    }
  }

  return { r: rSum / wSum, g: gSum / wSum, b: bSum / wSum };
};

const gaussianBlurInpaintRegion = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  distMap: Float32Array,
  width: number,
  height: number
): void => {
  const size = width * height;
  const tmpR = new Float32Array(size);
  const tmpG = new Float32Array(size);
  const tmpB = new Float32Array(size);

  for (let pass = 0; pass < 2; pass += 1) {
    const srcR = pass === 0 ? r : tmpR;
    const srcG = pass === 0 ? g : tmpG;
    const srcB = pass === 0 ? b : tmpB;
    const dstR = pass === 0 ? tmpR : r;
    const dstG = pass === 0 ? tmpG : g;
    const dstB = pass === 0 ? tmpB : b;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (distMap[idx]! <= 0) {
          dstR[idx] = srcR[idx]!;
          dstG[idx] = srcG[idx]!;
          dstB[idx] = srcB[idx]!;
          continue;
        }
        const blurred = blurPixel(srcR, srcG, srcB, x, y, width, height);
        dstR[idx] = blurred.r;
        dstG[idx] = blurred.g;
        dstB[idx] = blurred.b;
      }
    }
  }
};

const blendBoundary = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  srcR: Float32Array,
  srcG: Float32Array,
  srcB: Float32Array,
  distMap: Float32Array,
  width: number,
  height: number
): void => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const d = distMap[idx]!;
      if (d <= 0 || d > BLEND_BAND) {
        continue;
      }

      const t = d / BLEND_BAND;
      r[idx] = srcR[idx]! * (1 - t) + r[idx]! * t;
      g[idx] = srcG[idx]! * (1 - t) + g[idx]! * t;
      b[idx] = srcB[idx]! * (1 - t) + b[idx]! * t;
    }
  }
};

const postProcess = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  origR: Float32Array,
  origG: Float32Array,
  origB: Float32Array,
  distMap: Float32Array,
  width: number,
  height: number,
  onProgress?: (pct: number) => void
) => {
  onProgress?.(0.87);
  applySmoothing(r, g, b, mask, distMap, width, height);
  onProgress?.(0.92);
  gaussianBlurInpaintRegion(r, g, b, distMap, width, height);
  onProgress?.(0.96);
  blendBoundary(r, g, b, origR, origG, origB, distMap, width, height);
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
  const totalMask = maskCount;

  const sortedPixels: number[] = [];
  for (let i = 0; i < size; i += 1) {
    if (mask[i]) {
      sortedPixels.push(i);
    }
  }
  sortedPixels.sort((a, b) => (distMap[a] ?? 0) - (distMap[b] ?? 0));

  for (let pi = 0; pi < sortedPixels.length; pi += 1) {
    const idx = sortedPixels[pi]!;
    if (!mask[idx]) {
      continue;
    }

    const px = idx % width;
    const py = (idx - px) / width;

    const match = findBestPixel(r, g, b, mask, px, py, width, height);
    r[idx] = match.r;
    g[idx] = match.g;
    b[idx] = match.b;
    mask[idx] = 0;

    if (onProgress && pi % 30 === 0) {
      onProgress(Math.min(pi / totalMask, 0.85));
    }
  }

  postProcess(
    r,
    g,
    b,
    mask,
    origR,
    origG,
    origB,
    distMap,
    width,
    height,
    onProgress
  );

  const result = new ImageData(width, height);
  for (let i = 0; i < size; i += 1) {
    result.data[i * 4] = Math.max(0, Math.min(255, Math.round(r[i]!)));
    result.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g[i]!)));
    result.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b[i]!)));
    result.data[i * 4 + 3] = 255;
  }

  return { hasMask: true, imageData: result };
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
