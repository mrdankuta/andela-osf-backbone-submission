<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery } from '@mmailaender/convex-svelte';
  import { useConvexClient } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  import Section from '$lib/Section.svelte';
  import { daysLeft, deadlineLabel, deadlineSortValue } from '$lib/deadline';
  import { enqueueOp, replayQueue } from '$lib/offline-queue';

  function device() {
    if (!browser) return 'server';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  const deviceId = device();
  const client = useConvexClient();
  const prof = useQuery(api.profiles.get, () => ({ ownerKey: deviceId }));
  const rows = useQuery(api.track.list, () => {
    const p = prof.data as any;
    return {
      deviceId,
      facts: p
        ? {
            state: p.state,
            sector: p.sector,
            businessStage: p.businessStage,
            cac: p.cac,
            staffSize: typeof p.staffSize === 'number' ? p.staffSize : undefined,
            age: p.age,
            womenLed: p.womenLed,
          }
        : {},
    };
  });
  const due = useQuery(api.reminders.dueForDevice, () => ({ deviceId }));
  const outcomesQuery = useQuery(api.planOutcomes.myOutcomes, () => ({ ownerKey: deviceId }));
  const outcomesByOpp = $derived(Object.fromEntries((outcomesQuery.data ?? []).map((o) => [o.opportunityId, o])));
  let outcomePick = $state<Record<string, string>>({});
  let outcomeReason = $state<Record<string, string>>({});
  let storyInputs = $state<Record<string, string>>({});
  let storyMsg = $state('');
  async function shareStory(oppId: string) {
    const story = (storyInputs[oppId] ?? '').trim();
    if (story.length < 20) {
      storyMsg = 'Tell us a little more (at least 20 characters).';
      return;
    }
    try {
      await client.mutation(api.successStories.submitStory, { ownerKey: deviceId, opportunityId: oppId as never, story });
      storyInputs = { ...storyInputs, [oppId]: '' };
      storyMsg = 'Thank you ✓ curators review stories before they appear.';
    } catch (e) { storyMsg = e instanceof Error ? e.message : 'Submit failed.'; }
  }
  async function saveOutcome(oppId: string) {
    const outcome = outcomePick[oppId];
    if (!outcome) return;
    try {
      await client.mutation(api.planOutcomes.recordOutcome, {
        ownerKey: deviceId,
        opportunityId: oppId as never,
        outcome: outcome as never,
        reasonCode: outcomeReason[oppId] || undefined,
      });
      stateMsg = 'Outcome recorded ✓ thank you — it helps others.';
    } catch (e) { stateMsg = e instanceof Error ? e.message : 'Outcome failed.'; }
  }
  const lowData = $derived(prof.data?.lowData ?? false);
  const data = $derived([...(rows.data ?? [])].sort((a, b) => deadlineSortValue(a.opportunity.deadline) - deadlineSortValue(b.opportunity.deadline)));
  const STATE_LABELS: Record<string, string> = {
    qualifying: 'Checking fit',
    ready: 'Ready',
    applying: 'Applying',
    applied: 'Applied',
    abandoned: 'On hold',
  };
  const TRACK_READINESS_LABELS: Record<string, string> = {
    ready: "You're ready",
    'can-become-ready': 'Can become ready',
    'not-currently-eligible': 'Not eligible yet',
    'needs-information': 'Needs a few answers',
  };
  const RISK_LABELS: Record<string, string> = {
    'at-risk': 'Deadline tight',
    infeasible: 'Deadline out of reach',
    overdue: 'Overdue',
  };
  const OUTCOME_LABELS: Record<string, string> = {
    submitted: 'Submitted',
    shortlisted: 'Shortlisted',
    rejected: 'Rejected',
    funded: 'Funded',
  };
  const REASON_LABELS: Record<string, string> = {
    'not-eligible': 'Not eligible',
    'incomplete-docs': 'Incomplete documents',
    'missed-deadline': 'Missed deadline',
    'no-response': 'No response',
    other: 'Other',
  };
  const saved = $derived(data.length);
  const inprog = $derived(data.filter((d) => d.displayState === 'applying' || d.displayState === 'ready').length);
  const applied = $derived(data.filter((d) => d.displayState === 'applied').length);
  const abandonedCount = $derived(data.filter((d) => d.displayState === 'abandoned').length);
  const remindersOn = $derived(prof.data ? (prof.data.reminderDays ?? []).length > 0 : true);
  const dueList = $derived(due.data ?? []);
  let offline = $state(browser ? !navigator.onLine : false);
  let low = $state(false);
  $effect(() => { low = lowData; });

  async function toggleTick(oppId: any, step: number) {
    try { await client.mutation(api.track.tick, { opportunityId: oppId, deviceId, step }); }
    catch {
      if (browser) enqueueOp(localStorage, { kind: 'tick', oppId, step, at: Date.now() });
      offline = true;
    }
  }
  async function replayOffline() {
    if (!browser) return;
    await replayQueue(localStorage, async (op) => {
      if (op.kind === 'tick') await client.mutation(api.track.tick, { opportunityId: op.oppId as any, deviceId, step: op.step });
      else if (op.kind === 'planState') await client.mutation(api.track.setPlanState, { opportunityId: op.oppId as any, deviceId, state: op.state as any, abandonReason: op.abandonReason });
      else await client.mutation(api.linkIntake.suggestLink, { url: op.url, deviceId });
    });
  }
  async function setState(oppId: any, state: 'qualifying' | 'ready' | 'applying' | 'applied' | 'abandoned', abandonReason?: string) {
    try { await client.mutation(api.track.setPlanState, { opportunityId: oppId, deviceId, state, abandonReason }); }
    catch (e) {
      if (browser && !navigator.onLine) enqueueOp(localStorage, { kind: 'planState', oppId, state, abandonReason, at: Date.now() });
      else stateMsg = e instanceof Error ? e.message : 'State change failed.';
    }
  }
  async function finishGuide(oppId: any) {
    try { await client.mutation(api.track.completeGuide, { opportunityId: oppId, deviceId }); }
    catch { stateMsg = 'Could not mark the guide done — try again online.'; }
  }
  let stateMsg = $state('');
  let abandonFor = $state<string | null>(null);
  let abandonReasons = $state<Record<string, string>>({});
  $effect(() => { if (browser && navigator.onLine) { void replayOffline(); } });
  async function remove(id: any) {
    await client.mutation(api.track.remove, { opportunityId: id, deviceId });
  }
</script>
<svelte:window on:online={() => (offline = false)} on:offline={() => (offline = true)} />
<div class="phone">
  <div class="topbar"><div><strong>My Applications</strong><div class="meta" style="font-size:12px">{offline ? 'Offline · saved locally' : 'Checklists & deadlines · soonest first'}</div></div></div>
  {#if offline}<div class="banner warn">Offline · Showing saved. Ticks will sync when you’re back online.</div>{/if}
  {#if dueList.length > 0}<div class="banner warn">⏰ <strong>{dueList.length} deadline{dueList.length > 1 ? 's' : ''} approaching:</strong> {dueList.map((d) => `${d.title} (${d.daysLeft}d)`).join(' · ')}</div>{/if}
  <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="pill pill-ok">{saved} saved</span><span class="pill" style="background:#EEF3EF;border:1px solid var(--border)">{inprog} in progress</span><span class="pill" style="background:#EAF2EC;color:var(--accent)">{applied} applied</span></div>
    <div class="meta" style="margin-left:auto">Deadline reminders {remindersOn ? 'on' : 'off'} · <a href="/profile">settings</a></div>
  </div>
  {#if rows.isLoading}<div class="card"><p class="meta">Loading…</p></div>
  {:else if data.length===0}
    <div class="card">
      <div class="empty">
        <div style="font-size:32px" aria-hidden="true">✓</div>
        <p style="margin:8px 0 4px;font-weight:800">No applications yet.</p>
        <p class="meta" style="margin:0">Tap <strong>Save</strong> on anything in Discover and it becomes a step-by-step checklist here — with deadlines, next steps, and progress.</p>
        <a class="btn btn-primary" style="text-decoration:none;margin-top:14px" href="/home">Discover funding →</a>
      </div>
      <div class="banner" style="margin:14px 0 0;background:var(--bg)">
        <strong>Do I need an account?</strong>
        <div class="meta" style="margin-top:4px">No — you can save & tick offline right now. <a href="/auth">Create account</a> to keep your applications if you change phones, and to get email reminders before deadlines.</div>
        <div class="meta" style="margin-top:6px">Discover: anonymous ✓ · Applications: on this device · Sync & email: with account</div>
      </div>
    </div>
  {:else}
    {#each data as r, i}
      {@const dl = daysLeft(r.opportunity.deadline)}
      {@const urg = dl !== null && dl <= 7 && r.status !== 'applied'}
    <Section eyebrow={r.opportunity.providerName} title={r.opportunity.title} summary={`${STATE_LABELS[r.displayState] ?? r.displayState} · ${r.progress}% · ${deadlineLabel(r.opportunity.deadline)}`} open={i === 0}>
        <div class="meta" style="margin-top:6px">Next: <strong style="color:var(--fg)">{r.nextStep}</strong>{#if urg} · <span style="color:var(--danger);font-weight:700">due soon</span>{/if}</div>
        <div class="meta" style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="pill">{STATE_LABELS[r.displayState] ?? r.displayState}</span>{#if r.readinessOverall}<span>{TRACK_READINESS_LABELS[r.readinessOverall] ?? r.readinessOverall}</span>{/if}{#if r.deadlineRisk === 'overdue'}<span style="color:var(--danger);font-weight:700">Overdue</span>{:else if RISK_LABELS[r.deadlineRisk]}<span>{RISK_LABELS[r.deadlineRisk]}</span>{/if}</div>
        {#if r.nextDependency}<div class="meta" style="margin-top:4px">Needs first: <strong style="color:var(--fg)">{r.nextDependency.label}</strong> — {r.nextDependency.guidance}</div>{/if}
        {#if r.guideTitle}<div class="meta" style="margin-top:4px">📖 Working on guide: <strong style="color:var(--fg)">{r.guideTitle}</strong>{#if r.guideDoneAt} ✓ done{:else} <button class="chip" onclick={() => finishGuide(r.opportunityId)}>Mark guide done</button>{/if}</div>{/if}
        <div style="background:#EAEFEB;border-radius:999px;height:10px;margin-top:8px;overflow:hidden"><div style={`width:${r.progress}%;height:100%;background:var(--accent);border-radius:999px;transition:width .25s`}></div></div>
        {#if !low}
        <div style="margin-top:10px;border-top:1px solid var(--border)">
          {#each r.opportunity.steps as s}
            {@const done = r.ticked.includes(s.order)}
            <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 2px;border-bottom:1px solid var(--border);min-height:44px;cursor:pointer">
              <input type="checkbox" checked={done} onchange={() => toggleTick(r.opportunityId, s.order)} aria-label={s.title} style="margin-top:5px" />
              <span style={done ? 'text-decoration:line-through;color:var(--muted)' : ''}>{s.title}</span>
            </label>
          {/each}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          {#if r.displayState === 'qualifying'}<button class="btn btn-primary" style="flex:1" onclick={() => setState(r.opportunityId, 'ready')}>Mark ready ✓</button><button class="chip" onclick={() => setState(r.opportunityId, 'applying')}>Start applying →</button>
          {:else if r.displayState === 'ready'}<button class="btn btn-primary" style="flex:1" onclick={() => setState(r.opportunityId, 'applying')}>Start applying →</button><button class="chip" onclick={() => setState(r.opportunityId, 'applied')}>Mark applied ✓</button>
          {:else if r.displayState === 'applying'}<button class="btn btn-primary" style="flex:1" onclick={() => setState(r.opportunityId, 'applied')}>Mark applied ✓</button>
          {:else if r.displayState === 'abandoned'}<button class="chip" onclick={() => setState(r.opportunityId, 'qualifying')}>Resume →</button>{/if}
        </div>
        {#if r.displayState !== 'applied' && r.displayState !== 'abandoned'}
          {#if abandonFor === r.opportunityId}
          <div style="display:flex;gap:8px;margin-top:8px">
            <input class="input" style="flex:1" placeholder="What changed? (one line)" bind:value={abandonReasons[r.opportunityId]} aria-label="Pause reason" />
            <button class="chip" onclick={() => { setState(r.opportunityId, 'abandoned', abandonReasons[r.opportunityId] ?? ''); abandonFor = null; }}>Confirm</button>
          </div>
          {:else}
          <button style="background:none;border:0;color:var(--muted);font-size:13px;margin-top:10px;cursor:pointer;min-height:44px;padding:0" onclick={() => (abandonFor = r.opportunityId)}>Not for me — pause this</button>
          {/if}
        {/if}
        {#if r.displayState === 'abandoned' && r.abandonReason}<div class="meta" style="margin-top:4px">Paused: {r.abandonReason}</div>{/if}
        {#if stateMsg}<div class="meta" style="margin-top:4px">{stateMsg}</div>{/if}
        {:else}
        <div class="meta" style="margin-top:8px">Text-first mode: open detail to tick steps.</div>
        {#if r.displayState === 'applying' || r.displayState === 'ready'}<button class="chip" style="margin-top:8px;background:var(--accent);color:#fff;border-color:var(--accent)" onclick={() => setState(r.opportunityId, 'applied')}>Mark applied ✓</button>{/if}
        {/if}
        {#if r.displayState==='applied'}<div class="banner ok" style="margin:10px 0 0"><strong>Applied ✓</strong> Keep your phone on — shortlisted founders get SMS within 3 weeks. <a href="/home?view=all">Find more</a></div>{/if}
        {#if r.displayState === 'applied'}
          <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
            <strong>Did it work? Share your story</strong>
            <p class="meta" style="margin:4px 0 6px">Optional, anonymous, reviewed before publishing. Under 600 characters.</p>
            <textarea class="input" rows="3" bind:value={storyInputs[r.opportunityId]} placeholder="GLOW funded my shop expansion in three weeks…" aria-label="Success story"></textarea>
            <button class="chip" style="margin-top:6px" onclick={() => shareStory(r.opportunityId)}>Submit story</button>
          </div>
        {/if}
        {#if storyMsg}<p class="meta" style="margin-top:4px">{storyMsg}</p>{/if}
        {#if r.displayState === 'applied'}
          {@const oc = outcomesByOpp[r.opportunityId]}
          <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
            <strong>What happened?</strong>
            {#if oc}<p class="meta" style="margin:4px 0">Outcome: <strong style="color:var(--fg)">{OUTCOME_LABELS[oc.outcome] ?? oc.outcome}</strong> ({oc.reportedBy === 'provider' ? 'confirmed by provider' : 'your report'}){#if oc.reasonCode} · {REASON_LABELS[oc.reasonCode] ?? oc.reasonCode}{/if}</p>{/if}
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <select class="input" style="flex:1;min-width:140px" bind:value={outcomePick[r.opportunityId]} aria-label="Application outcome">
                <option value="">Record outcome…</option>
                {#each ['submitted','shortlisted','rejected','funded'] as o}<option value={o}>{o}</option>{/each}
              </select>
              {#if outcomePick[r.opportunityId] === 'rejected'}
                <select class="input" style="flex:1;min-width:140px" bind:value={outcomeReason[r.opportunityId]} aria-label="Rejection reason">
                  <option value="">Reason (optional)…</option>
                  {#each ['not-eligible','incomplete-docs','missed-deadline','no-response','other'] as o}<option value={o}>{o}</option>{/each}
                </select>
              {/if}
              <button class="chip" onclick={() => saveOutcome(r.opportunityId)}>Save</button>
            </div>
          </div>
        {/if}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px">
          <a href={`/opportunity/${r.opportunityId}`} style="font-weight:700">Open detail →</a>
          <button class="chip" aria-label="Remove from track" onclick={() => remove(r.opportunityId)} style="color:var(--danger);border-color:#F1B0AB">Remove</button>
        </div>
    </Section>
    {/each}
    <div class="card" style="background:var(--bg);border-style:dashed">
      <strong>Keep it safe</strong><div class="meta" style="margin-top:4px">Your Track is on this device. <a href="/auth">Create account</a> to preserve it if you lose your phone and to get deadline emails.</div>
    </div>
  {/if}
  <Tabbar active="apply" />
</div>
