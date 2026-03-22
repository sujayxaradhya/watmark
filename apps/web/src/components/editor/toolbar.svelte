<script lang="ts">
  import {
    Brush,
    Eraser,
    Undo2,
    Trash2,
    Download,
    Sparkles,
    Loader2,
    RotateCcw,
  } from "lucide-svelte";
  import type { ToolMode } from "$lib/types";

  interface Props {
    brushSize: number;
    toolMode: ToolMode;
    hasStrokes: boolean;
    isProcessing: boolean;
    hasResult: boolean;
    onBrushSizeChange: (size: number) => void;
    onToolModeChange: (mode: ToolMode) => void;
    onUndo: () => void;
    onClear: () => void;
    onProcess: () => void;
    onDownload: () => void;
    onReset: () => void;
  }

  const {
    brushSize,
    toolMode,
    hasStrokes,
    isProcessing,
    hasResult,
    onBrushSizeChange,
    onToolModeChange,
    onUndo,
    onClear,
    onProcess,
    onDownload,
    onReset,
  }: Props = $props();

  const handleSliderInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    onBrushSizeChange(Number(target.value));
  };
</script>

<div class="toolbar">
  <div class="toolbar-section">
    <span class="toolbar-label">Tool</span>
    <div class="tool-group">
      <button
        class="tool-btn"
        class:active={toolMode === "brush"}
        onclick={() => onToolModeChange("brush")}
        title="Brush (B)"
        aria-label="Brush tool"
      >
        <Brush size={16} />
      </button>
      <button
        class="tool-btn"
        class:active={toolMode === "eraser"}
        onclick={() => onToolModeChange("eraser")}
        title="Eraser (E)"
        aria-label="Eraser tool"
      >
        <Eraser size={16} />
      </button>
    </div>
  </div>

  <div class="toolbar-divider"></div>

  <div class="toolbar-section">
    <span class="toolbar-label">Size: {brushSize}px</span>
    <input
      type="range"
      min="2"
      max="120"
      step="1"
      value={brushSize}
      oninput={handleSliderInput}
      class="brush-slider"
      aria-label="Brush size"
    />
  </div>

  <div class="toolbar-divider"></div>

  <div class="toolbar-section">
    <div class="tool-group">
      <button
        class="tool-btn"
        onclick={onUndo}
        disabled={!hasStrokes || isProcessing}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <Undo2 size={16} />
      </button>
      <button
        class="tool-btn"
        onclick={onClear}
        disabled={isProcessing}
        title="Delete image"
        aria-label="Delete image"
      >
        <Trash2 size={16} />
      </button>
    </div>
  </div>

  <div class="toolbar-spacer"></div>

  <div class="toolbar-section">
    <div class="tool-group">
      {#if hasResult}
        <button
          class="action-btn secondary"
          onclick={onReset}
          disabled={isProcessing}
          aria-label="Start over"
        >
          <RotateCcw size={16} />
          Start Over
        </button>
        <button
          class="action-btn primary"
          onclick={onDownload}
          disabled={isProcessing}
          aria-label="Download result"
        >
          <Download size={16} />
          Download
        </button>
      {:else}
        <button
          class="action-btn primary"
          onclick={onProcess}
          disabled={!hasStrokes || isProcessing}
          aria-label="Remove watermark"
        >
          {#if isProcessing}
            <Loader2 size={16} class="spin" />
            Processing...
          {:else}
            <Sparkles size={16} />
            Remove Watermark
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    background: oklch(0.12 0 0);
    border: 1px solid oklch(0.2 0 0);
    border-radius: 0.75rem;
    flex-wrap: wrap;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toolbar-label {
    font-size: 0.75rem;
    color: oklch(0.55 0 0);
    white-space: nowrap;
    min-width: 70px;
  }

  .toolbar-divider {
    width: 1px;
    height: 24px;
    background: oklch(0.22 0 0);
  }

  .toolbar-spacer {
    flex: 1;
  }

  .tool-group {
    display: flex;
    gap: 0.25rem;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid oklch(0.22 0 0);
    border-radius: 0.5rem;
    background: oklch(0.14 0 0);
    color: oklch(0.7 0 0);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tool-btn:hover:not(:disabled) {
    background: oklch(0.18 0 0);
    color: oklch(0.85 0 0);
  }

  .tool-btn.active {
    background: oklch(0.22 0.04 155);
    border-color: oklch(0.5 0.12 155);
    color: oklch(0.8 0.12 155);
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .brush-slider {
    width: 100px;
    height: 4px;
    accent-color: oklch(0.65 0.15 155);
    cursor: pointer;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .action-btn.primary {
    background: oklch(0.55 0.18 155);
    color: oklch(0.98 0 0);
  }

  .action-btn.primary:hover:not(:disabled) {
    background: oklch(0.6 0.18 155);
  }

  .action-btn.secondary {
    background: oklch(0.16 0 0);
    border-color: oklch(0.25 0 0);
    color: oklch(0.75 0 0);
  }

  .action-btn.secondary:hover:not(:disabled) {
    background: oklch(0.2 0 0);
    color: oklch(0.85 0 0);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
