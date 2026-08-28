<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
</script>

<h2>Misc / Experimental</h2>
<SchemaForm {store} schema={store.schema} path={[]} onlyKeys={["enterprise", "experimental"]} />

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
