<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
</script>

<h2>TUI</h2>
<SchemaForm {store} schema={store.schema} path={[]} />

<div class="keybinds-note">
  <p>Keybindings can only be edited in the <strong>Raw</strong> tab.</p>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .keybinds-note {
    margin-top: 16px; padding: 10px 12px; background: var(--bg-2); border-radius: var(--radius);
    border-left: 3px solid var(--accent); font-size: 12px; color: var(--fg-1);
  }
</style>
