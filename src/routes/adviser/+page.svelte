<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  import Tabbar from '$lib/Tabbar.svelte';

  const client = useConvexClient();
  const auth = useAuth();
  const advising = useQuery(api.adviser.myAdvising, () => ({}));
  const list = $derived(advising.data ?? []);
  let code = $state('');
  let msg = $state('');
  let redeeming = $state(false);
  let openFor = $state<string | null>(null);
  let plansCache = $state<Record<string, any[]>>({});

  async function redeem() {
    if (!code.trim() || redeeming) return;
    redeeming = true;
    msg = '';
    try {
      await client.mutation(api.adviser.redeemInvite, { code: code.trim() });
      code = '';
      msg = 'Access granted ✓ you can now see their plans.';
    } catch (e) { msg = e instanceof Error ? e.message : 'Redeem failed.'; }
    redeeming = false;
  }
  async function openPlans(entrepreneurKey: string) {
    if (openFor === entrepreneurKey) {
      openFor = null;
      return;
    }
    openFor = entrepreneurKey;
    try {
      plansCache = { ...plansCache, [entrepreneurKey]: await client.query(api.adviser.adviserPlans, { entrepreneurKey }) };
    } catch (e) { msg = e instanceof Error ? e.message : 'Could not load plans.'; }
  }
  async function tick(entrepreneurKey: string, opportunityId: string, step: number) {
    try {
      await client.mutation(api.adviser.adviserTick, { entrepreneurKey, opportunityId: opportunityId as never, step });
      plansCache = { ...plansCache, [entrepreneurKey]: await client.query(api.adviser.adviserPlans, { entrepreneurKey }) };
    } catch (e) { msg = e instanceof Error ? e.message : 'Tick failed.'; }
  }
  async function setState(entrepreneurKey: string, opportunityId: string, state: 'ready' | 'applying' | 'applied') {
    try {
      await client.mutation(api.adviser.adviserSetPlanState, { entrepreneurKey, opportunityId: opportunityId as never, state });
      plansCache = { ...plansCache, [entrepreneurKey]: await client.query(api.adviser.adviserPlans, { entrepreneurKey }) };
    } catch (e) { msg = e instanceof Error ? e.message : 'State change failed.'; }
  }
</script>
<div class="phone">
  <div class="topbar"><a href="/home" style="text-decoration:none;font-weight:700">← Discover</a><strong>Advise</strong><span></span></div>
  {#if !auth.isAuthenticated}
    <div class="card empty">
      <p style="font-weight:800;margin:8px 0 4px">Advisers sign in.</p>
      <p class="meta">Redeem an invite code from an entrepreneur to help with their plans. You never own their data.</p>
      <a href="/auth" class="btn btn-primary" style="text-decoration:none;margin-top:12px">Sign in</a>
    </div>
  {:else}
    <div class="card"><strong>Redeem an invite code</strong>
      <p class="meta" style="margin:4px 0 8px">Ask the entrepreneur for their 6-letter code.</p>
      <div style="display:flex;gap:8px">
        <input class="input" style="flex:1;text-transform:uppercase" placeholder="ABC123" bind:value={code} aria-label="Invite code" maxlength={6} />
        <button class="btn btn-primary" disabled={redeeming} onclick={redeem}>{redeeming ? 'Checking…' : 'Redeem'}</button>
      </div>
      {#if msg}<p class="meta" style="margin-top:8px">{msg}</p>{/if}
    </div>
    {#if advising.isLoading}
      <div class="card"><p class="meta">Loading…</p></div>
    {:else if list.length === 0}
      <div class="card"><p class="meta">No advising relationships yet. Redeem a code above to begin.</p></div>
    {/if}
    {#each list as g}
      <div class="card">
        <strong>{g.label}</strong> <span class="meta">[{g.status} · {g.scopes.join(', ')}]</span>
        {#if g.status === 'revoked'}<p class="meta" style="margin-top:4px">Access revoked — history kept for the entrepreneur.</p>{/if}
        {#if g.status === 'active'}
          <div style="margin-top:8px"><button class="chip" onclick={() => openPlans(g.entrepreneurKey)}>{openFor === g.entrepreneurKey ? 'Hide plans' : 'View plans →'}</button></div>
        {/if}
        {#if openFor === g.entrepreneurKey}
          {#each (plansCache[g.entrepreneurKey] ?? []) as p}
            {@const nextOrder = (p.steps ?? []).map((s: any) => s.order).find((o: number) => !(p.ticked ?? []).includes(o))}
            <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
              <p style="margin:0;font-weight:700">{p.title}</p>
              <p class="meta" style="margin:4px 0">{p.displayState}{#if p.readinessOverall} · {p.readinessOverall}{/if}{#if p.nextDependency} · Next: {p.nextDependency.label}{/if} · {Math.round(p.progress)}%</p>
              {#if g.scopes.includes('plan:update')}
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  {#if nextOrder !== undefined}<button class="chip" onclick={() => tick(g.entrepreneurKey, p.opportunityId, nextOrder)}>Tick step {nextOrder} ✓</button>{/if}
                  {#if p.displayState === 'qualifying'}<button class="chip" onclick={() => setState(g.entrepreneurKey, p.opportunityId, 'ready')}>Mark ready</button>{/if}
                  {#if p.displayState === 'ready' || p.displayState === 'qualifying'}<button class="chip" onclick={() => setState(g.entrepreneurKey, p.opportunityId, 'applying')}>Start applying</button>{/if}
                </div>
              {/if}
            </div>
          {:else}
            <p class="meta" style="margin-top:8px">No plans shared yet.</p>
          {/each}
        {/if}
      </div>
    {/each}
  {/if}
  <Tabbar active="profile" />
</div>
