<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import StringList from "../components/StringList.svelte";
  import KVEditor from "../components/KVEditor.svelte";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});
  let addingType = $state<"local" | "remote">("local");
  let newServerId = $state("");

  const OAUTH_FIELDS = ["clientId", "clientSecret", "scope", "redirectUri"];

  function getMcp(): Record<string, any> {
    const m = (store.json as any)?.mcp;
    return typeof m === "object" && m !== null ? m : {};
  }

  function serverEntries(): [string, any][] {
    return Object.entries(getMcp()).filter(([id]) => id !== "$schema");
  }

  function addServer() {
    const servers = getMcp();
    let id = newServerId.trim();
    if (!id) {
      let n = Object.keys(servers).length + 1;
      while (`mcp-${n}` in servers) n++;
      id = `mcp-${n}`;
    }
    if (id in servers) return;
    store.patch(["mcp", id], { type: addingType });
    collapsed[id] = false;
    newServerId = "";
  }

  function removeServer(id: string) {
    store.patch(["mcp", id], undefined);
  }

  function toggleServer(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function changeType(id: string, type: "local" | "remote") {
    const server = getMcp()[id];
    if (!server || server?.type === type) return;
    store.patch(["mcp", id, "type"], type);
    const staleKeys = type === "local" ? ["url", "headers", "oauth"] : ["command", "cwd", "environment"];
    for (const k of staleKeys) {
      if (server[k] !== undefined) store.patch(["mcp", id, k], undefined);
    }
  }

  function setOauth(id: string, server: any, on: boolean) {
    if (!on) {
      store.patch(["mcp", id, "oauth"], false);
    } else if (typeof server?.oauth !== "object" || server.oauth === null) {
      store.patch(["mcp", id, "oauth"], {});
    }
  }

  function serverError(id: string): string | undefined {
    return store.allErrors.find((e) => e.path === `/mcp/${id}` || e.path.startsWith(`/mcp/${id}/`))?.message;
  }
</script>

<h2>MCP Servers</h2>

<div class="mcp-list">
  {#each serverEntries() as [id, server] (id)}
    {@const isCollapsed = collapsed[id] ?? true}
    {@const error = serverError(id)}

    <div class="server-card">
      <div class="card-header" onclick={() => toggleServer(id)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{id}</strong>
        <span class="type-badge">{server?.type ?? "?"}</span>
        {#if error}<span class="error">{error}</span>{/if}
        <button class="danger remove" onclick={(e) => { e.stopPropagation(); removeServer(id); }}>×</button>
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          <Field label="type">
            <select onchange={(e) => changeType(id, (e.currentTarget as HTMLSelectElement).value as "local" | "remote")}>
              <option value="local" selected={server?.type === "local"}>local</option>
              <option value="remote" selected={server?.type === "remote"}>remote</option>
            </select>
          </Field>

          {#if server?.type === "local"}
            <Field label="command">
              <StringList value={Array.isArray(server.command) ? server.command : []}
                onchange={(v) => store.patch(["mcp", id, "command"], v.length > 0 ? v : undefined)} />
            </Field>
            <Field label="environment">
              <KVEditor value={typeof server.environment === "object" && server.environment !== null ? server.environment : {}}
                onchange={(v) => store.patch(["mcp", id, "environment"], Object.keys(v).length > 0 ? v : undefined)} />
            </Field>
            <Field label="cwd">
              <input type="text" value={server.cwd ?? ""}
                onchange={(e) => store.patch(["mcp", id, "cwd"], (e.currentTarget as HTMLInputElement).value || undefined)} />
            </Field>
          {:else if server?.type === "remote"}
            <Field label="url">
              <input type="text" value={server.url ?? ""}
                onchange={(e) => store.patch(["mcp", id, "url"], (e.currentTarget as HTMLInputElement).value || undefined)} />
            </Field>
            <Field label="headers">
              <KVEditor value={typeof server.headers === "object" && server.headers !== null ? server.headers : {}}
                onchange={(v) => store.patch(["mcp", id, "headers"], Object.keys(v).length > 0 ? v : undefined)} />
            </Field>
            <Field label="oauth" help="unchecked disables OAuth auto-detection">
              <label class="toggle">
                <input type="checkbox" checked={server.oauth !== false}
                  onchange={(e) => setOauth(id, server, (e.currentTarget as HTMLInputElement).checked)} />
                <span>{server.oauth === false ? "off" : typeof server.oauth === "object" && server.oauth !== null ? "configured" : "auto"}</span>
              </label>
            </Field>
            {#if typeof server.oauth === "object" && server.oauth !== null}
              <div class="oauth">
                {#each OAUTH_FIELDS as f}
                  <Field label={f}>
                    <input type="text" value={server.oauth?.[f] ?? ""}
                      onchange={(e) => store.patch(["mcp", id, "oauth", f], (e.currentTarget as HTMLInputElement).value || undefined)} />
                  </Field>
                {/each}
                <Field label="callbackPort">
                  <input type="number" value={typeof server.oauth?.callbackPort === "number" ? server.oauth.callbackPort : ""}
                    onchange={(e) => store.patch(["mcp", id, "oauth", "callbackPort"], (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
                </Field>
              </div>
            {/if}
          {/if}

          <div class="row">
            <Field label="enabled">
              <label class="toggle">
                <input type="checkbox" checked={server?.enabled !== false}
                  onchange={(e) => store.patch(["mcp", id, "enabled"], (e.currentTarget as HTMLInputElement).checked)} />
                <span>{server?.enabled !== false ? "on" : "off"}</span>
              </label>
            </Field>
            <Field label="timeout">
              <input type="number" value={typeof server?.timeout === "number" ? server.timeout : ""}
                onchange={(e) => store.patch(["mcp", id, "timeout"], (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
            </Field>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<div class="add-row">
  <input type="text" placeholder="server id" value={newServerId}
    oninput={(e) => { newServerId = (e.currentTarget as HTMLInputElement).value; }}
    onkeydown={(e) => { if (e.key === "Enter") addServer(); }} />
  <select bind:value={addingType}>
    <option value="local">local</option>
    <option value="remote">remote</option>
  </select>
  <button onclick={addServer}>+ add server</button>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .server-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .type-badge { font-size: 10px; color: var(--fg-2); background: var(--bg-2); padding: 1px 6px; border-radius: 3px; }
  .remove { margin-left: auto; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .oauth { padding-left: 8px; border-left: 1px solid var(--bg-3); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row :global(.field) { flex: 1; min-width: 110px; }
  .add-row { display: flex; gap: 8px; align-items: flex-end; margin-top: 12px; }
  .add-row input[type="text"] { flex: 1; max-width: 320px; font-family: var(--font); font-size: 12px; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
  .toggle input { width: auto; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
