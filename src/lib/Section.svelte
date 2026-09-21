<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    id,
    eyebrow,
    title,
    summary = '',
    open = $bindable(false),
    children,
  }: {
    id?: string;
    eyebrow?: string;
    title: string;
    summary?: string;
    open?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="card section" {id}>
  <button
    class="section-head"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls={id ? `${id}-body` : undefined}
  >
    <span class="section-head-text">
      {#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
      <strong class="section-title-text">{title}</strong>
      {#if summary}<span class="meta">{summary}</span>{/if}
    </span>
    <span class="chev" class:open aria-hidden="true">⌄</span>
  </button>
  <div class="section-body" class:open id={id ? `${id}-body` : undefined}>
    <div class="section-body-inner">
      <div class="section-body-pad">
        {@render children()}
      </div>
    </div>
  </div>
</section>
