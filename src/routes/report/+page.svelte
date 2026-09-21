<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  const client = useConvexClient();
  const list = useQuery(api.opportunities.list, () => ({}));
  const opps = $derived(list.data ?? []);
  let sel = $state<string | null>(page.url.searchParams.get('id'));
  const CATEGORIES = [
    ['broken-source', 'Link broken'],
    ['wrong-deadline', 'Deadline wrong'],
    ['ended-program', 'Program ended'],
    ['suspected-scam', 'Looks like scam'],
    ['incorrect-eligibility', 'Eligibility wrong'],
    ['other', 'Something else'],
  ] as const;
  let category = $state<(typeof CATEGORIES)[number][0]>('broken-source');
  let claimKey = $state('');
  let note = $state('');
  let done = $state(false);
  let err = $state('');
  let receipt = $state<{ flagId: string; priority: string; recheckWithinHours: number; duplicate: boolean } | null>(null);
  let claimOptions = $state<{ claimKey: string; displayValue: string }[]>([]);
  $effect(() => {
    if (sel && browser) {
      client.query(api.opportunities.getEvidence, { id: sel as never })
        .then((r) => { claimOptions = (r?.claims ?? []).map((c) => ({ claimKey: c.claimKey, displayValue: c.displayValue })); })
        .catch(() => { claimOptions = []; });
    } else { claimOptions = []; }
  });
  async function submit() {
    if (!sel) return;
    err = '';
    try {
      receipt = await client.mutation(api.curation.report, {
        opportunityId: sel as never,
        category,
        claimKey: claimKey || undefined,
        note: note || undefined,
      });
      done = true;
    } catch { err = 'Submit failed — check connection and retry.'; }
  }
</script>
<div class="phone">
  <div class="topbar"><a href="/home">←</a><strong>Report an issue</strong><span></span></div>
  {#if !done}
    <div class="card">
      <p class="meta">Opportunity</p>
      <select class="input" bind:value={sel}>
        <option value={null}>Choose…</option>
        {#each opps.slice(0,20) as o}<option value={o._id}>{o.title}</option>{/each}
      </select>
      <p class="meta" style="margin-top:10px">What did you see?</p>
      {#each CATEGORIES as [value, label]}
        <button class="chip" aria-pressed={category===value} onclick={() => (category = value)}>{label}</button>
      {/each}
      {#if claimOptions.length > 0}
        <p class="meta" style="margin-top:10px">Which fact is wrong? (optional)</p>
        <select class="input" bind:value={claimKey} aria-label="Affected fact">
          <option value="">Not sure / general</option>
          {#each claimOptions as c}<option value={c.claimKey}>{c.displayValue}</option>{/each}
        </select>
      {/if}
      <textarea class="input" style="margin-top:10px;min-height:96px" placeholder="e.g. The Apply button goes to a blank page…" bind:value={note} aria-label="Details"></textarea>
      <button class="btn btn-primary" style="margin-top:10px" onclick={submit} disabled={!sel}>Submit report</button>
      {#if err}<p class="meta" style="color:var(--danger)">{err} <button class="chip" onclick={submit}>Retry</button></p>{/if}
    </div>
  {:else}
    <div class="card" style="text-align:center;padding:28px 18px"><div style="font-size:36px">✓</div><h2>Thank you.</h2><p class="meta">{#if receipt?.duplicate}Someone already reported this — yours is counted too.{/if} Our curators will re-check within {receipt?.recheckWithinHours ?? 48} hours. The badge updates automatically. No account, no personal data taken.</p><a class="btn btn-primary" style="text-decoration:none" href="/home">Back home</a></div>
  {/if}
</div>
