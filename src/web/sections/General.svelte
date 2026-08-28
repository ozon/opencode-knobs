<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
  const secretPaths = ["provider"];
</script>

<h2>General</h2>
<SchemaForm
  {store}
  schema={store.schema}
  path={[]}
  onlyKeys={[
    "model", "small_model", "default_agent", "username", "shell", "logLevel",
    "autoupdate", "share", "snapshot", "subagent_depth", "instructions",
    "skills", "plugin", "watcher", "server", "compaction", "attachment", "tool_output",
  ]}
  {secretPaths}
/>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
