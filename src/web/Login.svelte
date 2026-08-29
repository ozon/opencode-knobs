<script lang="ts">
  import { api } from "./api";

  let code = $state("");
  let error = $state("");
  let loading = $state(false);
  const { onsuccess }: { onsuccess: () => void } = $props();

  async function submit() {
    loading = true;
    error = "";
    try {
      await api.login(code);
      onsuccess();
    } catch (e: any) {
      error = e.body?.error ?? "login failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="login">
  <div class="card">
    <h1>opencode-knobs</h1>
    <p>Enter the one-time login code from your terminal.</p>
    <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <input
        type="text"
        maxlength="8"
        placeholder="XXXXXXXX"
        value={code}
        oninput={(e) => (code = (e.currentTarget as HTMLInputElement).value.toUpperCase())}
        disabled={loading}
        autofocus
      />
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <button type="submit" class="primary" disabled={loading || code.length === 0}>
        {loading ? "Logging in…" : "Login"}
      </button>
    </form>
  </div>
</div>

<style>
  .login {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 16px;
  }
  .card {
    background: var(--bg-1);
    border: 1px solid var(--bg-3);
    border-radius: 8px;
    padding: 32px;
    max-width: 360px;
    width: 100%;
    text-align: center;
  }
  h1 { font-size: 16px; margin-bottom: 8px; color: var(--accent); }
  p { color: var(--fg-1); font-size: 12px; margin-bottom: 16px; }
  input { width: 100%; text-align: center; font-size: 18px; letter-spacing: 3px; margin-bottom: 12px; }
  .error { color: var(--danger); margin-bottom: 8px; }
  button { width: 100%; padding: 8px; margin-top: 4px; }

  @media (max-width: 640px) {
    .card { padding: 24px 16px; }
    h1 { font-size: 15px; }
    input { font-size: 16px; letter-spacing: 2px; }
  }
</style>
