<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import { entries, resolveRef } from "../schema/walker";
  import Field from "./Field.svelte";
  import StringList from "./StringList.svelte";
  import KVEditor from "./KVEditor.svelte";
  import MaskedSecret from "./MaskedSecret.svelte";
  import Combobox from "./Combobox.svelte";

  let {
    store, schema, path = [], onlyKeys, secretPaths = [], compact = false,
  }: {
    store: DocStore; schema: any; path?: (string|number)[]; onlyKeys?: string[];
    secretPaths?: string[]; compact?: boolean;
  } = $props();

  const defs = store.defs;

  function getValue(obj: any, p: (string|number)[]): any {
    let cur = obj;
    for (const seg of p) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  function getSchema(name: string): any {
    let s = schema;
    if (s?.$ref) s = resolveRef(s, defs);
    return s?.properties?.[name] ?? s?.$defs?.[name];
  }

  function resolve(s: any): any {
    return s?.$ref ? resolveRef(s, defs) : s;
  }

  function isSecret(p: (string|number)[]): boolean {
    return secretPaths.some((sp) => sp === p.join("/"));
  }

  function inferEnumOptions(s: any): string[] | undefined {
    if (s?.enum) return s.enum;
    if (s?.anyOf) {
      const opts = s.anyOf.map((a: any) => a.enum ?? [a.const]).flat().filter(Boolean);
      if (opts.length > 0) return opts;
    }
    return undefined;
  }

  function inferAnyOfOptions(s: any): any[] | undefined {
    return s?.anyOf;
  }

  function getHelpText(s: any): string {
    return s?.description ?? s?.markdownDescription ?? "";
  }

  function defaultHint(s: any): string {
    if (s?.default === undefined) return "";
    const d = s.default;
    const pretty = typeof d === "object" ? JSON.stringify(d) : String(d);
    return `default: ${pretty}`;
  }

  function patchField(fieldPath: (string|number)[], value: unknown) {
    store.patch(fieldPath, value);
  }


</script>

{#each (onlyKeys ?? [...entries(schema, defs, store.defName)]) as entry}
  {@const [name, propSchema] = typeof entry === "string" ? [entry, getSchema(entry)] : entry}
  {@const resolved = resolve(propSchema)}
  {@const fieldPath = [...path, name]}
  {@const value = getValue(store.json, fieldPath)}
  {@const options = inferEnumOptions(resolved)}
  {@const anyOf = inferAnyOfOptions(resolved)}
  {@const help = getHelpText(resolved)}
  {@const def = resolved?.default}
  {@const displayHelp = [help, defaultHint(resolved)].filter(Boolean).join("  ·  ")}
  {@const error = store.allErrors.find((e) => e.path === "/" + fieldPath.join("/"))?.message}
  {@const unsetLabel = def !== undefined ? `(unset — default: ${typeof def === "object" ? JSON.stringify(def) : def})` : "(unset)"}

  {#if resolved?.type === "boolean" || anyOf?.some((a: any) => a.type === "boolean")}
    {@const opts = anyOf ? anyOf.filter((a: any) => a.type !== "boolean").map((a: any) => a.enum ?? [a.const]).flat().filter(Boolean) : []}
    {#if opts.length > 0}
      <Field label={name} help={displayHelp} {error}>
        <select value={value ?? ""} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; patchField(fieldPath, v === "true" ? true : v === "false" ? false : v); }}>
          {#each ["", "true", "false", ...opts] as opt}
            <option value={opt}>{opt === "" ? unsetLabel : opt}</option>
          {/each}
        </select>
      </Field>
    {:else}
      <Field label={name} help={displayHelp} {error}>
        <label class="toggle">
          <input type="checkbox" checked={!!value} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLInputElement).checked)} />
          <span>{value ? "on" : "off"}{def !== undefined ? ` (default ${def ? "on" : "off"})` : ""}</span>
        </label>
      </Field>
    {/if}

  {:else if options}
    <Field label={name} help={displayHelp} {error}>
      <select value={value ?? ""} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLSelectElement).value || undefined)}>
        <option value="">{unsetLabel}</option>
        {#each options as opt}
          <option value={opt} selected={value === opt}>{opt}</option>
        {/each}
      </select>
    </Field>

  {:else if resolved?.type === "integer" || resolved?.type === "number"}
    <Field label={name} help={displayHelp} {error}>
      <input type="number" value={value ?? ""} min={resolved.minimum} max={resolved.maximum} placeholder={def != null ? String(def) : ""}
        onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; patchField(fieldPath, v === "" ? undefined : Number(v)); }} />
    </Field>

  {:else if resolved?.type === "string"}
    {#if isSecret(fieldPath)}
      <Field label={name} help={displayHelp} {error}>
        <MaskedSecret {value} onchange={(v) => patchField(fieldPath, v)} />
      </Field>
    {:else}
      <Field label={name} help={displayHelp} {error}>
        <input type="text" value={value ?? ""} placeholder={def != null ? String(def) : ""} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLInputElement).value || undefined)} />
      </Field>
    {/if}

  {:else if resolved?.type === "array" && resolved?.items?.type === "string"}
    <Field label={name} help={displayHelp} {error}>
      <StringList {value} onchange={(v) => patchField(fieldPath, v)} />
    </Field>

  {:else if resolved?.type === "object" && resolved?.properties}
    <details open={!compact}>
      <summary>{name}{def !== undefined ? `  (default set)` : ""}</summary>
      <div class="nested">
        <svelte:self {store} schema={resolved} path={fieldPath} {secretPaths} compact />
      </div>
    </details>

  {:else if resolved?.type === "object" && resolved?.additionalProperties}
    <Field label={name} help={displayHelp} {error}>
      <KVEditor {value} onchange={(v) => patchField(fieldPath, v)} />
    </Field>

  {:else}
    <Field label={name} help={displayHelp} {error}>
      <input type="text" value={value === undefined ? "" : JSON.stringify(value)} placeholder={def != null ? JSON.stringify(def) : ""}
        onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; try { patchField(fieldPath, JSON.parse(v)); } catch { patchField(fieldPath, v || undefined); } }} />
    </Field>
  {/if}
{/each}

<style>
  details { margin-bottom: 12px; }
  summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--accent); padding: 4px 0; }
  summary:hover { color: var(--accent-hover); }
  .nested { padding-left: 16px; border-left: 1px solid var(--bg-3); margin-top: 4px; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
  .toggle input { width: auto; }
</style>
