<script lang="ts">
  import "../app.css";
  import Header from "../components/header.svelte";

  const { children } = $props();
</script>

<div class="app-shell">
  <Header />
  <main class="app-main">
    {@render children()}
  </main>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-main {
    flex: 1;
    overflow-y: auto;
  }
</style>
