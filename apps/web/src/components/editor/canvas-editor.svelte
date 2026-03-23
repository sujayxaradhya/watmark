<script lang="ts">
  import type { ToolMode, MaskStroke } from "$lib/types";

  export type EditorHandle = {
    undo: () => void;
    clearMask: () => void;
    getNaturalDimensions: () => { width: number; height: number };
  }

  type Props = {
    imageSrc: string;
    videoSrc?: string;
    isVideo: boolean;
    brushSize: number;
    toolMode: ToolMode;
    onStrokesChange: (strokes: MaskStroke[]) => void;
    onCanvasReady: (source: HTMLCanvasElement, mask: HTMLCanvasElement) => void;
    onRegister: (handle: EditorHandle) => void;
  }

  const {
    imageSrc,
    videoSrc,
    isVideo,
    brushSize,
    toolMode,
    onStrokesChange,
    onCanvasReady,
    onRegister,
  }: Props = $props();

  // eslint-disable-next-line prefer-const
  let containerEl = $state<HTMLDivElement>();
  // eslint-disable-next-line prefer-const
  let sourceCanvas = $state<HTMLCanvasElement>();
  // eslint-disable-next-line prefer-const
  let maskCanvas = $state<HTMLCanvasElement>();
  // eslint-disable-next-line prefer-const
  let displayCanvas = $state<HTMLCanvasElement>();
  // eslint-disable-next-line prefer-const
  let videoEl = $state<HTMLVideoElement>();

  let isDrawing = $state(false);
  let currentStroke = $state<MaskStroke | null>(null);
  let strokes = $state<MaskStroke[]>([]);
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);
  let imageLoaded = $state(false);

  let cursorVisible = $state(false);
  let cursorX = $state(0);
  let cursorY = $state(0);

  const cursorDiameter = $derived(
    displayCanvas && displayCanvas.width > 0
      ? brushSize * (displayCanvas.getBoundingClientRect().width / displayCanvas.width)
      : brushSize,
  );

  const MAX_DIMENSION = 2000;

  const redrawDisplay = () => {
    const ctx = displayCanvas?.getContext("2d");
    if (!ctx || !sourceCanvas || !maskCanvas) {return;}

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.drawImage(maskCanvas, 0, 0);
  };

  const drawBrushAt = (x: number, y: number) => {
    const ctx = maskCanvas?.getContext("2d");
    if (!ctx) {return;}

    ctx.globalCompositeOperation =
      toolMode === "eraser" ? "destination-out" : "source-over";

    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle =
      toolMode === "brush" ? "rgba(255, 60, 60, 1)" : "rgba(0,0,0,1)";
    ctx.fill();
  };

  const interpolateLine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(dist / 2));

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      drawBrushAt(x, y);
    }
  };

  const captureVideoFrame = () => {
    if (!videoEl || !sourceCanvas) {return;}
    const ctx = sourceCanvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoEl, 0, 0, canvasWidth, canvasHeight);
      redrawDisplay();
    }
  };

  const initCanvases = (w: number, h: number) => {
    canvasWidth = w;
    canvasHeight = h;

    if (sourceCanvas) {
      sourceCanvas.width = w;
      sourceCanvas.height = h;
    }
    if (maskCanvas) {
      maskCanvas.width = w;
      maskCanvas.height = h;
    }
    if (displayCanvas) {
      displayCanvas.width = w;
      displayCanvas.height = h;
    }

    const maskCtx = maskCanvas?.getContext("2d");
    if (maskCtx) {maskCtx.clearRect(0, 0, w, h);}

    imageLoaded = true;
    if (sourceCanvas && maskCanvas) {
      onCanvasReady(sourceCanvas, maskCanvas);
    }
  };

  const clampDimension = (w: number, h: number): [number, number] => {
    if (w <= MAX_DIMENSION && h <= MAX_DIMENSION) {return [w, h];}
    const scale = MAX_DIMENSION / Math.max(w, h);
    return [Math.round(w * scale), Math.round(h * scale)];
  };

  const loadImage = () => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => {
      const [w, h] = clampDimension(img.naturalWidth, img.naturalHeight);
      initCanvases(w, h);

      const ctx = sourceCanvas?.getContext("2d");
      if (ctx) {ctx.drawImage(img, 0, 0, w, h);}
      redrawDisplay();
    });
    img.src = imageSrc;
  };

  const loadVideoFrame = () => {
    const video = videoEl;
    if (!video) {return;}
    video.currentTime = 0;

    video.addEventListener("loadeddata", () => {
      const [w, h] = clampDimension(video.videoWidth, video.videoHeight);
      initCanvases(w, h);
      captureVideoFrame();
    });

    video.load();
  };

  const getCanvasCoords = (
    e: MouseEvent | TouchEvent,
  ): { x: number; y: number } => {
    const canvas = displayCanvas;
    if (!canvas) {return { x: 0, y: 0 };}

    const rect = canvas.getBoundingClientRect();
    const clientX =
      "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
    const clientY =
      "touches" in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };


  const updateCursor = (e: MouseEvent) => {
    const canvas = displayCanvas;
    if (!canvas) {return;}

    const rect = canvas.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = e.clientY - rect.top;
    cursorVisible = true;
  };

  const hideCursor = () => {
    cursorVisible = false;
  };

  const startDrawing = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    isDrawing = true;
    const coords = getCanvasCoords(e);
    currentStroke = {
      brushSize,
      mode: toolMode,
      points: [coords],
    };
    drawBrushAt(coords.x, coords.y);
  };

  const draw = (e: MouseEvent | TouchEvent) => {
    if ("touches" in e) {
      if (!isDrawing || !currentStroke) {return;}
      e.preventDefault();
      const coords = getCanvasCoords(e);
      currentStroke.points.push(coords);

      const prev = currentStroke.points.at(-2);
      if (prev) {
        interpolateLine(prev.x, prev.y, coords.x, coords.y);
      }
      redrawDisplay();
      return;
    }

    updateCursor(e);

    if (!isDrawing || !currentStroke) {return;}
    e.preventDefault();
    const coords = getCanvasCoords(e);
    currentStroke.points.push(coords);

    const prev = currentStroke.points.at(-2);
    if (prev) {
      interpolateLine(prev.x, prev.y, coords.x, coords.y);
    }
    redrawDisplay();
  };

  const stopDrawing = () => {
    if (!isDrawing || !currentStroke) {return;}
    isDrawing = false;
    strokes = [...strokes, currentStroke];
    onStrokesChange(strokes);
    currentStroke = null;
  };



  const redrawMask = () => {
    const ctx = maskCanvas?.getContext("2d");
    if (!ctx) {return;}

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (const stroke of strokes) {
      ctx.globalCompositeOperation =
        stroke.mode === "eraser" ? "destination-out" : "source-over";

      for (const point of stroke.points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, stroke.brushSize / 2, 0, Math.PI * 2);
        ctx.fillStyle =
          stroke.mode === "brush"
            ? "rgba(255, 60, 60, 1)"
            : "rgba(0,0,0,1)";
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = "source-over";
    redrawDisplay();
  };

  export const undo = () => {
    if (strokes.length === 0) {return;}
    strokes = strokes.slice(0, -1);
    redrawMask();
    onStrokesChange(strokes);
  };

  export const clearMask = () => {
    strokes = [];
    const ctx = maskCanvas?.getContext("2d");
    if (ctx) {ctx.clearRect(0, 0, canvasWidth, canvasHeight);}
    redrawDisplay();
    onStrokesChange([]);
  };

  export const getSourceCanvas = () => sourceCanvas;
  export const getMaskCanvas = () => maskCanvas;
  export const getDisplayCanvas = () => displayCanvas;
  export const getDimensions = () => ({
    height: canvasHeight,
    width: canvasWidth,
  });
  export const getNaturalDimensions = () => ({
    height: canvasHeight,
    width: canvasWidth,
  });

  $effect(() => {
    onRegister({ clearMask, getNaturalDimensions, undo });
  });

  $effect(() => {
    if (imageSrc && !isVideo) {
      loadImage();
    }
  });

  $effect(() => {
    if (isVideo && videoSrc && videoEl) {
      loadVideoFrame();
    }
  });
</script>

<div class="editor-canvas-container" bind:this={containerEl}>
  {#if isVideo && videoSrc}
    <video
      bind:this={videoEl}
      src={videoSrc}
      class="hidden-video"
      muted
      playsinline
    ></video>
  {/if}

  <div class="canvas-wrapper">
    <canvas bind:this={sourceCanvas} class="hidden-canvas"></canvas>
    <canvas bind:this={maskCanvas} class="hidden-canvas"></canvas>

    <canvas
      bind:this={displayCanvas}
      class="display-canvas"
      onmousedown={startDrawing}
      onmousemove={draw}
      onmouseup={stopDrawing}
      onmouseleave={() => { stopDrawing(); hideCursor(); }}
      onmouseenter={updateCursor}
      ontouchstart={startDrawing}
      ontouchmove={draw}
      ontouchend={stopDrawing}
    ></canvas>

    {#if cursorVisible && imageLoaded}
      <div
        class="cursor-circle"
        class:eraser={toolMode === "eraser"}
        style:left={`${cursorX}px`}
        style:top={`${cursorY}px`}
        style:width={`${cursorDiameter}px`}
        style:height={`${cursorDiameter}px`}
      ></div>
    {/if}

    {#if !imageLoaded}
      <div class="canvas-placeholder">
        <span>Loading...</span>
      </div>
    {/if}
  </div>

  {#if imageLoaded && canvasWidth > 0}
    <div class="canvas-info">
      {canvasWidth} x {canvasHeight}px
    </div>
  {/if}
</div>

<style>
  .editor-canvas-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .canvas-wrapper {
    position: relative;
    background:
      repeating-conic-gradient(oklch(0.18 0 0) 0% 25%, oklch(0.15 0 0) 0% 50%)
      50% / 20px 20px;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid oklch(0.22 0 0);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hidden-canvas {
    display: none;
  }

  .hidden-video {
    display: none;
  }

  .display-canvas {
    display: block;
    cursor: none;
    max-width: 100%;
    max-height: calc(100vh - 200px);
    width: auto;
    height: auto;
  }

  .cursor-circle {
    position: absolute;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 10;
    mix-blend-mode: difference;
  }

  .cursor-circle.eraser {
    border: 2px dashed rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  }

  .canvas-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: oklch(0.5 0 0);
    font-size: 0.875rem;
  }

  .canvas-info {
    font-size: 0.75rem;
    color: oklch(0.5 0 0);
    font-variant-numeric: tabular-nums;
  }
</style>
