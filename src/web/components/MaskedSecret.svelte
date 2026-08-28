<script lang="ts">
  let { value, onchange }: { value?: string; onchange: (v: string | undefined) => void } = $props();
  let editing = $state(false);
  let temp = $state("");
  let clearing = $state(false);
</script>

{#if editing}
  <div class="row">
    <input type="text" placeholder="leave blank to keep unchanged" value={temp}
      oninput={(e) => { temp = (e.currentTarget as HTMLInputElement).value; }}
      onkeydown={(e) => { if (e.key === "Enter") { onchange(temp || undefined); editing = false; } if (e.key === "Escape") editing = false; }}
      autofocus />
    <button onclick={() => { onchange(temp || undefined); editing = false; }}>save</button>
    <button onclick={() => { editing = false; temp = ""; }}>cancel</button>
    <button class="danger" onclick={() => { clearing = true; }}>clear</button>
  </div>
  {#if clearing}
    <p class="warn">Are you sure? This will remove the secret.</p>
    <div class="row">
      <button class="danger" onclick={() => { onchange(undefined); editing = false; clearing = false; }}>yes, clear</button>
      <button onclick={() => { clearing = false; }}>no</button>
    </div>
  {/if}
{:else}
  <div class="row">
    <span class="masked">••••••••</span>
    <button onclick={() => { editing = true; temp = ""; }}>edit</button>
  </div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 4px; }
  .masked { color: var(--fg-2); font-size: 12px; padding: 4px 8px; background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); }
  .warn { color: var(--warn); font-size: 11px; margin: 4px 0; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
