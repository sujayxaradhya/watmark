<script lang="ts">
  import { Download, Check } from "lucide-svelte";

  interface Props {
    originalUrl: string;
    processedUrl: string;
    isVideo: boolean;
    onDownload: () => void;
  }

  const { originalUrl, processedUrl, isVideo, onDownload }: Props = $props();
</script>

<div class="result-preview">
  <div class="result-grid">
    <div class="result-panel">
      <span class="result-label">Original</span>
      <div class="result-media">
        {#if isVideo}
          <video src={originalUrl} controls muted class="result-video"></video>
        {:else}
          <img src={originalUrl} alt="Original" class="result-img" />
        {/if}
      </div>
    </div>

    <div class="result-panel">
      <span class="result-label processed-label">
        <Check size={12} />
        Watermark Removed
      </span>
      <div class="result-media">
        {#if isVideo}
          <video src={processedUrl} controls muted class="result-video"></video>
        {:else}
          <img src={processedUrl} alt="Processed" class="result-img" />
        {/if}
      </div>
    </div>
  </div>

  <button class="download-btn" onclick={onDownload} aria-label="Download result">
    <Download size={18} />
    Download {isVideo ? "Video" : "Image"}
  </button>
</div>

<style>
  .result-preview {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    align-items: center;
  }

  .result-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
  }

  .result-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .result-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: oklch(0.55 0 0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .processed-label {
    color: oklch(0.7 0.15 155);
  }

  .result-media {
    background:
      repeating-conic-gradient(oklch(0.18 0 0) 0% 25%, oklch(0.15 0 0) 0% 50%)
      50% / 16px 16px;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid oklch(0.22 0 0);
  }

  .result-img {
    display: block;
    width: 100%;
    height: auto;
  }

  .result-video {
    display: block;
    width: 100%;
    height: auto;
  }

  .download-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.5rem;
    background: oklch(0.55 0.18 155);
    color: oklch(0.98 0 0);
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .download-btn:hover {
    background: oklch(0.6 0.18 155);
  }
</style>
