<script lang="ts">
  let {
    value, options, label, onchange, filterFn,
  }: {
    value: string; options: Array<{ id: string; label: string }>; label?: string;
    onchange: (v: string) => void; filterFn?: (opt: { id: string; label: string }, query: string) => boolean;
  } = $props();

  let query = $state(value);
  let open = $state(false);
  let highlight = $state(-1);

  let filtered = $derived(
    query
      ? (options ?? []).filter((o) => filterFn ? filterFn(o, query) : o.id.toLowerCase().includes(query.toLowerCase()) || o.label.toLowerCase().includes(query.toLowerCase()))
      : (options ?? [])
  );

  function select(id: string) { query = id; onchange(id); open = false; highlight = -1; }
  function onKey(e: KeyboardEvent) {
    if (!open) { open = true; return; }
    if (e.key === "ArrowDown") { highlight = Math.min(highlight + 1, filtered.length - 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { highlight = Math.max(highlight - 1, 0); e.preventDefault(); }
    else if (e.key === "Enter" && highlight >= 0) { select(filtered[highlight].id); e.preventDefault(); }
    else if (e.key === "Escape") { open = false; }
  }
</script>

<div class="combobox">
  {#if label}<label>{label}</label>{/if}
  <input type="text" value={query} oninput={(e) => { query = (e.currentTarget as HTMLInputElement).value; open = true; highlight = -1; }}
    onfocus={() => { open = true; }} onblur={() => { setTimeout(() => { open = false; }, 150); }} onkeydown={onKey} />
  {#if open && filtered.length > 0}
    <ul>
      {#each filtered.slice(0, 30) as opt, i}
        <li class:highlight={i === highlight} onmousedown={() => select(opt.id)}>
          <span class="id">{opt.id}</span>
          {#if opt.label !== opt.id}<span class="name">{opt.label}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .combobox { position: relative; }
  input { width: 100%; }
  ul { position: absolute; top: 100%; left: 0; right: 0; z-index: 100; background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); max-height: 200px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  li { padding: 4px 8px; cursor: pointer; font-size: 12px; display: flex; gap: 6px; }
  li:hover, li.highlight { background: var(--bg-2); }
  .id { font-family: var(--font); }
  .name { color: var(--fg-2); font-size: 11px; }
  label { display: block; font-size: 11px; color: var(--fg-1); margin-bottom: 2px; }
</style>
