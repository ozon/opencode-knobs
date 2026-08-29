<script lang="ts">
  let { value = {}, onchange }: { value?: Record<string, unknown>; onchange: (v: Record<string, unknown>) => void } = $props();
  let entries = $state(Object.entries(value ?? {}));

  function add() { entries = [...entries, ["", ""]]; }
  function remove(i: number) { entries = entries.filter((_, idx) => idx !== i); sync(); }
  function updateKey(i: number, k: string) { entries = entries.map((old, idx) => idx === i ? [k, old[1]] as [string, unknown] : old); sync(); }
  function updateVal(i: number, v: string) { entries = entries.map((old, idx) => idx === i ? [old[0], v] as [string, unknown] : old); sync(); }
  function sync() { onchange(Object.fromEntries(entries.filter(([k]) => k))); }
</script>

{#each entries as [k, v], i}
  <div class="row">
    <input type="text" placeholder="key" value={k} oninput={(e) => updateKey(i, (e.currentTarget as HTMLInputElement).value)} />
    <input type="text" placeholder="value" value={String(v ?? "")} oninput={(e) => updateVal(i, (e.currentTarget as HTMLInputElement).value)} />
    <button class="danger" onclick={() => remove(i)} title="remove">×</button>
  </div>
{/each}
<button onclick={add}>+ add</button>

<style>
  .row { display: flex; gap: 4px; margin-bottom: 4px; }
  .row input:first-child { width: 140px; }
  .row input:nth-child(2) { flex: 1; }
  button { font-size: 11px; padding: 2px 6px; }

  @media (max-width: 640px) {
    .row { flex-wrap: wrap; }
    .row input:first-child { width: 100%; }
    .row input:nth-child(2) { min-width: 100%; }
  }
</style>
