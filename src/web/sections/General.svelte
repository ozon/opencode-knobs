<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";
  import { entries } from "../schema/walker";

  let { store }: { store: DocStore } = $props();
  const secretPaths = ["provider"];
  const DEDICATED = ["provider", "agent", "mcp", "permission", "formatter", "lsp"];

  const allKeys = $derived(
    store.schema ? [...entries(store.schema, store.defs, store.defName)].map(([n]) => n) : []
  );
  const generalKeys = $derived(
    allKeys.filter((k) => !DEDICATED.includes(k) && k !== "experimental" && k !== "enterprise")
  );
</script>

<h2>General</h2>
<SchemaForm {store} schema={store.schema} path={[]} onlyKeys={generalKeys} {secretPaths} />

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
