<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";
  import { entries } from "../schema/walker";
  import { getCatalog } from "../state/catalog";

  let { store }: { store: DocStore } = $props();
  const secretPaths = ["provider"];
  const DEDICATED = ["provider", "agent", "mcp", "permission", "formatter", "lsp"];

  const allKeys = $derived(
    store.schema ? [...entries(store.schema, store.defs, store.defName)].map(([n]) => n) : []
  );
  const generalKeys = $derived(
    allKeys.filter((k) => !DEDICATED.includes(k) && k !== "experimental" && k !== "enterprise")
  );

  const modelIds = $derived(
    (getCatalog().providers ?? []).flatMap((p) => (p.models ?? []).map((m) => m.id))
  );
  const agentNames = $derived(
    [...new Set([
      "main", "build", "explore", "plan", "subagent",
      ...Object.keys((store.json?.agent as Record<string, unknown>) ?? {}),
    ])]
  );
  const suggestions = $derived({
    model: modelIds,
    small_model: modelIds,
    default_agent: agentNames,
  });
</script>

<h2>General</h2>
<SchemaForm {store} schema={store.schema} path={[]} onlyKeys={generalKeys} {secretPaths} {suggestions} />

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
