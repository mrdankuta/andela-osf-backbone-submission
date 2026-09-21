<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  import { deadlineLabel } from '$lib/deadline';

  const hasProfile = $derived(browser ? !!localStorage.getItem('ba-profile') : false);

  const results = useQuery(api.opportunities.list, () => ({ type: 'all' as const }));
  const data = $derived(results.data ?? []);
  const isLoading = $derived(results.isLoading);
  const error = $derived(results.error);
</script>

<div class="phone">
  <div class="topbar">
    <div style="display:flex;gap:10px;align-items:center">
      <span style="width:30px;height:30px;border-radius:10px;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:900;font-size:13px">B</span>
      <strong>Backbone Africa</strong>
    </div>
    <a href="/auth" style="font-size:13px;font-weight:700;text-decoration:none">Sign in</a>
  </div>

  <div class="card card-hero">
    <p class="hero-kicker">The backbone deserves backing</p>
    <h1 style="font-size:26px;line-height:1.15;margin:8px 0 8px;letter-spacing:-.02em">All the funding you qualify for,<br/>in one place.</h1>
    <p style="opacity:.92;margin:0;font-size:14.5px;max-width:30ch">Source-linked grants, loans & programmes for Nigerian MSMEs. No spam, no pay-to-apply.</p>
    {#if hasProfile}
      <a class="btn" style="background:#fff;color:var(--accent);margin-top:16px;text-decoration:none" href="/home">Continue to Discover →</a>
    {:else}
      <a class="btn" style="background:#fff;color:var(--accent);margin-top:16px;text-decoration:none" href="/onboarding">Find my opportunities — free</a>
      <div class="meta" style="color:rgba(255,255,255,.82);margin-top:8px">Free · 2 min · No account needed</div>
    {/if}
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0;font-size:15px">Trending now</h3>
      <a href="/home?view=all" style="font-size:13px;font-weight:700">See all →</a>
    </div>
    {#if isLoading}<p class="meta" style="margin-top:10px">Loading…</p>
    {:else if error}<p class="meta" style="margin-top:10px">Couldn't load — <a href="/">Retry</a></p>
    {:else if data.length === 0}<p class="meta" style="margin-top:10px">Nothing verified to show right now — check back soon.</p>
    {:else}
      <div style="display:grid;gap:0;margin-top:6px">
      {#each data.slice(0, 3) as o}
        {@const urgent = o.deadline !== undefined && (o.deadline - Date.now()) < 7*86400000}
        <a href={`/opportunity/${o._id}`} style="text-decoration:none;color:inherit;border-top:1px solid var(--border);padding:12px 0;display:block">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px"><span class="pill pill-type">{o.type}</span><span class="pill pill-verified">Official source</span></div>
          <div style="font-weight:750;line-height:1.35">{o.title}</div>
          <div class="meta">{o.amountOrBenefit} · <span class:urgent={urgent} class:due={true} style={urgent ? 'color:var(--danger);font-weight:750' : ''}>{deadlineLabel(o.deadline)}</span> · {o.locationEligibility}</div>
        </a>
      {/each}
      </div>
    {/if}
    {#if hasProfile}
      <a class="btn btn-primary" style="margin-top:12px;text-decoration:none" href="/home">Continue to Discover →</a>
    {:else}
      <a class="btn btn-primary" style="margin-top:12px;text-decoration:none" href="/onboarding">Find my opportunities — free</a>
    {/if}
    <p class="meta" style="text-align:center;margin:8px 0 0">Browsing is free — <a href="/auth">create an account</a> to back up.</p>
  </div>

  <Tabbar active="discover" />
</div>
