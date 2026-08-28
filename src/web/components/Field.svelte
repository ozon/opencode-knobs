<script lang="ts">
  let { label, help, error }: { label?: string; help?: string; error?: string } = $props();
</script>

<div class="field">
  {#if label}
    <label>{label}</label>
  {/if}
  <slot />
  {#if error}
    <p class="error">{error}</p>
  {:else if help}
    <p class="help">{help}</p>
  {/if}
</div>

<style>
  .field { margin-bottom: 12px; }
  .help { font-size: 11px; color: var(--fg-2); margin-top: 2px; }
  .error { font-size: 11px; color: var(--danger); margin-top: 2px; }
</style>
