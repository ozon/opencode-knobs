<script lang="ts">
  import Login from "./Login.svelte";
  import General from "./sections/General.svelte";
  import Tui from "./sections/Tui.svelte";
  import Misc from "./sections/Misc.svelte";
  import Permissions from "./sections/Permissions.svelte";
  import Providers from "./sections/Providers.svelte";
  import { api } from "./api";
  import { DocStore } from "./state/doc-store.svelte";
  import { ensureValidators } from "./state/validate";
  import { loadCatalog } from "./state/catalog";

  let loggedIn = $state(false);
  let loading = $state(true);
  let serverGone = $state(false);
  let saveError = $state("");
  let activeTab = $state<"general"|"providers"|"agents"|"mcp"|"permissions"|"formatter"|"tui"|"misc"|"raw">("general");
  let activeDoc = $state<"config"|"tui">("tui");

  const configDoc = new DocStore("config");
  const tuiDoc = new DocStore("tui");
  const currentDoc = $derived(activeTab === "tui" ? tuiDoc : activeDoc === "tui" ? tuiDoc : configDoc);
  const anyDirty = $derived(configDoc.dirty || tuiDoc.dirty);
  const hasErrors = $derived(!configDoc.valid || !tuiDoc.valid);

  async function checkSession() {
    try { await api.health(); loggedIn = true; }
    catch { loggedIn = false; }
    finally { loading = false; }
  }

  async function loadAll() {
    await ensureValidators();
    await Promise.all([configDoc.load(), tuiDoc.load(), loadCatalog()]);
  }

  $effect(() => {
    checkSession();
  });

  $effect(() => {
    if (loggedIn) loadAll();
  });

  $effect(() => {
    if (!loggedIn) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });

  async function save() {
    saveError = "";
    try {
      const results = await Promise.all([
        configDoc.dirty ? configDoc.save() : { ok: true },
        tuiDoc.dirty ? tuiDoc.save() : { ok: true },
      ]);
      const failures = results.filter((r: any) => !r.ok);
      if (failures.length > 0) saveError = `save failed for ${failures.map((f: any) => f.status).join(", ")}`;
    } catch {
      serverGone = true;
    }
  }

  async function forceSave() {
    saveError = "";
    try {
      const [c, t] = await Promise.all([
        configDoc.dirty ? configDoc.save(true) : { ok: true },
        tuiDoc.dirty ? tuiDoc.save(true) : { ok: true },
      ]);
      if (!c.ok || !t.ok) saveError = "force save failed";
    } catch {
      serverGone = true;
    }
  }

  const tabs = [
    { id: "general", label: "General" },
    { id: "providers", label: "Providers" },
    { id: "agents", label: "Agents" },
    { id: "mcp", label: "MCP" },
    { id: "permissions", label: "Permissions" },
    { id: "formatter", label: "Formatter & LSP" },
    { id: "tui", label: "TUI" },
    { id: "misc", label: "Misc" },
    { id: "raw", label: "Raw" },
  ] as const;
</script>

{#if loading}
  <div class="loading">Loading…</div>
{:else if !loggedIn}
  <Login onsuccess={() => { loggedIn = true; loading = false; }} />
{:else if serverGone}
  <div class="server-gone">
    <h2>Server stopped</h2>
    <p>The server is no longer responding.</p>
    <button onclick={() => { serverGone = false; checkSession(); }}>reconnect</button>
  </div>
{:else}
  <header>
    <h1>opencode-knobs</h1>
    <nav>
      {#each tabs as t}
        <button class:active={activeTab === t.id} onclick={() => activeTab = t.id}>{t.label}</button>
      {/each}
    </nav>
    <div class="header-right">
      {#if activeTab === "raw" || activeTab === "tui"}
        <div class="doc-switcher">
          <button class:active={activeDoc === "config"} onclick={() => activeDoc = "config"}>config</button>
          <button class:active={activeDoc === "tui"} onclick={() => activeDoc = "tui"}>tui</button>
        </div>
      {/if}
      {#if saveError}<span class="error">{saveError}</span>{/if}
      <button class="primary save" onclick={save} disabled={!anyDirty}>
        {anyDirty ? "Save ●●" : "Save"}
        {#if configDoc.dirty}<span class="dot c">{configDoc.exists ? "c" : "C"}</span>{/if}
        {#if tuiDoc.dirty}<span class="dot t">{tuiDoc.exists ? "t" : "T"}</span>{/if}
      </button>
    </div>
  </header>

  <main>
    {#if activeTab === "general"}
      <General store={configDoc} />
  {:else if activeTab === "providers"}
    <Providers store={configDoc} />
  {:else if activeTab === "agents"}
    <p>Agents (coming next)</p>
    {:else if activeTab === "mcp"}
      <p>MCP (coming next)</p>
    {:else if activeTab === "permissions"}
      <Permissions store={configDoc} />
    {:else if activeTab === "formatter"}
      <p>Formatter & LSP (coming next)</p>
    {:else if activeTab === "tui"}
      <Tui store={tuiDoc} />
    {:else if activeTab === "misc"}
      <Misc store={configDoc} />
    {:else if activeTab === "raw"}
      <p>Raw (coming next)</p>
    {/if}
  </main>
{/if}

<style>
  .loading, .server-gone {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; gap: 12px; color: var(--fg-1);
  }
  .server-gone h2 { color: var(--danger); }
  header {
    display: flex; align-items: center; gap: 16px; padding: 8px 16px;
    background: var(--bg-1); border-bottom: 1px solid var(--bg-3); position: sticky; top: 0; z-index: 50;
  }
  h1 { font-size: 14px; color: var(--accent); margin: 0; white-space: nowrap; }
  nav { display: flex; gap: 2px; flex: 1; overflow-x: auto; }
  nav button {
    background: none; border: none; color: var(--fg-2); font-size: 12px; padding: 6px 10px; border-radius: var(--radius);
  }
  nav button:hover { color: var(--fg-0); background: var(--bg-2); }
  nav button.active { color: var(--accent); background: var(--bg-2); }
  .header-right { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .doc-switcher { display: flex; gap: 2px; background: var(--bg-2); border-radius: var(--radius); padding: 2px; }
  .doc-switcher button { background: none; border: none; color: var(--fg-2); font-size: 11px; padding: 2px 8px; border-radius: 3px; }
  .doc-switcher button.active { color: var(--fg-0); background: var(--bg-3); }
  .save { font-size: 12px; padding: 4px 12px; }
  .save:disabled { opacity: 0.4; }
  .dot { font-size: 9px; margin-left: 4px; }
  .dot.c { color: var(--warn); }
  .dot.t { color: var(--accent); }
  .error { color: var(--danger); font-size: 11px; }
  main { padding: 16px; max-width: 900px; margin: 0 auto; }
</style>
