<script lang="ts">
  import { onMount } from "svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { jsonc } from "@shopify/lang-jsonc";
  import { linter, lintGutter } from "@codemirror/lint";
  import { bracketMatching } from "@codemirror/language";
  import type { DocStore } from "../state/doc-store.svelte";
  import { pointerToOffset } from "../state/patch";

  let { store, onForceSave }: { store: DocStore; onForceSave: () => void } = $props();
  let editorEl: HTMLDivElement;
  let view: EditorView | undefined;

  function errRange(err: { source: string; offset?: number; length?: number; path: string }, raw: string) {
    if (err.source === "parse" && typeof err.offset === "number") {
      const from = Math.min(err.offset, raw.length);
      return { from, to: Math.min(from + (err.length ?? 1), raw.length) };
    }
    const from = Math.min(pointerToOffset(raw, err.path), raw.length);
    const seg = err.path.split("/").pop() ?? "";
    return { from, to: Math.min(from + Math.max(seg.length, 1), raw.length) };
  }

  const lintSource = linter(() => {
    const raw = store.raw;
    return store.allErrors.map((err) => {
      const { from, to } = errRange(err, raw);
      return { from, to, severity: "error" as const, message: err.message };
    });
  });

  const darkTheme = EditorView.theme({
    "&": { backgroundColor: "#1e1e2e", color: "#cdd6f4" },
    ".cm-content": { caretColor: "#89b4fa" },
    ".cm-gutters": { backgroundColor: "#181825", color: "#7f849c", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "#313244" },
    ".cm-activeLine": { backgroundColor: "#1e1e2e22" },
    ".cm-selectionBackground": { backgroundColor: "#45475a55" },
    ".cm-cursor": { borderLeftColor: "#89b4fa" },
    ".cm-matchingBracket": { backgroundColor: "#45475a", outline: "none" },
  }, { dark: true });

  onMount(() => {
    view = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: store.raw,
        extensions: [
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          bracketMatching(),
          jsonc(),
          lintGutter(),
          lintSource,
          darkTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              if (text !== store.raw) store.setText(text);
            }
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });

  $effect(() => {
    const raw = store.raw;
    if (view && raw !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: raw },
      });
    }
  });
</script>

<div class="raw-section">
  <div class="raw-header">
    <span class="doc-name">{store.id === "config" ? "opencode.json" : "tui.json"}</span>
    {#if store.parseErrors.length > 0}
      <span class="error-badge">{store.parseErrors.length} parse error(s)</span>
    {:else if store.schemaErrors.length > 0}
      <span class="warn-badge">{store.schemaErrors.length} schema error(s)</span>
    {:else}
      <span class="ok-badge">valid</span>
    {/if}
  </div>

  <div class="editor" bind:this={editorEl}></div>

  {#if !store.valid}
    <div class="error-panel">
      <p>Errors:</p>
      <ul>
        {#each store.allErrors as err}
          <li class={err.source}>
            <span class="source">[{err.source}]</span> {err.path || "/"}: {err.message}
          </li>
        {/each}
      </ul>
      {#if store.schemaErrors.length > 0 && store.parseErrors.length === 0}
        <button class="force-btn" onclick={onForceSave}>Save anyway</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .raw-section { display: flex; flex-direction: column; height: calc(100vh - 90px); }
  .raw-header { display: flex; align-items: center; gap: 12px; padding: 0 0 8px; font-size: 12px; }
  .doc-name { font-family: var(--font); color: var(--fg-1); }
  .error-badge { color: var(--danger); }
  .warn-badge { color: var(--warn); }
  .ok-badge { color: var(--success); }
  .editor { flex: 1; overflow: hidden; border: 1px solid var(--bg-3); border-radius: var(--radius); }
  .editor :global(.cm-editor) { height: 100%; }
  .error-panel {
    margin-top: 8px; padding: 10px; background: var(--bg-1); border: 1px solid var(--bg-3);
    border-radius: var(--radius); max-height: 200px; overflow-y: auto;
  }
  .error-panel p { font-size: 11px; color: var(--fg-1); margin-bottom: 6px; }
  .error-panel ul { list-style: none; padding: 0; margin: 0; }
  .error-panel li { font-size: 11px; padding: 2px 0; font-family: var(--font); }
  .error-panel li.parse { color: var(--danger); }
  .error-panel li.schema { color: var(--warn); }
  .source { color: var(--fg-2); font-size: 10px; margin-right: 4px; }
  .force-btn {
    margin-top: 8px; padding: 6px 16px; background: var(--danger); color: var(--bg-0);
    border: none; border-radius: var(--radius); cursor: pointer; font: inherit;
  }
  .force-btn:hover { opacity: 0.8; }
</style>
