<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import MaskedSecret from "../components/MaskedSecret.svelte";
  import StringList from "../components/StringList.svelte";
  import KVEditor from "../components/KVEditor.svelte";
  import Combobox from "../components/Combobox.svelte";
  import { getCatalog } from "../state/catalog";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});
  let newProvId = $state("");
  let newModelId = $state<Record<string, string>>({});
  let newVariant = $state<Record<string, string>>({});

  const knownOptionFields = ["apiKey", "baseURL", "timeout", "chunkTimeout", "headers"];
  const stringProviderFields = ["name", "api", "id", "npm"];
  const listProviderFields = ["env", "whitelist", "blacklist"];
  const modelStatuses = ["alpha", "beta", "deprecated", "active"];
  const modelBoolFields = ["reasoning", "temperature", "tool_call", "attachment"];
  const costFields = ["input", "output", "cache_read", "cache_write"];
  const limitFields = ["context", "output"];

  function getProviders(): Record<string, any> {
    const p = (store.json as any)?.provider;
    return typeof p === "object" && p !== null ? p : {};
  }

  function providerEntries(): [string, any][] {
    return Object.entries(getProviders()).filter(([id]) => id !== "$schema");
  }

  function getProviderOpts(provId: string): Record<string, any> {
    const o = getProviders()[provId]?.options;
    return typeof o === "object" && o !== null ? o : {};
  }

  function customOpts(opts: Record<string, any>): Record<string, any> {
    return Object.fromEntries(Object.entries(opts).filter(([k]) => !knownOptionFields.includes(k)));
  }

  function setProviderOpt(provId: string, key: string, value: unknown) {
    store.patch(["provider", provId, "options", key], value);
  }

  function setCustomOpts(provId: string, kv: Record<string, unknown>) {
    const old = customOpts(getProviderOpts(provId));
    for (const k of Object.keys(old)) {
      if (!(k in kv)) store.patch(["provider", provId, "options", k], undefined);
    }
    for (const [k, v] of Object.entries(kv)) {
      if (!k) continue;
      if (!(k in old) || String(old[k]) !== String(v)) store.patch(["provider", provId, "options", k], v);
    }
  }

  function getModels(prov: any): Record<string, any> {
    const m = prov?.models;
    return typeof m === "object" && m !== null ? m : {};
  }

  function modelCfg(prov: any, modelId: string): Record<string, any> {
    const c = getModels(prov)[modelId];
    return typeof c === "object" && c !== null ? c : {};
  }

  function patchModel(provId: string, modelId: string, rest: (string | number)[], value: unknown) {
    store.patch(["provider", provId, "models", modelId, ...rest], value);
  }

  function addModel(provId: string, id: string) {
    id = id.trim();
    if (!id || getModels(getProviders()[provId])[id] !== undefined) return;
    store.patch(["provider", provId, "models", id], {});
    newModelId[provId] = "";
  }

  function removeModel(provId: string, modelId: string) {
    store.patch(["provider", provId, "models", modelId], undefined);
  }

  function renameModel(provId: string, oldId: string, newId: string) {
    newId = newId.trim();
    if (!newId || newId === oldId) return;
    const cfg = modelCfg(getProviders()[provId], oldId);
    store.patch(["provider", provId, "models", oldId], undefined);
    store.patch(["provider", provId, "models", newId], cfg);
  }

  function addProvider() {
    const id = newProvId.trim() || `provider-${Object.keys(getProviders()).length + 1}`;
    if (!(id in getProviders())) store.patch(["provider", id], {});
    collapsed[id] = false;
    newProvId = "";
  }

  function removeProvider(id: string) {
    store.patch(["provider", id], undefined);
  }

  function toggleProvider(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function setList(key: string, ids: string[]) {
    store.patch([key], ids.length > 0 ? ids : undefined);
  }

  function tri(v: unknown): string {
    return v === undefined ? "" : String(v);
  }

  function fromTri(s: string): unknown {
    return s === "" ? undefined : s === "true";
  }

  function providerOptions(): Array<{ id: string; label: string }> {
    return (getCatalog().providers ?? []).map((p) => ({ id: p.id, label: p.name ?? p.id }));
  }

  function catalogProvider(provId: string) {
    return getCatalog().providers?.find((p) => p.id === provId);
  }

  function modelOptions(provId: string): Array<{ id: string; label: string }> {
    return (catalogProvider(provId)?.models ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }));
  }

  function modelMetaText(provId: string, modelId: string): string {
    const meta = catalogProvider(provId)?.models.find((m) => m.id === modelId);
    if (!meta) return "";
    const parts: string[] = [];
    if (meta.name && meta.name !== modelId) parts.push(meta.name);
    if (meta.limit?.context) parts.push(`context ${meta.limit.context}`);
    if (meta.cost?.input != null && meta.cost?.output != null) parts.push(`$${meta.cost.input} in / $${meta.cost.output} out per M`);
    return parts.join(" · ");
  }

  function providerError(provId: string): string | undefined {
    return store.allErrors.find((e) => e.path === `/provider/${provId}` || e.path.startsWith(`/provider/${provId}/`))?.message;
  }

  function modelError(provId: string, modelId: string): string | undefined {
    const prefix = `/provider/${provId}/models/${modelId}`;
    return store.allErrors.find((e) => e.path === prefix || e.path.startsWith(`${prefix}/`))?.message;
  }

  function getVariants(cfg: any): Record<string, any> {
    const v = cfg?.variants;
    return typeof v === "object" && v !== null ? v : {};
  }

  function addVariant(provId: string, modelId: string) {
    const key = `${provId}/${modelId}`;
    const name = (newVariant[key] ?? "").trim();
    if (!name || getVariants(modelCfg(getProviders()[provId], modelId))[name] !== undefined) return;
    patchModel(provId, modelId, ["variants", name], {});
    newVariant[key] = "";
  }
</script>

<h2>Providers</h2>

{#if !getCatalog().available}
  <p class="hint">provider catalog unavailable — free-text entry only</p>
{/if}

<div class="provider-list">
  {#each providerEntries() as [provId, prov] (provId)}
    {@const opts = getProviderOpts(provId)}
    {@const isCollapsed = collapsed[provId] ?? true}
    {@const error = providerError(provId)}

    <div class="provider-card">
      <div class="card-header" onclick={() => toggleProvider(provId)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{provId}</strong>
        {#if error}<span class="error">{error}</span>{/if}
        <button class="danger remove" onclick={(e) => { e.stopPropagation(); removeProvider(provId); }}>×</button>
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          {#each stringProviderFields as f}
            {#if prov[f] !== undefined || f === "name"}
              <Field label={f}>
                <input type="text" value={prov[f] ?? ""}
                  onchange={(e) => store.patch(["provider", provId, f], (e.currentTarget as HTMLInputElement).value || undefined)} />
              </Field>
            {/if}
          {/each}

          {#each listProviderFields as f}
            {#if Array.isArray(prov[f])}
              <Field label={f}>
                <StringList value={prov[f]} onchange={(v) => store.patch(["provider", provId, f], v.length > 0 ? v : undefined)} />
              </Field>
            {/if}
          {/each}

          <Field label="options">
            <div class="opts">
              <Field label="apiKey">
                <MaskedSecret hasValue={opts.apiKey != null} onchange={(v) => setProviderOpt(provId, "apiKey", v)} onclear={() => setProviderOpt(provId, "apiKey", undefined)} />
              </Field>
              <Field label="baseURL">
                <input type="text" value={opts.baseURL ?? ""}
                  onchange={(e) => setProviderOpt(provId, "baseURL", (e.currentTarget as HTMLInputElement).value || undefined)} />
              </Field>
              <Field label="timeout">
                <input type="number" value={typeof opts.timeout === "number" ? opts.timeout : ""}
                  onchange={(e) => setProviderOpt(provId, "timeout", (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
              </Field>
              <Field label="chunkTimeout">
                <input type="number" value={typeof opts.chunkTimeout === "number" ? opts.chunkTimeout : ""}
                  onchange={(e) => setProviderOpt(provId, "chunkTimeout", (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
              </Field>
              <Field label="headers">
                <KVEditor value={typeof opts.headers === "object" && opts.headers !== null ? opts.headers : {}}
                  onchange={(v) => setProviderOpt(provId, "headers", Object.keys(v).length > 0 ? v : undefined)} />
              </Field>
              <details>
                <summary>custom options</summary>
                <KVEditor value={customOpts(opts)} onchange={(v) => setCustomOpts(provId, v)} />
              </details>
            </div>
          </Field>

          <Field label="models">
            {#each Object.entries(getModels(prov)) as [modelId] (modelId)}
              {@const cfg = modelCfg(prov, modelId)}
              {@const mErr = modelError(provId, modelId)}
              {@const metaText = modelMetaText(provId, modelId)}
              <details class="model">
                <summary>
                  <span class="model-id">{modelId}</span>
                  {#if mErr}<span class="error">{mErr}</span>{/if}
                  <button class="danger" onclick={(e) => { e.preventDefault(); removeModel(provId, modelId); }}>×</button>
                </summary>
                <div class="model-body">
                  <Field label="model id">
                    <input type="text" value={modelId}
                      onchange={(e) => renameModel(provId, modelId, (e.currentTarget as HTMLInputElement).value)} />
                  </Field>
                  {#if metaText}<p class="meta">{metaText}</p>{/if}
                  <Field label="name">
                    <input type="text" value={cfg.name ?? ""}
                      onchange={(e) => patchModel(provId, modelId, ["name"], (e.currentTarget as HTMLInputElement).value || undefined)} />
                  </Field>
                  <div class="row">
                    <Field label="status">
                      <select value={cfg.status ?? ""} onchange={(e) => patchModel(provId, modelId, ["status"], (e.currentTarget as HTMLSelectElement).value || undefined)}>
                        <option value="">(unset)</option>
                        {#each modelStatuses as s}
                          <option value={s} selected={cfg.status === s}>{s}</option>
                        {/each}
                      </select>
                    </Field>
                    {#each modelBoolFields as bf}
                      <Field label={bf}>
                        <select value={tri(cfg[bf])} onchange={(e) => patchModel(provId, modelId, [bf], fromTri((e.currentTarget as HTMLSelectElement).value))}>
                          <option value="">(unset)</option>
                          <option value="true" selected={cfg[bf] === true}>true</option>
                          <option value="false" selected={cfg[bf] === false}>false</option>
                        </select>
                      </Field>
                    {/each}
                  </div>
                  <div class="row">
                    {#each costFields as cf}
                      <Field label={`cost.${cf}`}>
                        <input type="number" value={cfg.cost?.[cf] ?? ""}
                          onchange={(e) => patchModel(provId, modelId, ["cost", cf], (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
                      </Field>
                    {/each}
                  </div>
                  <div class="row">
                    {#each limitFields as lf}
                      <Field label={`limit.${lf}`}>
                        <input type="number" value={cfg.limit?.[lf] ?? ""}
                          onchange={(e) => patchModel(provId, modelId, ["limit", lf], (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
                      </Field>
                    {/each}
                  </div>
                  <Field label="options">
                    <KVEditor value={typeof cfg.options === "object" && cfg.options !== null ? cfg.options : {}}
                      onchange={(v) => patchModel(provId, modelId, ["options"], Object.keys(v).length > 0 ? v : undefined)} />
                  </Field>
                  <Field label="headers">
                    <KVEditor value={typeof cfg.headers === "object" && cfg.headers !== null ? cfg.headers : {}}
                      onchange={(v) => patchModel(provId, modelId, ["headers"], Object.keys(v).length > 0 ? v : undefined)} />
                  </Field>
                  <Field label="variants">
                    {#each Object.entries(getVariants(cfg)) as [vname, vcfg] (vname)}
                      <div class="variant-row">
                        <span class="variant-name">{vname}</span>
                        <label class="check">
                          <input type="checkbox" checked={vcfg?.disabled === true}
                            onchange={(e) => patchModel(provId, modelId, ["variants", vname, "disabled"], (e.currentTarget as HTMLInputElement).checked || undefined)} />
                          disabled
                        </label>
                        <button class="danger" onclick={() => patchModel(provId, modelId, ["variants", vname], undefined)}>×</button>
                      </div>
                    {/each}
                    <div class="variant-row">
                      <input type="text" placeholder="variant name" value={newVariant[`${provId}/${modelId}`] ?? ""}
                        oninput={(e) => { newVariant[`${provId}/${modelId}`] = (e.currentTarget as HTMLInputElement).value; }} />
                      <button onclick={() => addVariant(provId, modelId)}>+ add variant</button>
                    </div>
                  </Field>
                </div>
              </details>
            {/each}
            <div class="add-row">
              <Combobox value={newModelId[provId] ?? ""} options={modelOptions(provId)}
                onchange={(v) => { newModelId[provId] = v; }} oninput={(v) => { newModelId[provId] = v; }} />
              <button onclick={() => addModel(provId, newModelId[provId] ?? "")}>+ add model</button>
            </div>
          </Field>
        </div>
      {/if}
    </div>
  {/each}
</div>

<div class="add-row top">
  <Combobox value={newProvId} options={providerOptions()}
    onchange={(v) => { newProvId = v; }} oninput={(v) => { newProvId = v; }} label="new provider id" />
  <button class="add-btn" onclick={addProvider}>+ add provider</button>
</div>

<div class="lists">
  <Field label="enabled_providers" help="When set, ONLY these providers will be enabled. All other providers will be ignored">
    <StringList value={(store.json as any)?.enabled_providers ?? []} onchange={(v) => setList("enabled_providers", v)} />
  </Field>
  <Field label="disabled_providers" help="Disable providers that are loaded automatically">
    <StringList value={(store.json as any)?.disabled_providers ?? []} onchange={(v) => setList("disabled_providers", v)} />
  </Field>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .hint { font-size: 11px; color: var(--warn); margin: -6px 0 12px; }
  .provider-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .remove { margin-left: auto; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .opts { padding-left: 8px; border-left: 1px solid var(--bg-3); }
  .opts details { margin-top: 8px; }
  .opts summary { font-size: 11px; color: var(--fg-2); }
  .model { margin-bottom: 6px; }
  .model summary { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--accent); padding: 4px 0; }
  .model-id { font-family: var(--font); }
  .model-body { padding-left: 12px; border-left: 1px solid var(--bg-3); margin-top: 4px; }
  .meta { font-size: 11px; color: var(--fg-2); margin: -6px 0 8px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row :global(.field) { flex: 1; min-width: 110px; }
  .variant-row { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
  .variant-row input[type="text"] { flex: 1; }
  .variant-name { font-family: var(--font); font-size: 12px; flex: 1; }
  .check { display: flex; gap: 4px; align-items: center; font-size: 11px; color: var(--fg-1); }
  .check input { width: auto; }
  .add-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 16px; }
  .add-row :global(.combobox) { flex: 1; max-width: 320px; }
  .top { margin-top: 4px; }
  .lists { margin-top: 16px; }
  .error { color: var(--danger); font-size: 11px; }
  summary { cursor: pointer; }
  button { font-size: 11px; padding: 2px 6px; }

  @media (max-width: 640px) {
    .card-body { padding: 10px; }
    .model-body { padding-left: 8px; }
    .row :global(.field) { min-width: 100%; }
    .variant-row { flex-wrap: wrap; }
    .add-row { flex-wrap: wrap; }
    .add-row :global(.combobox) { max-width: 100%; }
  }
</style>
