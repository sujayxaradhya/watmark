<script lang="ts">
  import { Eraser } from "lucide-svelte";
</script>

<div class="header">
  <div class="header-inner">
    <a href="/" class="header-brand">
      <div class="brand-icon">
        <Eraser size={18} />
      </div>
      <span class="brand-name">WatMark</span>
    </a>
    <p class="header-tagline">Remove watermarks with precision</p>
  </div>
  <hr class="header-divider" />
</div>

<style>
  .header {
    background: oklch(0.11 0 0);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    text-decoration: none;
    color: oklch(0.95 0 0);
  }

  .brand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: oklch(0.55 0.18 155);
    border-radius: 0.5rem;
    color: oklch(0.98 0 0);
  }

  .brand-name {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .header-tagline {
    font-size: 0.8125rem;
    color: oklch(0.5 0 0);
  }

  .header-divider {
    border: none;
    border-top: 1px solid oklch(0.18 0 0);
    margin: 0;
  }
</style>
