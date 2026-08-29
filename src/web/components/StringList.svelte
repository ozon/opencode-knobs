<script lang="ts">
  let { value = [], onchange }: { value?: string[]; onchange: (v: string[]) => void } = $props();
  let items = $state([...(value ?? [])]);

  function add() { items = [...items, ""]; }
  function remove(i: number) { items = items.filter((_, idx) => idx !== i); onchange(items); }
  function update(i: number, v: string) { items = items.map((old, idx) => idx === i ? v : old); onchange(items); }
</script>

{#each items as item, i}
  <div class="row">
    <input type="text" value={item} oninput={(e) => update(i, (e.currentTarget as HTMLInputElement).value)} />
    <button class="danger" onclick={() => remove(i)} title="remove">×</button>
  </div>
{/each}
<button onclick={add}>+ add</button>

<style>
  .row { display: flex; gap: 4px; margin-bottom: 4px; }
  .row input { flex: 1; min-width: 0; }
  button { font-size: 11px; padding: 2px 6px; }

  @media (max-width: 640px) {
    .row { flex-wrap: wrap; }
    .row input { min-width: 100%; }
  }
</style>
