<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery } from '@mmailaender/convex-svelte';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  import Tabbar from '$lib/Tabbar.svelte';

  const auth = useAuth();
  const insights = useQuery(api.providerInsights.myProviderInsights, () => ({}));
  const data = $derived(insights.data);
</script>
<div class="phone">
  <div class="topbar"><a href="/home" style="text-decoration:none;font-weight:700">← Discover</a><strong>Provider insights</strong><span></span></div>
  {#if !auth.isAuthenticated}
    <div class="card empty">
      <p style="font-weight:800;margin:8px 0 4px">Providers sign in.</p>
      <p class="meta">Use your official organization email to see aggregated readiness barriers for your programs. Individuals can never be identified here.</p>
      <a href="/auth" class="btn btn-primary" style="text-decoration:none;margin-top:12px">Sign in</a>
    </div>
  {:else if insights.isLoading}
    <div class="card"><p class="meta">Loading aggregates…</p></div>
  {:else if insights.error || !data}
    <div class="card"><p class="meta">No provider program is linked to this email. Cohorts below five entrepreneurs stay suppressed for privacy.</p></div>
  {:else}
    <div class="card"><strong>{data.providerName}</strong><p class="meta" style="margin:4px 0 0">Aggregated barriers only — no individual records, ever.</p></div>
    {#each data.opportunities as o}
      <div class="card">
        <strong>{o.title}</strong>
        {#if o.suppressed}
          <p class="meta" style="margin-top:4px">Suppressed — fewer than five entrepreneurs tracked. Small cohorts stay hidden so nobody can be inferred.</p>
        {:else}
          <p class="meta" style="margin:6px 0 2px">Pipeline</p>
          {#each o.funnel as f}<p class="meta" style="margin:2px 0">{f.state}: <strong style="color:var(--fg)">{f.count}</strong></p>{/each}
          {#if o.topGaps.length > 0}
            <p class="meta" style="margin:6px 0 2px">Top blocking criteria</p>
            {#each o.topGaps as g}<p class="meta" style="margin:2px 0">{g.label}: <strong style="color:var(--fg)">{g.count}</strong></p>{/each}
          {/if}
          {#if o.abandonReasons.length > 0}
            <p class="meta" style="margin:6px 0 2px">Why applicants leave</p>
            {#each o.abandonReasons as r}<p class="meta" style="margin:2px 0">{r.reason}: <strong style="color:var(--fg)">{r.count}</strong></p>{/each}
          {/if}
          {#if o.outcomes.length > 0}
            <p class="meta" style="margin:6px 0 2px">Outcomes (user-reported vs provider-confirmed)</p>
            {#each o.outcomes as r}<p class="meta" style="margin:2px 0">{r.outcome} · {r.reportedBy}{#if r.reasonCode} · {r.reasonCode}{/if}: <strong style="color:var(--fg)">{r.count}</strong></p>{/each}
          {/if}
        {/if}
      </div>
    {/each}
  {/if}
  <Tabbar active="profile" />
</div>
