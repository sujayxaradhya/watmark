<script lang="ts">
  import type { ToolMode, FileType, MaskStroke } from "$lib/types";
  import UploadArea from "../components/editor/upload-area.svelte";
  import CanvasEditor from "../components/editor/canvas-editor.svelte";
  import type { EditorHandle } from "../components/editor/canvas-editor.svelte";
  import Toolbar from "../components/editor/toolbar.svelte";
  import ProcessingStatus from "../components/editor/processing-status.svelte";
  import ResultPreview from "../components/editor/result-preview.svelte";
  import { inpaintImage } from "$lib/processors/image";
  import { processVideo } from "$lib/processors/video";
  import { Image, Video } from "lucide-svelte";

  let phase = $state<"upload" | "editing" | "processing" | "result">("upload");
  let file = $state<File | null>(null);
  let fileType = $state<FileType | null>(null);
  let originalUrl = $state<string | null>(null);
  let processedUrl = $state<string | null>(null);
  // eslint-disable-next-line prefer-const
  let brushSize = $state(35);
  let toolMode = $state<ToolMode>("brush");
  let strokes = $state<MaskStroke[]>([]);
  let isProcessing = $state(false);
  let progress = $state(0);
  let statusText = $state("");
  let error = $state<string | null>(null);

  let editorHandle = $state<EditorHandle | null>(null);
  let sourceCanvas = $state<HTMLCanvasElement | null>(null);
  let maskCanvas = $state<HTMLCanvasElement | null>(null);

  const isVideo = $derived(fileType === "video");

  const handleFileSelect = (selectedFile: File, type: FileType) => {
    file = selectedFile;
    fileType = type;
    originalUrl = URL.createObjectURL(selectedFile);
    phase = "editing";
    strokes = [];
    error = null;
    processedUrl = null;
  };

  const handleCanvasReady = (
    src: HTMLCanvasElement,
    mask: HTMLCanvasElement,
  ) => {
    sourceCanvas = src;
    maskCanvas = mask;
  };

  const handleStrokesChange = (newStrokes: MaskStroke[]) => {
    strokes = newStrokes;
  };

  const handleProcess = async () => {
    if (!sourceCanvas || !maskCanvas || !file) {return;}

    isProcessing = true;
    phase = "processing";
    progress = 0;
    error = null;

    try {
      if (fileType === "image") {
        statusText = "Analyzing watermark area...";
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });

        const result = inpaintImage(sourceCanvas, maskCanvas, (pct) => {
          progress = pct;
          statusText = `Removing watermark... ${Math.round(pct * 100)}%`;
        });

        if (!result.hasMask) {
          throw new Error(
            "No watermark area marked. Please paint over the watermark.",
          );
        }

        const ctx = sourceCanvas.getContext("2d");
        if (ctx) {ctx.putImageData(result.imageData, 0, 0);}

        processedUrl = sourceCanvas.toDataURL("image/png");
      } else {
        statusText = "Preparing video processing...";
        const dims = editorHandle?.getNaturalDimensions() ?? {
          height: sourceCanvas.height,
          width: sourceCanvas.width,
        };

        const blob = await processVideo(
          file,
          maskCanvas,
          dims.width,
          dims.height,
          (pct) => {
            progress = pct;
            statusText = `Processing video... ${Math.round(pct * 100)}%`;
          },
          (msg) => {
            statusText = msg;
          },
        );

        processedUrl = URL.createObjectURL(blob);
      }

      phase = "result";
    } catch (error) {
      error = error instanceof Error ? error.message : "Processing failed";
      phase = "editing";
    } finally {
      isProcessing = false;
    }
  };

  const handleDownload = () => {
    if (!processedUrl || !file) {return;}

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const ext = fileType === "video" ? "mp4" : "png";
    const link = document.createElement("a");
    link.href = processedUrl;
    link.download = `${baseName}-no-watermark.${ext}`;
    link.click();
  };

  const handleReset = () => {
    if (originalUrl) {URL.revokeObjectURL(originalUrl);}
    if (processedUrl && fileType === "video") {URL.revokeObjectURL(processedUrl);}

    phase = "upload";
    file = null;
    fileType = null;
    originalUrl = null;
    processedUrl = null;
    strokes = [];
    error = null;
    isProcessing = false;
    progress = 0;
    sourceCanvas = null;
    maskCanvas = null;
  };

  const handleUndo = () => editorHandle?.undo();
  const handleClear = () => editorHandle?.clearMask();

  const handleKeydown = (e: KeyboardEvent) => {
    if (phase !== "editing") {return;}

    if (e.key === "b" || e.key === "B") {
      toolMode = "brush";
    } else if (e.key === "e" || e.key === "E") {
      toolMode = "eraser";
    } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleUndo();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="editor-page">
  {#if phase === "upload"}
    <div class="upload-container">
      <UploadArea onFileSelect={handleFileSelect} />
    </div>
  {:else}
    <div class="editor-container">
      <Toolbar
        {brushSize}
        {toolMode}
        hasStrokes={strokes.length > 0}
        {isProcessing}
        hasResult={phase === "result"}
        onBrushSizeChange={(s) => (brushSize = s)}
        onToolModeChange={(m) => (toolMode = m)}
        onUndo={handleUndo}
        onClear={handleReset}
        onProcess={handleProcess}
        onDownload={handleDownload}
        onReset={handleReset}
      />

      {#if error}
        <div class="error-banner">
          <span>{error}</span>
          <button onclick={() => (error = null)}>Dismiss</button>
        </div>
      {/if}

      <div class="canvas-area">
        {#if phase === "result" && processedUrl && originalUrl}
          <ResultPreview
            {originalUrl}
            {processedUrl}
            {isVideo}
            onDownload={handleDownload}
          />
        {:else if originalUrl}
          <CanvasEditor
            onRegister={(h) => (editorHandle = h)}
            imageSrc={originalUrl}
            videoSrc={isVideo ? originalUrl : undefined}
            {isVideo}
            {brushSize}
            {toolMode}
            onStrokesChange={handleStrokesChange}
            onCanvasReady={handleCanvasReady}
          />
        {/if}
      </div>

      {#if phase === "editing"}
        <div class="editor-hint">
          {#if isVideo}
            <Video size={14} />
            Paint over the watermark area. The bounding box will be used for removal.
          {:else}
            <Image size={14} />
            Paint over the watermark area with the brush tool.
            Use
            <kbd>B</kbd>
            for brush,
            <kbd>E</kbd>
            for eraser,
            <kbd>Ctrl+Z</kbd>
            to undo.
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<ProcessingStatus {isProcessing} {progress} {statusText} />

<style>
  .editor-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1.5rem;
  }

  .upload-container {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
  }

  .editor-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  .canvas-area {
    flex: 1;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: auto;
    padding: 0.5rem;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    background: oklch(0.16 0.04 30);
    border: 1px solid oklch(0.3 0.08 30);
    border-radius: 0.5rem;
    color: oklch(0.8 0.1 30);
    font-size: 0.8125rem;
  }

  .error-banner button {
    background: none;
    border: none;
    color: oklch(0.7 0.08 30);
    cursor: pointer;
    font-size: 0.8125rem;
    text-decoration: underline;
  }

  .editor-hint {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: oklch(0.45 0 0);
    padding: 0.5rem 0;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.375rem;
    background: oklch(0.16 0 0);
    border: 1px solid oklch(0.22 0 0);
    border-radius: 0.25rem;
    font-family: inherit;
    font-size: 0.6875rem;
    color: oklch(0.6 0 0);
  }
</style>
