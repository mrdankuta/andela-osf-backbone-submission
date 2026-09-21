<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useConvexClient } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  import { enqueueOp, replayQueue } from '$lib/offline-queue';

  const client = useConvexClient();
  function device() {
    if (!browser) return 'server';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  let pasted = $state('');
  let checking = $state(false);
  let result = $state<any>(null);
  let submitMsg = $state('');
  let submitState = $state<'idle' | 'sending' | 'queued' | 'sent'>('idle');
  const offline = $derived(browser && !navigator.onLine);

  async function check() {
    if (!pasted.trim() || checking) return;
    checking = true;
    submitMsg = '';
    submitState = 'idle';
    try {
      result = await client.query(api.linkIntake.resolveLink, { url: pasted.trim() });
    } catch {
      result = { outcome: 'invalid', normalizedUrl: null };
    }
    checking = false;
  }
  async function suggest() {
    if (!result || submitState === 'sending') return;
    submitState = 'sending';
    try {
      const r = await client.mutation(api.linkIntake.suggestLink, { url: pasted.trim(), deviceId: device() });
      submitState = 'sent';
      submitMsg =
        r.outcome === 'known'
          ? 'Good news — we already know this link. See above.'
          : r.duplicate
            ? 'Already suggested — curators are on it. Thank you.'
            : 'Suggested ✓ Curators will review it. Thank you — no account needed.';
    } catch {
      if (browser) {
        enqueueOp(localStorage, { kind: 'linkSuggestion', url: pasted.trim(), at: Date.now() });
        submitState = 'queued';
        submitMsg = 'Offline — saved on this device and will send when you are back online.';
      } else {
        submitState = 'idle';
        submitMsg = 'Submit failed — check connection and retry.';
      }
    }
  }
  $effect(() => {
    if (browser && navigator.onLine) {
      void replayQueue(localStorage, async (op) => {
        if (op.kind === 'linkSuggestion') {
          await client.mutation(api.linkIntake.suggestLink, { url: op.url, deviceId: device() });
        } else if (op.kind === 'tick') {
          await client.mutation(api.track.tick, { opportunityId: op.oppId as any, deviceId: device(), step: op.step });
        } else {
          await client.mutation(api.track.setPlanState, { opportunityId: op.oppId as any, deviceId: device(), state: op.state as any, abandonReason: op.abandonReason });
        }
      });
    }
  });
</script>
<div class="phone">
  <div class="topbar"><a href="/home" style="text-decoration:none;font-weight:700">← Discover</a><strong>Check a link</strong><span></span></div>
  {#if offline}<div class="banner warn">Offline · You can still paste a link — it will send later.</div>{/if}
  <div class="card">
    <strong>Pasted a funding link from WhatsApp?</strong>
    <p class="meta" style="margin:4px 0 8px">We check whether Backbone already knows it — before you trust it.</p>
    <div style="display:flex;gap:8px">
      <input class="input" style="flex:1" placeholder="Paste the link…" bind:value={pasted} aria-label="Shared opportunity link" inputmode="url" />
      <button class="btn btn-primary" disabled={checking} onclick={check}>{checking ? 'Checking…' : 'Check'}</button>
    </div>
  </div>
  {#if result}
    {#if result.outcome === 'invalid'}
      <div class="card"><p>That doesn't look like a link. Paste the full URL from the forward.</p></div>
    {:else if result.outcome === 'known'}
      <div class="card">
        <div class="pill pill-ok">✓ Known · verified</div>
        <h2 style="font-size:19px;margin:10px 0 6px">{result.title}</h2>
        <p class="meta">by <strong>{result.providerName}</strong> · {result.amountOrBenefit}</p>
        <p class="meta" style="margin-top:6px">Verified {new Date(result.lastVerified).toLocaleDateString()}{#if result.freshness && result.freshness.state !== 'ok'} · {#if result.freshness.state === 'under-review'}being re-checked{:else if result.freshness.state === 'unavailable'}source offline right now{:else}changed since verification{/if}{/if}</p>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <a class="btn btn-primary" style="text-decoration:none" href={`/opportunity/${result.opportunityId}`}>Check my eligibility →</a>
          <a class="btn btn-outline" style="text-decoration:none" href="/onboarding">Confirm my profile</a>
        </div>
      </div>
    {:else if result.outcome === 'in-review'}
      <div class="card">
        <div class="pill pill-warn">◷ Seen · not verified</div>
        <p style="margin:10px 0 4px">{result.detail}</p>
        <p class="meta">Do not act on forwards about this link yet. Check back after curators finish.</p>
      </div>
    {:else}
      <div class="card">
        <div class="pill">? Unknown link</div>
        <p style="margin:10px 0 4px"><strong>We don't know this one — and we won't vouch for it.</strong></p>
        <p class="meta">No verified label, no invented details. Suggest it and curators will review the official page.</p>
        {#if submitState === 'sent' || submitState === 'queued'}
          <div class="banner ok" style="margin-top:8px">{submitMsg}</div>
        {:else}
          <button class="btn btn-primary" style="margin-top:10px" disabled={submitState === 'sending'} onclick={suggest}>{submitState === 'sending' ? 'Sending…' : 'Suggest for review'}</button>
          {#if submitMsg}<p class="meta" style="margin-top:8px">{submitMsg}</p>{/if}
        {/if}
      </div>
    {/if}
  {/if}
  <Tabbar active="discover" />
</div>
