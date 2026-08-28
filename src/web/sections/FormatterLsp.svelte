<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import StringList from "../components/StringList.svelte";
  import KVEditor from "../components/KVEditor.svelte";

  let { store }: { store: DocStore } = $props();
  let newTool = $state<Record<string, string>>({});

  function getValue(key: string): any {
    return (store.json as any)?.[key];
  }

  function isObject(val: any): boolean {
    return typeof val === "object" && val !== null;
  }

  function entries(key: string): [string, any][] {
    const v = getValue(key);
    return isObject(v) ? Object.entries(v) : [];
  }

  function addTool(key: string) {
    const name = (newTool[key] ?? "").trim();
    if (!name) return;
    const v = getValue(key);
    if (!isObject(v) || name in v) return;
    store.patch([key, name], {});
    newTool[key] = "";
  }

  function removeTool(key: string, name: string) {
    store.patch([key, name], undefined);
  }

  function setDisabled(key: string, name: string, disabled: boolean) {
    store.patch([key, name, "disabled"], disabled || undefined);
  }

  function setList(key: string, name: string, field: string, v: string[]) {
    store.patch([key, name, field], v.length > 0 ? v : undefined);
  }

  function setEnv(key: string, name: string, field: string, v: Record<string, unknown>) {
    store.patch([key, name, field], Object.keys(v).length > 0 ? v : undefined);
  }

  function entryError(key: string, name: string): string | undefined {
    const prefix = `/${key}/${name}`;
    return store.allErrors.find((e) => e.path === prefix || e.path.startsWith(`${prefix}/`))?.message;
  }
</script>

{#snippet section(key, envField, help)}
  {@const value = getValue(key)}
  <Field label={key} {help}>
    {#if value === undefined}
      <div class="toggle-row">
        <span class="status">not configured</span>
        <button onclick={() => store.patch([key], true)}>enable</button>
      </div>
    {:else if typeof value === "boolean"}
      <div class="toggle-row">
        <span class="status">{value ? "enabled (all tools)" : "disabled"}</span>
        <button onclick={() => store.patch([key], !value)}>{value ? "disable" : "enable"}</button>
        <button onclick={() => store.patch([key], {})}>configure per-tool</button>
      </div>
    {:else}
      <div class="toggle-row">
        <span class="status">per-tool configuration</span>
        <button onclick={() => store.patch([key], true)}>set all on</button>
        <button class="danger" onclick={() => store.patch([key], false)}>disable</button>
      </div>

      {#each entries(key) as [name, cfg] (name)}
        {@const error = entryError(key, name)}
        <div class="tool">
          <div class="tool-header">
            <span class="tool-name">{name}</span>
            {#if error}<span class="error">{error}</span>{/if}
            <label class="check">
              <input type="checkbox" checked={cfg?.disabled === true}
                onchange={(e) => setDisabled(key, name, (e.currentTarget as HTMLInputElement).checked)} />
              disabled
            </label>
            <button class="danger" onclick={() => removeTool(key, name)}>×</button>
          </div>
          <div class="tool-body">
            <Field label="command">
              <StringList value={Array.isArray(cfg?.command) ? cfg.command : []}
                onchange={(v) => setList(key, name, "command", v)} />
            </Field>
            <Field label="extensions">
              <StringList value={Array.isArray(cfg?.extensions) ? cfg.extensions : []}
                onchange={(v) => setList(key, name, "extensions", v)} />
            </Field>
            <Field label={envField}>
              <KVEditor value={isObject(cfg?.[envField]) ? cfg[envField] : {}}
                onchange={(v) => setEnv(key, name, envField, v)} />
            </Field>
          </div>
        </div>
      {/each}

      <div class="add-row">
        <input type="text" placeholder="tool name" value={newTool[key] ?? ""}
          oninput={(e) => { newTool[key] = (e.currentTarget as HTMLInputElement).value; }}
          onkeydown={(e) => { if (e.key === "Enter") addTool(key); }} />
        <button onclick={() => addTool(key)}>+ add tool</button>
      </div>
    {/if}
  </Field>
{/snippet}

<h2>Formatter & LSP</h2>

<div class="section">
  {@render section("formatter", "environment", "Omit or false to disable, true to enable built-ins, or an object to enable built-ins with overrides")}
  {@render section("lsp", "env", "Omit or false to disable, true to enable built-ins, or an object of per-tool overrides")}
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .section { max-width: 640px; }
  .toggle-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 12px; }
  .status { color: var(--fg-1); }
  .tool { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .tool-header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
  .tool-name { font-family: var(--font); font-size: 13px; flex: 1; }
  .tool-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .check { display: flex; gap: 4px; align-items: center; font-size: 11px; color: var(--fg-1); }
  .check input { width: auto; }
  .add-row { display: flex; gap: 8px; align-items: flex-end; margin-top: 4px; }
  .add-row input { flex: 1; max-width: 320px; font-family: var(--font); font-size: 12px; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 8px; }
</style>
