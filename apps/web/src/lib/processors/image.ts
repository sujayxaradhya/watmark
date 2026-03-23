export type InpaintResult = {
  imageData: ImageData;
  hasMask: boolean;
};

const CTX_RADIUS = 7;
const SEARCH_RADIUS = 80;
const SEARCH_STRIDE = 3;
const SMOOTH_RADIUS = 2;
const SMOOTH_THRESHOLD = 40;
const BLEND_BAND = 10;
const BILATERAL_RADIUS = 3;
const BILATERAL_SIGMA_S = 3;
const BILATERAL_SIGMA_R = 25;

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

const computeConfidence = (
  mask: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number
): number => {
  let known = 0;
  let total = 0;
  for (let dy = -CTX_RADIUS; dy <= CTX_RADIUS; dy += 1) {
    for (let dx = -CTX_RADIUS; dx <= CTX_RADIUS; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        known += 1;
      } else if (!mask[ny * width + nx]) {
        known += 1;
      }
      total += 1;
    }
  }
  return known / total;
};

const computeDataTerm = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number
): number => {
  let maxGrad = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const nidx = ny * width + nx;
      if (mask[nidx]) {
        continue;
      }
      const idx = y * width + x;
      const dr = Math.abs((r[idx] ?? 0) - (r[nidx] ?? 0));
      const dg = Math.abs((g[idx] ?? 0) - (g[nidx] ?? 0));
      const db = Math.abs((b[idx] ?? 0) - (b[nidx] ?? 0));
      maxGrad = Math.max(maxGrad, dr + dg + db);
    }
  }
  return maxGrad / 255;
};

const computePriority = (
  mask: Uint8Array,
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  _distMap: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): number => {
  const confidence = computeConfidence(mask, x, y, width, height);
  const data = computeDataTerm(r, g, b, mask, x, y, width, height);
  return confidence * (1 + data);
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
    return Number.NaN;
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
      const pSSD = pixelSSD(r, g, b, mask, ty * width + tx, ssy * width + ssx);
      if (!Number.isNaN(pSSD)) {
        ssd += pSSD;
        count += 1;
      }
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
  height: number,
  lastSrcX: number,
  lastSrcY: number
): {
  r: number;
  g: number;
  b: number;
  ssd: number;
  srcX: number;
  srcY: number;
} => {
  let bestSSD = Number.POSITIVE_INFINITY;
  let bestR = 128;
  let bestG = 128;
  let bestB = 128;
  let bestSrcX = cx;
  let bestSrcY = cy;

  const [lxMin, lxMax] = searchRange(cx, 20, width);
  const [lyMin, lyMax] = searchRange(cy, 20, height);

  const [gxMin, gxMax] = searchRange(cx, SEARCH_RADIUS, width);
  const [gyMin, gyMax] = searchRange(cy, SEARCH_RADIUS, height);

  const [cxMin, cxMax] = searchRange(lastSrcX, 40, width);
  const [cyMin, cyMax] = searchRange(lastSrcY, 40, height);

  const evaluate = (sx: number, sy: number) => {
    const sidx = sy * width + sx;
    if (mask[sidx]) {
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
      bestSrcX = sx;
      bestSrcY = sy;
    }
  };

  for (let sy = lyMin; sy <= lyMax; sy += 1) {
    for (let sx = lxMin; sx <= lxMax; sx += 1) {
      evaluate(sx, sy);
    }
  }

  if (lastSrcX > 0 || lastSrcY > 0) {
    for (let sy = cyMin; sy <= cyMax; sy += 2) {
      for (let sx = cxMin; sx <= cxMax; sx += 2) {
        evaluate(sx, sy);
      }
    }
  }

  if (bestSSD > 500) {
    for (let sy = gyMin; sy <= gyMax; sy += SEARCH_STRIDE) {
      for (let sx = gxMin; sx <= gxMax; sx += SEARCH_STRIDE) {
        evaluate(sx, sy);
      }
    }
  }

  if (bestSSD < Number.POSITIVE_INFINITY && bestSSD > 100) {
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

  return {
    r: bestR,
    g: bestG,
    b: bestB,
    ssd: bestSSD,
    srcX: bestSrcX,
    srcY: bestSrcY,
  };
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

const bilateralFilterPixel = (
  srcR: Float32Array,
  srcG: Float32Array,
  srcB: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number; g: number; b: number } => {
  const centerR = srcR[y * width + x] ?? 0;
  const centerG = srcG[y * width + x] ?? 0;
  const centerB = srcB[y * width + x] ?? 0;

  let wSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  for (let ky = -BILATERAL_RADIUS; ky <= BILATERAL_RADIUS; ky += 1) {
    for (let kx = -BILATERAL_RADIUS; kx <= BILATERAL_RADIUS; kx += 1) {
      const nx = x + kx;
      const ny = y + ky;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const nidx = ny * width + nx;
      const nr = srcR[nidx] ?? 0;
      const ng = srcG[nidx] ?? 0;
      const nb = srcB[nidx] ?? 0;

      const spatialW = Math.exp(
        -(kx * kx + ky * ky) / (2 * BILATERAL_SIGMA_S * BILATERAL_SIGMA_S)
      );
      const colorDist = Math.hypot(nr - centerR, ng - centerG, nb - centerB);
      const rangeW = Math.exp(
        -(colorDist * colorDist) / (2 * BILATERAL_SIGMA_R * BILATERAL_SIGMA_R)
      );
      const w = spatialW * rangeW;

      wSum += w;
      rSum += nr * w;
      gSum += ng * w;
      bSum += nb * w;
    }
  }

  return { r: rSum / wSum, g: gSum / wSum, b: bSum / wSum };
};

const bilateralFilterRegion = (
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

  for (let i = 0; i < size; i += 1) {
    if (distMap[i]! > 0) {
      const x = i % width;
      const y = (i - x) / width;
      const filtered = bilateralFilterPixel(r, g, b, x, y, width, height);
      tmpR[i] = filtered.r;
      tmpG[i] = filtered.g;
      tmpB[i] = filtered.b;
    } else {
      tmpR[i] = r[i]!;
      tmpG[i] = g[i]!;
      tmpB[i] = b[i]!;
    }
  }

  for (let i = 0; i < size; i += 1) {
    if (distMap[i]! > 0) {
      const x = i % width;
      const y = (i - x) / width;
      const filtered = bilateralFilterPixel(
        tmpR,
        tmpG,
        tmpB,
        x,
        y,
        width,
        height
      );
      r[i] = filtered.r;
      g[i] = filtered.g;
      b[i] = filtered.b;
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
      const t = (d / BLEND_BAND) ** 0.7;
      r[idx] = srcR[idx]! * (1 - t) + r[idx]! * t;
      g[idx] = srcG[idx]! * (1 - t) + g[idx]! * t;
      b[idx] = srcB[idx]! * (1 - t) + b[idx]! * t;
    }
  }
};

const priorityFill = (
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  distMap: Float32Array,
  width: number,
  height: number,
  totalMask: number,
  onProgress?: (pct: number) => void
): void => {
  const size = width * height;
  let lastSrcX = 0;
  let lastSrcY = 0;

  const boundaryPixels: number[] = [];
  for (let i = 0; i < size; i += 1) {
    if (!mask[i]) {
      continue;
    }
    if (distMap[i]! <= 1) {
      boundaryPixels.push(i);
    }
  }

  while (boundaryPixels.length > 0) {
    let bestPriority = -1;
    let bestIdx = -1;
    let bestArrPos = -1;

    for (let bi = 0; bi < boundaryPixels.length; bi += 1) {
      const idx = boundaryPixels[bi]!;
      if (!mask[idx]) {
        continue;
      }
      const px = idx % width;
      const py = (idx - px) / width;
      const p = computePriority(mask, r, g, b, distMap, px, py, width, height);
      if (p > bestPriority) {
        bestPriority = p;
        bestIdx = idx;
        bestArrPos = bi;
      }
    }

    if (bestIdx < 0) {
      break;
    }

    const px = bestIdx % width;
    const py = (bestIdx - px) / width;

    const match = findBestPixel(
      r,
      g,
      b,
      mask,
      px,
      py,
      width,
      height,
      lastSrcX,
      lastSrcY
    );
    r[bestIdx] = match.r;
    g[bestIdx] = match.g;
    b[bestIdx] = match.b;
    mask[bestIdx] = 0;
    lastSrcX = match.srcX;
    lastSrcY = match.srcY;

    boundaryPixels.splice(bestArrPos, 1);

    const neighbors = [
      bestIdx - 1,
      bestIdx + 1,
      bestIdx - width,
      bestIdx + width,
    ];
    for (const nidx of neighbors) {
      if (nidx >= 0 && nidx < size && mask[nidx] && distMap[nidx]! > 1) {
        distMap[nidx] = 1;
        boundaryPixels.push(nidx);
      }
    }

    if (onProgress && (totalMask - boundaryPixels.length) % 30 === 0) {
      onProgress(
        Math.min((totalMask - boundaryPixels.length) / totalMask, 0.85)
      );
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
  onProgress?.(0.9);
  bilateralFilterRegion(r, g, b, distMap, width, height);
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
  priorityFill(r, g, b, mask, distMap, width, height, maskCount, onProgress);
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
