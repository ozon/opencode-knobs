<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";

  let { store }: { store: DocStore } = $props();

  const PERMISSION_CAPABILITIES = [
    "read", "edit", "bash", "glob", "grep", "list",
    "task", "skill", "lsp", "webfetch", "websearch", "codesearch",
    "todoread", "todowrite", "question", "external_directory", "doom_loop",
  ] as const;

  const PATTERN_CAPS = ["bash", "edit", "read", "external_directory", "glob", "grep", "list", "task", "lsp", "skill"] as const;
  type PermValue = string | { [pattern: string]: string } | undefined;

  function getPerm(cap: string): PermValue {
    const perm = (store.json as any)?.permission;
    return perm?.[cap];
  }

  function setPerm(cap: string, value: string) {
    store.patch(["permission", cap], value === "(unset)" ? undefined : value);
  }

  function addPattern(cap: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    obj[""] = "ask";
    store.patch(["permission", cap], obj);
  }

  function setPattern(cap: string, oldPattern: string, newPattern: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    const val = obj[oldPattern];
    delete obj[oldPattern];
    if (newPattern) obj[newPattern] = val ?? "ask";
    store.patch(["permission", cap], obj);
  }

  function setPatternAction(cap: string, pattern: string, action: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    obj[pattern] = action;
    store.patch(["permission", cap], obj);
  }

  function removePattern(cap: string, pattern: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    delete obj[pattern];
    store.patch(["permission", cap], Object.keys(obj).length > 0 ? obj : undefined);
  }

  function getTools(): Record<string, boolean> {
    const tools = (store.json as any)?.tools;
    return typeof tools === "object" && tools !== null ? tools : {};
  }

  function setTool(name: string, enabled: boolean | undefined) {
    store.patch(["tools", name], enabled);
  }

  function addTool(name: string) {
    if (!name) return;
    store.patch(["tools", name], true);
  }

  let newTool = $state("");
</script>

<h2>Permissions</h2>

{#each PERMISSION_CAPABILITIES as cap}
  {@const perm = getPerm(cap)}
  {@const isPattern = typeof perm === "object" && perm !== null}
  {@const error = store.allErrors.find((e) => e.path === `/permission/${cap}`)?.message}

  <div class="cap">
    <div class="cap-header">
      <strong>{cap}</strong>
      {#if error}<span class="error">{error}</span>{/if}
    </div>

    {#if isPattern}
      <div class="pattern-list">
        {#each Object.entries(perm) as [pattern, action]}
          <div class="pattern-row">
            <input type="text" value={pattern} placeholder="pattern"
              oninput={(e) => setPattern(cap, pattern, (e.currentTarget as HTMLInputElement).value)} />
            <select value={action} onchange={(e) => setPatternAction(cap, pattern, (e.currentTarget as HTMLSelectElement).value)}>
              {#each ["ask", "allow", "deny"] as opt}
                <option value={opt} selected={action === opt}>{opt}</option>
              {/each}
            </select>
            <button class="danger" onclick={() => removePattern(cap, pattern)}>×</button>
          </div>
        {/each}
        <button onclick={() => addPattern(cap)}>+ add pattern</button>
      </div>
    {:else}
      <div class="cap-controls">
        <select value={perm ?? "(unset)"} onchange={(e) => setPerm(cap, (e.currentTarget as HTMLSelectElement).value)}>
          {#each ["(unset)", "ask", "allow", "deny"] as opt}
            <option value={opt} selected={(perm ?? "(unset)") === opt}>{opt}</option>
          {/each}
        </select>
        {#if PATTERN_CAPS.includes(cap as any)}
          <button class="add-pattern" onclick={() => addPattern(cap)}>+ pattern rules</button>
        {/if}
      </div>
    {/if}
  </div>
{/each}

<h2>Tools (deprecated)</h2>
<p class="help">Boolean tool enable/disable map. Prefer the permission controls above.</p>
<div class="tools">
  {#each Object.entries(getTools()) as [name, enabled]}
    <div class="tool-row">
      <label>
        <input type="checkbox" checked={enabled === true}
          onchange={(e) => setTool(name, (e.currentTarget as HTMLInputElement).checked)} />
        {name}
      </label>
      <button class="danger" onclick={() => setTool(name, undefined)}>×</button>
    </div>
  {/each}
  <div class="tool-row">
    <input type="text" placeholder="tool name" bind:value={newTool}
      onkeydown={(e) => { if (e.key === "Enter") { addTool(newTool); newTool = ""; } }} />
    <button onclick={() => { addTool(newTool); newTool = ""; }}>+ add tool</button>
  </div>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .help { font-size: 11px; color: var(--fg-2); margin: -6px 0 12px; }
  .cap { margin-bottom: 12px; padding: 8px; background: var(--bg-1); border-radius: var(--radius); }
  .cap-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .cap-header strong { font-size: 12px; min-width: 160px; font-family: var(--font); }
  .cap-controls { display: flex; gap: 8px; align-items: center; }
  .pattern-list { margin-left: 12px; }
  .pattern-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .pattern-row input:first-child { flex: 1; font-family: var(--font); font-size: 12px; }
  .pattern-row select { width: 100px; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 6px; }
  .add-pattern { margin-top: 4px; }
  .tools { margin-bottom: 12px; padding: 8px; background: var(--bg-1); border-radius: var(--radius); }
  .tool-row { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
  .tool-row label { display: flex; gap: 6px; align-items: center; font-size: 12px; font-family: var(--font); flex: 1; }
  .tool-row input[type="text"] { flex: 1; font-family: var(--font); font-size: 12px; }
</style>
