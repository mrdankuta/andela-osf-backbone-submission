<script lang="ts">
  import { page } from '$app/state';
  import { api } from '$convex/_generated/api';
  import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import Tabbar from '$lib/Tabbar.svelte';
  import { daysLeft, deadlineLabel } from '$lib/deadline';

  function profile() {
    if (!browser) return {};
    try { return JSON.parse(localStorage.getItem('ba-profile') ?? '{}'); }
    catch { return {}; }
  }
  const p = profile();
  const firstName = p.firstName ?? '';
  const hasProfile = Object.keys(p).length > 0;
  const matchArgs = {
    state: p.state,
    sector: (p.sectors?.[0] ?? p.sector)?.toLowerCase(),
    cacStatus: p.cac,
    womenLed: p.womenLed,
    ageRange: p.age,
    needTypes: p.needs?.map((x: string) => x.toLowerCase()),
  };
  const profileSummary = [p.state, p.sectors?.[0] ?? p.sector].filter(Boolean).join(' · ') || 'Profile details not set';
  const client = useConvexClient();

  // One Discover screen, two modes — not two tabs.
  // ?view=matched (ranked by your profile) | ?view=all (search + filter everything)
  let view = $state<'matched' | 'all'>(browser && page.url.searchParams.get('view') === 'all' ? 'all' : 'matched');
  function setView(v: 'matched' | 'all') {
    view = v;
    if (browser) {
      const u = new URL(window.location.href);
      u.searchParams.set('view', v);
      window.history.replaceState({}, '', u);
    }
  }

  const feed = useQuery(api.opportunities.match, () => matchArgs);
  const matched = $derived(feed.data ?? []);
  const eligible = $derived(matched.filter((d) => d.matchTier === 'eligible').length);
  const almost = $derived(matched.filter((d) => d.matchTier === 'almost').length);
  const urgent = $derived(matched.filter((d) => d.deadline !== undefined && (d.deadline - Date.now()) < 7*86400000).length);

  // Browse-all mode filters
  let search = $state('');
  const typeOptions = ['all','grant','loan','accelerator','gov-program','fellowship','incubator'] as const;
  let type = $state<(typeof typeOptions)[number]>('all');
  let womenOnly = $state(false);
  let youthOnly = $state(false);
  let region = $state('All Nigeria');
  let amount = $state('Any');
  let sort = $state<'deadline' | 'amount'>('deadline');
  const amountMin = $derived(amount === 'Any' ? undefined : amount.startsWith('₦1') ? 1000000 : 2500000);
  const results = useQuery(api.opportunities.list, () => ({
    search: search || undefined, type, womenOnly: womenOnly || undefined, youthOnly: youthOnly || undefined,
    state: region === 'All Nigeria' ? undefined : region, amountMin, sort,
  }));
  const all = $derived(results.data ?? []);

  const offline = $derived(browser && !navigator.onLine);
  let savedIds = $state<Set<string>>(new Set());
  function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  function device() {
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  async function save(id: string, ev?: Event) {
    ev?.preventDefault(); ev?.stopPropagation();
    try { await client.mutation(api.track.save, { opportunityId: id as never, deviceId: device() }); } catch { /* queued offline */ }
    savedIds = new Set(savedIds).add(id);
  }
</script>
<div class="phone">
  <div class="topbar">
    <div>
      <div style="font-weight:800;letter-spacing:-.01em">Good morning{firstName ? `, ${firstName}` : ''} 👋</div>
      <div class="meta" style="font-size:12px">{hasProfile ? `Matched for ${profileSummary}` : 'Find funding you can get'}</div>
    </div>
    <a href="/onboarding" class="chip" style="text-decoration:none;min-height:36px">Edit profile</a>
  </div>

  <div style="padding:12px 14px 0">
    <div class="seg" role="tablist" aria-label="Discover modes">
      <button role="tab" aria-selected={view === 'matched'} onclick={() => setView('matched')}>✦ Matched for me</button>
      <button role="tab" aria-selected={view === 'all'} onclick={() => setView('all')}>◎ Browse all</button>
    </div>
  </div>

  {#if !hasProfile && view === 'matched'}
    <div class="banner warn" style="display:flex;gap:10px;align-items:center;justify-content:space-between">
      <div><strong>Get your matches</strong><div class="meta">2 min setup — see “Strong match / Possible match” on every card.</div></div>
      <a href="/onboarding" class="btn btn-primary" style="width:auto;min-height:40px;padding:8px 14px;text-decoration:none;white-space:nowrap">Set up</a>
    </div>
  {/if}

  {#if offline}<div class="banner warn">Offline · Showing last saved results.</div>{/if}

  <a href="/intake" style="text-decoration:none;color:inherit;display:block" aria-label="Verify a funding link">
    <div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:center;border-style:dashed">
      <span style="width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:#EAF2EC;display:grid;place-items:center;font-size:18px" aria-hidden="true">🔗</span>
      <div style="flex:1;min-width:0"><div style="font-weight:800">Got a funding link?</div><div class="meta">Verify it in seconds — official source or not.</div></div>
      <span style="font-weight:800;color:var(--accent)" aria-hidden="true">→</span>
    </div>
  </a>

  {#if view === 'matched'}
    <div class="card" style="padding:14px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <span class="pill pill-ok">{eligible} strong matches</span>
        <span class="pill pill-warn">{almost} possible matches</span>
        <span class="pill" style="background:var(--danger-soft);color:var(--danger);border:1px solid #F1B0AB">{urgent} due this week</span>
      </div>
      <div class="meta">Ranked by profile fit, deadlines soonest. Want the full catalogue? <button class="chip" style="min-height:32px;padding:4px 12px" onclick={() => setView('all')}>Browse all →</button></div>
    </div>

    {#if feed.isLoading}<div class="card"><p class="meta">Loading matches…</p></div><div class="card"><p class="meta">Loading matches…</p></div>
    {:else if feed.error}<div class="card"><p>Couldn't load — <a href="/home">Retry with saved version</a></p></div>
    {:else if matched.length===0}<div class="card"><div class="empty"><p style="margin:0;font-weight:800">No matches yet.</p><p class="meta">No verified matches for your profile yet. <a href="/onboarding">Complete your profile</a> or browse everything.</p><button class="btn btn-outline" style="margin-top:10px" onclick={() => setView('all')}>Browse all funding</button></div></div>
    {:else}
      {#each matched as o}
        {@const dl = daysLeft(o.deadline)}
        {@const urg = dl !== null && dl < 7}
        {@const isSaved = savedIds.has(o._id)}
        <a href={`/opportunity/${o._id}`} style="text-decoration:none;color:inherit">
        <div class="card" style="padding:14px">
          <div style="display:flex;gap:12px">
            <span style="width:44px;height:44px;flex:0 0 44px;border-radius:12px;background:linear-gradient(135deg,#0E3B2E,#1E7A4C);color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px">{initials(o.providerName)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;line-height:1.35;color:var(--fg)">{o.title}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                {#if o.matchTier==='eligible'}
                  <span class="pill pill-ok">★ Strong match</span>
                {:else if o.matchTier==='almost'}
                  <span class="pill pill-warn">Possible match</span>
                {:else}
                  <span class="pill">Check rules</span>
                {/if}
                <span class="pill pill-type">{o.type}</span>
              </div>
              <div class="meta" style="margin-top:6px">{o.amountOrBenefit} · <span class:due={true} class:urgent={urg} style={urg ? 'color:var(--danger);font-weight:700' : ''}>{deadlineLabel(o.deadline)}</span> · {o.locationEligibility}</div>
              <div class="meta" style="margin-top:2px">{o.matchReasons.join(' · ')}</div>
            </div>
            {#if isSaved}
              <button class="chip" style="align-self:flex-start;background:#EAF2EC;border-color:var(--accent);color:var(--accent);white-space:nowrap" aria-label="Open in My Applications" onclick={(e) => { e.preventDefault(); e.stopPropagation(); goto('/track'); }}>♥ → Apply</button>
            {:else}
              <button class="chip" aria-label="Save opportunity" onclick={(e) => save(o._id, e)} style="align-self:flex-start;white-space:nowrap">♡ Save</button>
            {/if}
          </div>
        </div>
        </a>
      {/each}
    {/if}
  {:else}
    <div class="card">
      <input class="input" placeholder="Search grants, BOI, fashion…" bind:value={search} aria-label="Search all funding" />
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        {#each typeOptions as t}
          <button class="chip" aria-pressed={type===t} onclick={() => type=t}>{t}</button>
        {/each}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;min-height:36px;font-size:13.5px"><input type="checkbox" bind:checked={womenOnly} /> Women-only</label>
        <label style="display:flex;align-items:center;gap:8px;min-height:36px;font-size:13.5px"><input type="checkbox" bind:checked={youthOnly} /> Youth-only</label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px">
        <select class="input" bind:value={region} aria-label="State filter">{#each ['All Nigeria','Lagos','Abuja FCT','Kano','Rivers','Oyo','Kaduna','Abia','Ogun','Kwara','Gombe'] as s}<option>{s}</option>{/each}</select>
        <select class="input" bind:value={amount} aria-label="Amount filter"><option>Any</option><option>₦1M+</option><option>₦2.5M+</option></select>
        <select class="input" bind:value={sort} aria-label="Sort"><option value="deadline">Soonest</option><option value="amount">Highest ₦</option></select>
      </div>
      <p class="meta" style="margin:10px 0 0">{all.length} results · Want a verdict on each? <button class="chip" style="min-height:32px;padding:4px 12px" onclick={() => setView('matched')}>See matched →</button></p>
    </div>

    {#if results.isLoading}<div class="card"><p class="meta">Loading…</p></div>
    {:else if results.error}<div class="card"><p>Couldn't load — <button class="chip" onclick={() => setView('matched')}>Back to matched</button></p></div>
    {:else if all.length===0}<div class="card"><div class="empty"><p style="margin:0;font-weight:800">No results.</p><p class="meta">No verified results. Try clearing filters or searching a provider name.</p></div></div>
    {:else}
      {#each all as o}
        {@const dl = daysLeft(o.deadline)}
        {@const urg = dl !== null && dl < 7}
        {@const isSaved = savedIds.has(o._id)}
        <a href={`/opportunity/${o._id}`} style="text-decoration:none;color:inherit">
          <div class="card" style="padding:12px 14px">
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="pill pill-type">{o.type}</span><span class="pill pill-verified">Official source</span>{#if urg}<span class="pill" style="background:var(--danger-soft);color:var(--danger)">Due {dl}d</span>{/if}</div>
                <div style="font-weight:700;margin-top:6px;line-height:1.35">{o.title}</div>
                <div class="meta">{o.amountOrBenefit} · {o.locationEligibility} · {deadlineLabel(o.deadline)}</div>
              </div>
              {#if isSaved}
                <button class="chip" style="background:#EAF2EC;border-color:var(--accent);color:var(--accent);white-space:nowrap;min-height:36px" aria-label="Open in My Applications" onclick={(e) => { e.preventDefault(); e.stopPropagation(); goto('/track'); }}>♥</button>
              {:else}
                <button class="chip" aria-label="Save opportunity" onclick={(e) => save(o._id, e)} style="min-height:36px">♡</button>
              {/if}
            </div>
          </div>
        </a>
      {/each}
    {/if}
  {/if}

  <Tabbar active="discover" />
</div>
