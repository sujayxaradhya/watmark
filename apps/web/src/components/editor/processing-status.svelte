<script lang="ts">
  import { Loader2 } from "lucide-svelte";

  interface Props {
    isProcessing: boolean;
    progress: number;
    statusText: string;
  }

  const { isProcessing, progress, statusText }: Props = $props();
</script>

{#if isProcessing}
  <div class="processing-overlay">
    <div class="processing-card">
      <div class="processing-icon">
        <Loader2 size={32} class="spin" />
      </div>

      <div class="processing-info">
        <p class="processing-status">{statusText || "Processing..."}</p>

        <div class="progress-track">
          <div
            class="progress-fill"
            style:width="{Math.round(progress * 100)}%"
          ></div>
        </div>

        <p class="progress-pct">{Math.round(progress * 100)}%</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .processing-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: oklch(0 0 0 / 60%);
    backdrop-filter: blur(4px);
  }

  .processing-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem 3rem;
    background: oklch(0.13 0 0);
    border: 1px solid oklch(0.22 0 0);
    border-radius: 1rem;
    min-width: 320px;
  }

  .processing-icon {
    color: oklch(0.7 0.15 155);
  }

  .processing-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
  }

  .processing-status {
    font-size: 0.9375rem;
    color: oklch(0.85 0 0);
    text-align: center;
  }

  .progress-track {
    width: 100%;
    height: 6px;
    background: oklch(0.2 0 0);
    border-radius: 9999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: oklch(0.6 0.18 155);
    border-radius: 9999px;
    transition: width 0.2s ease;
  }

  .progress-pct {
    font-size: 0.75rem;
    color: oklch(0.5 0 0);
    font-variant-numeric: tabular-nums;
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
