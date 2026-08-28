<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});
  let newAgentId = $state("");

  const BUILT_INS = ["build", "plan", "general", "explore", "title", "summary", "compaction"];
  const AGENT_FIELDS = [
    "description", "mode", "model", "variant", "temperature", "top_p",
    "prompt", "color", "steps", "hidden", "disable", "permission", "options",
  ];

  function agentSchema(): any {
    return store.defs.AgentConfig ?? { properties: {} };
  }

  function getAgents(): Record<string, any> {
    const a = (store.json as any)?.agent;
    return typeof a === "object" && a !== null ? a : {};
  }

  function getAgent(id: string): any {
    return getAgents()[id];
  }

  function customAgents(): string[] {
    return Object.keys(getAgents()).filter((id) => !BUILT_INS.includes(id));
  }

  function addAgent() {
    const agents = getAgents();
    let id = newAgentId.trim();
    if (!id) {
      let n = Object.keys(agents).length + 1;
      while (`custom-${n}` in agents) n++;
      id = `custom-${n}`;
    }
    if (id in agents) return;
    store.patch(["agent", id], {});
    collapsed[id] = false;
    newAgentId = "";
  }

  function addOverride(id: string) {
    store.patch(["agent", id], {});
    collapsed[id] = false;
  }

  function removeAgent(id: string) {
    store.patch(["agent", id], undefined);
  }

  function toggleAgent(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function agentError(id: string): string | undefined {
    return store.allErrors.find((e) => e.path === `/agent/${id}` || e.path.startsWith(`/agent/${id}/`))?.message;
  }
</script>

<h2>Agents</h2>

<div class="agents">
  {#each BUILT_INS as agentId (agentId)}
    {@const agent = getAgent(agentId)}
    {@const isCollapsed = collapsed[agentId] ?? true}
    {@const error = agentError(agentId)}

    <div class="agent-card">
      <div class="card-header" onclick={() => toggleAgent(agentId)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{agentId}</strong>
        {#if error}<span class="error">{error}</span>{/if}
        {#if !agent}<span class="empty-badge">defaults</span>{/if}
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          {#if agent}
            <SchemaForm {store} schema={agentSchema()} path={["agent", agentId]} onlyKeys={AGENT_FIELDS} />
          {:else}
            <p class="empty">No overrides — using defaults.</p>
            <button onclick={() => addOverride(agentId)}>+ add override</button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <h3>Custom Agents</h3>
  {#each customAgents() as agentId (agentId)}
    {@const isCollapsed = collapsed[agentId] ?? true}
    {@const error = agentError(agentId)}

    <div class="agent-card custom">
      <div class="card-header" onclick={() => toggleAgent(agentId)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{agentId}</strong>
        {#if error}<span class="error">{error}</span>{/if}
        <button class="danger remove" onclick={(e) => { e.stopPropagation(); removeAgent(agentId); }}>×</button>
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          <SchemaForm {store} schema={agentSchema()} path={["agent", agentId]} onlyKeys={AGENT_FIELDS} />
        </div>
      {/if}
    </div>
  {/each}

  <div class="add-row">
    <input type="text" placeholder="new agent id" bind:value={newAgentId}
      onkeydown={(e) => { if (e.key === "Enter") addAgent(); }} />
    <button onclick={addAgent}>+ add custom agent</button>
  </div>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  h3 { font-size: 13px; color: var(--fg-1); margin: 16px 0 8px; }
  .agent-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .agent-card.custom { border-left: 2px solid var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .remove { margin-left: auto; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .empty { color: var(--fg-2); font-size: 12px; font-style: italic; margin-bottom: 8px; }
  .empty-badge { font-size: 10px; color: var(--fg-2); border: 1px solid var(--bg-3); border-radius: var(--radius); padding: 1px 6px; }
  .error { color: var(--danger); font-size: 11px; }
  .add-row { display: flex; gap: 8px; align-items: flex-end; margin-top: 12px; }
  .add-row input { flex: 1; max-width: 320px; font-family: var(--font); font-size: 12px; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
