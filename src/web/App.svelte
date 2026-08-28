<script lang="ts">
  import Login from "./Login.svelte";
  import { api } from "./api";

  let loggedIn = $state(false);
  let loading = $state(true);
  let error = $state("");

  async function checkSession() {
    try {
      await api.health();
      loggedIn = true;
    } catch {
      loggedIn = false;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    checkSession();
  });
</script>

{#if loading}
  <div class="loading">Loading…</div>
{:else if !loggedIn}
  <Login onsuccess={() => { loggedIn = true; loading = false; }} />
{:else}
  <div class="shell">opencode-knobs (logged in)</div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: var(--fg-2);
  }
  .shell {
    padding: var(--spacing-md);
    color: var(--fg-1);
  }
</style>
