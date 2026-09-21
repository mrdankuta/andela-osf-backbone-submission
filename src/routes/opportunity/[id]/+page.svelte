<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api } from '$convex/_generated/api';
  import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  import Section from '$lib/Section.svelte';
  import { deadlineDateLabel } from '$lib/deadline';
  const id = $derived(page.params.id as never);
  const client = useConvexClient();
  const res = useQuery(api.opportunities.getById, () => ({ id }));
  const o = $derived(res.data);
  const evidenceResult = useQuery(api.opportunities.getEvidence, () => ({ id }));
  const evidence = $derived(evidenceResult.data);
  const evidenceClaims = $derived(evidence?.claims ?? []);
  const conflictKeys = $derived(
    [...new Set(
      evidenceClaims
        .filter((c) => c.status === 'contradicted')
        .map((c) => c.claimKey)
        .filter((k) => evidenceClaims.some((c) => c.claimKey === k && c.status === 'supported')),
    )],
  );
  const CLAIM_LABELS: Record<string, string> = {
    benefit: 'Benefit',
    applicationStatus: 'Application status',
    deadline: 'Deadline',
    eligibility: 'Eligibility',
    contact: 'Contact',
    officialDestination: 'Official destination',
  };
  const STATUS_LABELS: Record<string, string> = {
    supported: '✓ Confirmed',
    unsupported: '✕ Not confirmed',
    contradicted: '⚠ Sources disagree',
    'pending-review': '… Being checked',
  };
  function evidenceItemId(claimType: string, claimKey: string) {
    return claimType === 'eligibility' ? `evidence-${claimType}-${claimKey}` : `evidence-${claimType}`;
  }
  function summaryText(summary: { status: string; supported: number; total: number } | undefined) {
    if (!summary) return 'Verification pending';
    if (summary.status === 'fully-supported') return 'All key facts verified';
    if (summary.status === 'needs-review') return `Still verifying · ${summary.supported} of ${summary.total} facts confirmed`;
    if (summary.status === 'contradicted') return 'Conflicting sources · check before acting';
    return 'Verification pending';
  }
  const OVERALL_LABELS: Record<string, string> = {
    ready: "You're ready",
    'can-become-ready': 'You can become ready',
    'not-currently-eligible': 'Not eligible right now',
    'needs-information': 'Need a few answers first',
  };
  const RESULT_LABELS: Record<string, string> = {
    met: '✓ You meet this',
    unmet: '✕ Not met',
    unknown: '? Not answered yet',
    ambiguous: '~ Unclear',
    'needs-evidence': '… Still verifying',
  };
  function storedProfile() {
    if (!browser) return {};
    try {
      const p = JSON.parse(localStorage.getItem('ba-profile') ?? '{}');
      return {
        state: p.state,
        sector: p.sectors?.[0] ?? p.sector,
        businessStage: p.businessStage,
        cac: p.cac,
        staffSize: typeof p.staffSize === 'number' ? p.staffSize : undefined,
        age: p.age,
        womenLed: p.womenLed,
      };
    } catch { return {}; }
  }
  function device() {
    if (!browser) return 'server';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  let prof = $state(storedProfile());
  function refreshProf() { prof = storedProfile(); }
  let factOverrides = $state<Record<string, any>>({});
  const factsForQueries = $derived({ ...prof, ...factOverrides });
  const provenanceResult = useQuery(api.answerLedger.answerProvenance, () => ({ ownerKey: device(), opportunityId: id }));
  const provenance = $derived(provenanceResult.data ?? []);
  function provenanceFor(field: string) { return provenance.filter((p) => p.field === field); }
  const intakeResult = useQuery(api.opportunities.intakeQuestions, () => ({ id, ...factsForQueries }));
  let dismissed = $state<string[]>([]);
  let intakeInputs = $state<Record<string, string>>({});
  const intake = $derived((intakeResult.data?.questions ?? []).filter((q) => !dismissed.includes(q.profileField)));
  async function answerIntake(profileField: string, raw: string, justHere = false) {
    const value = profileField === 'womenLed' ? raw === 'Yes' : profileField === 'staffSize' ? Number(raw) : raw;
    if (profileField === 'staffSize' && !Number.isFinite(value as number)) return;
    if (justHere) {
      try {
        await client.mutation(api.answerLedger.setAnswerOverride, {
          ownerKey: device(),
          opportunityId: id,
          profileField,
          value: String(value),
          valueType: profileField === 'womenLed' ? 'boolean' : profileField === 'staffSize' ? 'number' : 'string',
        });
        factOverrides = { ...factOverrides, [profileField]: value };
      } catch { /* offline: kept for this view only */ factOverrides = { ...factOverrides, [profileField]: value }; }
      return;
    }
    try {
      const current = JSON.parse(localStorage.getItem('ba-profile') ?? '{}');
      const next = { ...current, [profileField]: value };
      if (profileField === 'sector') next.sectors = [value];
      localStorage.setItem('ba-profile', JSON.stringify(next));
    } catch { /* storage unavailable */ }
    try {
      await client.mutation(api.profiles.save, {
        ownerKey: device(),
        ...(profileField === 'womenLed'
          ? { womenLed: value as boolean }
          : profileField === 'staffSize'
            ? { staffSize: value as number }
            : { [profileField]: value as string }),
        source: 'intake',
        sourceOpportunityId: id,
      });
      try { await client.mutation(api.answerLedger.clearAnswerOverride, { ownerKey: device(), opportunityId: id, profileField }); } catch { /* none */ }
      const { [profileField]: _dropped, ...rest } = factOverrides;
      factOverrides = rest;
    } catch { /* offline: localStorage is source of truth */ }
    refreshProf();
  }
  function skipIntake(profileField: string) { dismissed = [...dismissed, profileField]; }
  const myDocsResult = useQuery(api.userDocuments.listDocuments, () => ({ ownerKey: device(), opportunityId: id }));
  const myDocs = $derived(myDocsResult.data ?? []);
  let docFile = $state<File | null>(null);
  let docType = $state('cac-certificate');
  let docMsg = $state('');
  let uploadingDoc = $state(false);
  async function uploadDoc() {
    if (!docFile || uploadingDoc) return;
    uploadingDoc = true;
    docMsg = '';
    try {
      const content = await docFile.arrayBuffer();
      const r = await client.mutation(api.userDocuments.uploadDocument, {
        ownerKey: device(),
        opportunityId: id,
        docType: docType as never,
        fileName: docFile.name,
        mimeType: docFile.type,
        content,
      });
      docMsg = r.replaced ? 'Replaced ✓ needs re-check by a curator.' : 'Uploaded ✓ awaiting curator check.';
      docFile = null;
    } catch (e) { docMsg = e instanceof Error ? e.message : 'Upload failed.'; }
    uploadingDoc = false;
  }
  async function downloadDoc(docId: string, fileName: string, mimeType: string) {
    try {
      const r = await client.query(api.userDocuments.getDocument, { ownerKey: device(), documentId: docId as never });
      if (!r) return;
      const url = URL.createObjectURL(new Blob([r.content], { type: mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline */ }
  }
  async function removeDoc(docId: string) {
    try { await client.mutation(api.userDocuments.deleteDocument, { ownerKey: device(), documentId: docId as never }); }
    catch { /* offline */ }
  }
  let justHereFields = $state<Record<string, boolean>>({});
  let draftQuestion = $state('business-summary');
  let draft = $state<any>(null);
  let draftEditText = $state('');
  let draftMsg = $state('');
  let drafting = $state(false);
  let showTraces = $state(false);
  async function generateDraft() {
    if (drafting) return;
    drafting = true;
    draftMsg = '';
    try {
      draft = await client.mutation(api.applicationDrafts.generateDraft, {
        ownerKey: device(),
        opportunityId: id,
        questionKey: draftQuestion as never,
      });
      draftEditText = draft.generatedText;
    } catch (e) { draftMsg = e instanceof Error ? e.message : 'Draft failed.'; }
    drafting = false;
  }
  async function saveDraftEdit() {
    if (!draft) return;
    try {
      await client.mutation(api.applicationDrafts.editDraft, { ownerKey: device(), draftId: draft._id, editedText: draftEditText });
      draftMsg = 'Edits saved ✓ your confirmed facts are untouched.';
    } catch (e) { draftMsg = e instanceof Error ? e.message : 'Save failed.'; }
  }
  async function reviewDraft(approved: boolean) {
    if (!draft) return;
    try {
      const r = await client.mutation(api.applicationDrafts.reviewDraft, { ownerKey: device(), draftId: draft._id, approved });
      draft = { ...draft, status: r.status };
      draftMsg = approved ? 'Approved ✓ use it in your application.' : 'Rejected — generate a fresh draft anytime.';
    } catch (e) { draftMsg = e instanceof Error ? e.message : 'Review failed.'; }
  }
  async function toggleJustHere(profileField: string) {
    if (justHereFields[profileField]) {
      const next: Record<string, boolean> = { ...justHereFields };
      delete next[profileField];
      justHereFields = next;
      try { await client.mutation(api.answerLedger.clearAnswerOverride, { ownerKey: device(), opportunityId: id, profileField }); } catch { /* none */ }
      const { [profileField]: _dropped, ...rest } = factOverrides;
      factOverrides = rest;
    } else {
      justHereFields = { ...justHereFields, [profileField]: true };
    }
  }
  const readinessResult = useQuery(api.opportunities.evaluateReadiness, () => ({ id, ...factsForQueries }));
  const readiness = $derived(readinessResult.data);
  const asOf = Date.now();
  const planResult = useQuery(api.opportunities.getReadinessPlan, () => ({ id, ...factsForQueries, asOf }));
  const freshnessResult = useQuery(api.sourceMonitor.getFreshness, () => ({ id }));
  const freshness = $derived(freshnessResult.data);
  const storiesResult = useQuery(api.successStories.publishedStories, () => ({ opportunityId: id }));
  const stories = $derived(storiesResult.data ?? []);
  const reviewResult = useQuery(api.finalReview.finalReview, () => ({ id, ownerKey: device(), ...factsForQueries, asOf }));
  const review = $derived(reviewResult.data);
  let handingOff = $state(false);
  async function handoff() {
    if (handingOff || !review) return;
    handingOff = true;
    try { await client.mutation(api.track.setPlanState, { opportunityId: id, deviceId: device(), state: 'applying' }); } catch { /* portal still opens */ }
    window.open(review.destination.url, '_blank', 'noopener');
    handingOff = false;
    await goto('/track');
  }
  const plan = $derived(planResult.data);
  const DEADLINE_LABELS: Record<string, string> = {
    feasible: 'You can finish the steps in time',
    'at-risk': 'The deadline is tight — start now',
    infeasible: 'Not enough time before the deadline',
    unknown: 'Timing unclear',
  };
  function expectedTime(min: number | null, max: number | null) {
    if (min === null || max === null) return 'Not stated';
    if (min === max) return `${min} day${min === 1 ? '' : 's'}`;
    return `${min}–${max} days`;
  }
  const trackRows = useQuery(api.track.list, () => ({ deviceId: device() }));
  let proofOpen = $state(false);
  const supportedCount = $derived(evidenceClaims.filter((c) => c.status === 'supported').length);
  function formatProfileValue(v: unknown) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  }
  function verdictDot(result: string) {
    if (result === 'met') return { mark: '✓', bg: 'var(--success-soft)', fg: 'var(--success)' };
    if (result === 'unmet') return { mark: '✕', bg: 'var(--danger-soft)', fg: 'var(--danger)' };
    return { mark: '?', bg: 'var(--gold-soft)', fg: '#7A5200' };
  }
  const myRow = $derived(trackRows.data?.find((r: { opportunityId: string }) => r.opportunityId === page.params.id));
  const isTracked = $derived(!!myRow);
  const ticked: number[] = $derived(myRow?.ticked ?? []);
  let savedMsg = $state('');
  let starting = $state(false);
  function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  async function save() {
    try { await client.mutation(api.track.save, { opportunityId: id, deviceId: device() }); savedMsg = 'Saved ✓ — see it in Apply'; setTimeout(()=>savedMsg='', 2500); }
    catch { savedMsg = 'Saved offline · will sync'; }
  }
  async function startChecklist() {
    if (starting) return;
    starting = true;
    try {
      await client.mutation(api.track.save, {
        opportunityId: id,
        deviceId: device(),
        guideCriterionKey: plan?.gap?.criterionKey,
        guideTitle: plan?.action?.title,
      });
    } catch { /* offline still navigate */ }
    await goto('/track');
  }
  async function tick(step: number) {
    try { await client.mutation(api.track.tick, { opportunityId: id, deviceId: device(), step }); }
    catch { /* queued; track page retries */ }
  }
</script>
<div class="phone">
  <div class="topbar"><a href="/home" style="text-decoration:none;font-weight:700">← Discover</a><strong>Detail</strong><span style="display:flex;gap:8px"><button class="chip" onclick={save} aria-label="Save opportunity" style={isTracked ? 'background:#EAF2EC;border-color:var(--accent);color:var(--accent)' : ''}>{isTracked ? '♥ Saved' : '♡ Save'}</button></span></div>
  {#if savedMsg}<div class="banner ok" style="margin-bottom:0">{savedMsg} · <a href="/track">View Track</a></div>{/if}
  {#if res.isLoading}<div class="card"><p class="meta">Loading…</p></div>
  {:else if res.error || !o}<div class="card"><p>Couldn't load — <a href="/home">Back to Discover</a></p></div>
  {:else}
    {@const expired = o.status === 'expired' || (o.deadline !== undefined && o.deadline < Date.now())}
    <div class="card card-hero" style="display:flex;gap:12px;align-items:center;padding:16px">
      <span style="width:52px;height:52px;flex:0 0 52px;border-radius:14px;background:rgba(255,255,255,.16);display:grid;place-items:center;font-weight:800;border:1px solid rgba(255,255,255,.18)">{initials(o.providerName)}</span>
      <div style="min-width:0"><div style="font-size:10.5px;color:var(--gold);letter-spacing:.1em;font-weight:800">{o.type.toUpperCase()} · {o.locationEligibility}</div><div style="font-weight:800;color:#fff;font-size:18px;line-height:1.3">{o.title}</div><div class="meta" style="color:rgba(255,255,255,.82)">by {o.providerName}</div></div>
    </div>
    <div class="card" style={expired ? 'opacity:.72' : ''}>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="pill pill-type">{o.type}</span><span class={evidence?.summary.status === 'fully-supported' ? 'pill pill-ok' : 'pill pill-warn'}>{summaryText(evidence?.summary)}</span></div>
      {#if freshness && freshness.state !== 'ok'}
        <div class={freshness.state === 'closed' ? 'banner bad' : 'banner warn'} style="margin-top:8px">
          {#if freshness.state === 'closed'}
            <strong>Closed.</strong> This opportunity is no longer active.
          {:else if freshness.state === 'unavailable'}
            <strong>Source unavailable.</strong> The official page could not be reached{#if freshness.lastChecked !== null} (last checked {new Date(freshness.lastChecked).toLocaleDateString()}){/if}. Treat details as unverified until it returns.
          {:else if freshness.state === 'under-review'}
            <strong>Under review.</strong> Curators are re-checking this listing against its sources.
          {:else}
            <strong>Possibly stale.</strong> The official page changed since verification — key claims are marked for recheck.
          {/if}
        </div>
      {:else if freshness?.lastChecked !== null && freshness?.lastChecked !== undefined}
        <p class="meta" style="margin-top:8px">Source last checked {new Date(freshness.lastChecked).toLocaleDateString()}.</p>
      {/if}
      {#if expired}<div class="banner bad"><strong>Closed.</strong> {o.deadline !== undefined ? `Applications ended ${new Date(o.deadline).toLocaleDateString()}.` : 'Check the official portal for current status.'} <a href="/home?view=all">Show similar open grants →</a></div>{/if}
    </div>
    <Section id="facts" eyebrow="The details" title="Key facts" summary={`${deadlineDateLabel(o.deadline)} · ${o.locationEligibility}`}>
      <p class="meta" style="margin:0 0 10px"><a href={o.contacts.officialLink} target="_blank" rel="noreferrer">Official portal ↗</a></p>
      <div class="facts">
        <div class="fact"><div class="eyebrow">Benefit</div><strong>{o.amountOrBenefit}</strong><div class="meta" style="margin-top:4px"><a href="#evidence-benefit" onclick={() => (proofOpen = true)}>See source</a></div></div>
        <div class="fact"><div class="eyebrow">Deadline</div><strong>{deadlineDateLabel(o.deadline)}</strong>{#if o.deadline === undefined && o.deadlineNote}<div class="meta" style="margin-top:4px">{o.deadlineNote}</div>{/if}<div class="meta" style="margin-top:4px"><a href="#evidence-deadline" onclick={() => (proofOpen = true)}>See source</a></div></div>
        <div class="fact"><div class="eyebrow">Location</div><strong>{o.locationEligibility}</strong><div class="meta" style="margin-top:4px"><a href="#evidence-eligibility-business-in-nigeria" onclick={() => (proofOpen = true)}>See source</a></div></div>
        <div class="fact"><div class="eyebrow">Effort</div><strong>{o.effort ?? '~2 hrs to apply'}</strong></div>
      </div>
      <p style="margin-top:12px;color:var(--fg)">{o.summaryPlain}</p>
      <button class="btn btn-outline no-print" style="margin-top:10px" onclick={() => window.print()}>🖨 Print one-pager</button>
    </Section>
    <div class="card print-only">
      <h2 style="margin:0 0 4px">{o.title}</h2>
      <p style="margin:0 0 8px">by {o.providerName} · {o.type} · {o.amountOrBenefit}</p>
      <p style="margin:0 0 8px">Deadline: {deadlineDateLabel(o.deadline)}{#if o.deadlineNote} — {o.deadlineNote}{/if} · Location: {o.locationEligibility}</p>
      <p style="margin:0 0 8px">{o.summaryPlain}</p>
      {#if o.steps.length > 0}
        <p style="margin:8px 0 4px"><strong>Steps</strong></p>
        <ol style="margin:0;padding-left:18px">{#each o.steps as s}<li>{s.title} — {s.detail}</li>{/each}</ol>
      {/if}
      {#if o.documents.length > 0}
        <p style="margin:8px 0 4px"><strong>Documents</strong></p>
        <ul style="margin:0;padding-left:18px">{#each o.documents as d}<li>{d.name}{d.required ? ' (required)' : ''} — {d.howToGet}</li>{/each}</ul>
      {/if}
      <p style="margin:8px 0 4px"><strong>Contacts</strong></p>
      <p style="margin:0">Official: {o.contacts.officialLink}{#if o.contacts.phone} · {o.contacts.phone}{/if}{#if o.contacts.email} · {o.contacts.email}{/if}</p>
      <p style="margin:8px 0 0;font-size:11px">Source: {o.sourceUrl} · Verified {new Date(o.lastVerified).toLocaleDateString()} · Backbone Africa — official portal prevails. Never pay upfront fees.</p>
    </div>
    {#if !intakeResult.isLoading && intake.length > 0}
    <Section id="intake" eyebrow="Eligibility check" title="A few questions" summary={`${intake.length} missing`} open>
      <p class="meta" style="margin:0 0 10px">Only what's still missing — skip anything.</p>
      {#each intake as q}
        {@const saved = provenanceFor(q.profileField).find((p) => !p.overridden)}
        {@const overridden = provenanceFor(q.profileField).find((p) => p.overridden)}
        {@const justHere = !!justHereFields[q.profileField]}
        <div style="border-top:1px solid var(--border);padding:10px 0">
          <strong>{q.label}</strong>{#if justHere} <span class="meta">(just this opportunity)</span>{/if}
          {#each q.affects as a}<div class="meta" style="margin-top:2px">Affects {a.label}: {a.why}</div>{/each}
          {#if saved}
            <div class="meta" style="margin-top:4px">Saved answer: <strong style="color:var(--fg)">{saved.displayValue}</strong> — confirmed {saved.sourceLabel}{#if saved.stale} · over 6 months old, please confirm{/if}</div>
          {/if}
          {#if overridden}
            <div class="meta" style="margin-top:2px">This opportunity uses: <strong style="color:var(--fg)">{overridden.displayValue}</strong> (your saved answer is untouched)</div>
          {/if}
          {#if q.kind === 'select' || q.kind === 'boolean'}
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              {#each (q.kind === 'boolean' ? ['Yes', 'No'] : q.options) as opt}
                <button class="chip" onclick={() => answerIntake(q.profileField, opt, justHere)}>{opt}</button>
              {/each}
              <button class="chip" onclick={() => skipIntake(q.profileField)}>Skip</button>
            </div>
          {:else}
            <div style="display:flex;gap:8px;margin-top:8px">
              <input class="input" style="flex:1" type={q.kind === 'number' ? 'number' : 'text'} placeholder={q.label} bind:value={intakeInputs[q.profileField]} aria-label={q.label} />
              <button class="chip" onclick={() => answerIntake(q.profileField, intakeInputs[q.profileField] ?? '', justHere)}>Save</button>
              <button class="chip" onclick={() => skipIntake(q.profileField)}>Skip</button>
            </div>
          {/if}
          {#if saved && !justHere}
            <button class="chip" style="margin-top:6px" onclick={() => toggleJustHere(q.profileField)}>Answer just for this opportunity</button>
          {:else if justHere}
            <div class="meta" style="margin-top:6px">Answer above — it stays local to this opportunity. <button class="chip" onclick={() => toggleJustHere(q.profileField)}>Back to saved answer</button></div>
          {/if}
        </div>
      {/each}
    </Section>
    {/if}
    <div class="card" id="readiness">
      <p class="eyebrow" style="margin:0 0 2px">Your verdict</p>
      {#if readinessResult.isLoading}
        <p class="meta">Loading readiness…</p>
      {:else if readinessResult.error}
        <p class="meta">Readiness could not be loaded.</p>
      {:else if readiness}
        <h2 style="margin:0 0 4px;font-size:22px;line-height:1.25;letter-spacing:-.01em">{OVERALL_LABELS[readiness.overall] ?? readiness.overall}</h2>
        <p class="meta" style="margin:0 0 6px">Your profile answers are checked against the official programme rules.</p>
        {#each readiness.assessments as a}
          {@const dot = verdictDot(a.result)}
          {@const you = a.criterionKey.startsWith('manual-review-') ? null : formatProfileValue(a.profileValue)}
          <div class="verdict-row">
            <span class="verdict-dot" style="background:{dot.bg};color:{dot.fg}" aria-hidden="true">{dot.mark}</span>
            <div style="flex:1;min-width:0">
              <strong style="display:block;line-height:1.35">{a.label}</strong>
              <div class="meta" style="margin-top:2px">{a.requirement}</div>
              {#if you}
                <div style="margin-top:6px;font-size:13.5px"><span class="meta">Your profile:</span> <strong>{you}</strong></div>
              {/if}
              {#if a.criterionKey.startsWith('manual-review-')}
                <div class="meta" style="margin-top:2px">Backbone cannot check this from your profile yet. Confirm it on the official programme page.</div>
              {:else if a.result === 'needs-evidence'}
                <div class="meta" style="margin-top:2px">{you ? 'Your answer is saved. We’re checking it against the official programme rules.' : 'We’re checking the official programme rules before deciding this.'}</div>
              {:else}
                <div class="meta" style="margin-top:2px">{RESULT_LABELS[a.result] ?? a.result}</div>
                {#if a.result !== 'met' && a.guidance}<div class="meta" style="margin-top:2px">{a.guidance}</div>{/if}
              {/if}
            </div>
          </div>
        {/each}
        <p class="meta" style="margin:8px 0 0"><a href="#proof" onclick={() => (proofOpen = true)}>How we checked ↓</a></p>
        {#if readiness.assessments.some((a) => a.result === 'unknown')}
          <a class="btn btn-outline" style="text-decoration:none;margin-top:10px" href="/onboarding">Review profile facts</a>
        {/if}
      {/if}
    </div>
    <div class="card" id="next-action">
      <p class="eyebrow" style="margin:0 0 2px">Your next move</p>
      <h3 style="margin:0 0 4px;font-size:15px">What to do next</h3>
      {#if planResult.isLoading}
        <p class="meta">Loading next action…</p>
      {:else if planResult.error}
        <p class="meta">Next action could not be loaded.</p>
      {:else if plan}
        {#if plan.planStatus === 'ready'}
          <p class="meta">Nothing blocking you right now.</p>
        {:else}
          {#if plan.gap}
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <strong>{plan.gap.label}</strong>
              <span class="meta">{RESULT_LABELS[plan.gap.result] ?? plan.gap.result}</span>
            </div>
          {/if}
          {#if plan.planStatus === 'blocked'}
            <div class="banner bad" style="margin:8px 0 0"><strong>Blocked.</strong> You don't meet a core requirement — don't apply unless the official terms change.</div>
          {:else if plan.planStatus === 'needs-information'}
            <p class="meta" style="margin-top:8px">Answer the questions above and we'll suggest your next step.</p>
          {/if}
          {#if plan.action}
            <div style="margin-top:10px">
              <strong>{plan.action.title}</strong>
              {#if plan.action.matchNote}<p class="meta" style="margin-top:4px">⚠️ {plan.action.matchNote}</p>{/if}
              {#if plan.action.stale}<p class="meta" style="margin-top:4px">⚠️ Guide may be stale — verify the current terms.</p>{/if}
              <p class="meta" style="margin-top:4px">{plan.action.detail}</p>
              <p class="meta" style="margin-top:4px"><a href={plan.action.sourceUrl} target="_blank" rel="noreferrer">Official guidance</a></p>
              <p class="meta" style="margin-top:4px">Takes {expectedTime(plan.action.expectedDaysMin, plan.action.expectedDaysMax)} · {plan.action.costEstimate}</p>
              {#if plan.action.dependencies.length > 0}
                <p class="meta" style="margin-top:4px">Prerequisites:</p>
                <ol class="meta" style="margin:2px 0 0;padding-left:18px">{#each plan.action.dependencies as d}<li>{d}</li>{/each}</ol>
              {/if}
              <p class="meta" style="margin-top:4px">Please note: {plan.action.uncertainty}</p>
            </div>
          {/if}
          <p class="meta" style="margin-top:8px">{DEADLINE_LABELS[plan.deadline.status] ?? plan.deadline.status}{plan.deadline.daysAvailable !== null ? ` · ${plan.deadline.daysAvailable} days available` : ''}</p>
          {#if plan.alternative}
            <div class={plan.planStatus === 'blocked' || plan.deadline.status === 'infeasible' ? 'banner warn' : 'banner'} style="margin-top:8px">
              <strong>Alternative: {plan.alternative.title}</strong>
              <div class="meta" style="margin-top:4px">{plan.alternative.detail}</div>
              {#if plan.alternative.url}<div class="meta" style="margin-top:4px"><a href={plan.alternative.url} target="_blank" rel="noreferrer">Open alternative</a></div>{/if}
            </div>
          {/if}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-outline" onclick={save}>Save this plan</button>
            <a class="btn btn-outline" style="text-decoration:none" href="/track">Open My Applications</a>
          </div>
        {/if}
      {/if}
    </div>
    <Section id="final-review" eyebrow="Pre-apply check" title="Before you apply" summary={review ? (OVERALL_LABELS[review.overall] ?? review.overall) : ''}>
      {#if reviewResult.isLoading}
        <p class="meta">Loading final review…</p>
      {:else if reviewResult.error || !review}
        <p class="meta">Final review could not be loaded.</p>
      {:else}
        <p style="margin:0 0 4px"><strong>{OVERALL_LABELS[review.overall] ?? review.overall}</strong> <span class="meta">· {review.planStatus}</span></p>
        {#if review.blockers.length > 0}
          <div class="banner bad" style="margin:8px 0">{#each review.blockers as b}<div>{b}</div>{/each}</div>
        {/if}
        {#each review.mandatory as m}
          <div class="meta" style="margin-top:4px">✓ {m.label}: <strong style="color:var(--fg)">{RESULT_LABELS[m.result] ?? m.result}</strong>{#if m.profileValue !== null} ({m.profileValue}){/if}</div>
        {/each}
        {#if review.confirmedFacts.length > 0}
          <p class="meta" style="margin-top:6px">Confirmed: {review.confirmedFacts.map((f) => `${f.field}=${f.value}`).join(' · ')}</p>
        {/if}
        {#each review.documents as d}
          <div class="meta" style="margin-top:4px">📄 {d.label}: <strong style="color:var(--fg)">{d.state}</strong></div>
        {/each}
        {#if review.unresolved.length > 0}
          <div class="banner warn" style="margin-top:8px"><strong>Unresolved ({review.unresolved.length})</strong>{#each review.unresolved as u}<div class="meta" style="margin-top:4px">{u.label} — {u.detail}</div>{/each}</div>
        {/if}
        <p class="meta" style="margin-top:8px">Deadline: {DEADLINE_LABELS[review.deadline.status] ?? review.deadline.status}{#if review.deadline.date} ({review.deadline.date}){/if}{#if review.deadline.daysAvailable !== null} · {review.deadline.daysAvailable} days{/if}{#if review.deadline.urgent} · <strong style="color:var(--danger)">urgent</strong>{/if}</p>
        {#if review.freshness.state !== 'ok'}
          <p class="meta" style="margin-top:4px">Source state: <strong style="color:var(--fg)">{review.freshness.state}</strong>{#if review.freshness.lastChecked !== null} (checked {new Date(review.freshness.lastChecked).toLocaleDateString()}){/if}</p>
        {/if}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <a class="btn btn-outline" style="text-decoration:none" href={review.destination.url} target="_blank" rel="noreferrer">Official portal ↗{#if !review.destination.verified} (unverified link){/if}</a>
          <button class="btn btn-primary" disabled={!review.canContinue || handingOff} onclick={handoff}>{handingOff ? 'Opening…' : review.canContinue ? 'Continue to official application →' : 'Blocked — see above'}</button>
        </div>
        <p class="meta" style="margin-top:8px">{review.authorityNote}</p>
      {/if}
    </Section>
    <Section id="proof" eyebrow="Proof" title="How we checked this" summary={`${supportedCount} of ${evidenceClaims.length} confirmed`} bind:open={proofOpen}>
      {#if conflictKeys.length > 0}
        <div class="banner warn" style="margin:0 0 8px"><strong>Sources disagree{#if conflictKeys.length > 1} on {conflictKeys.length} facts{/if}.</strong> Both passages are shown below — nothing here is chosen for you until curators resolve it.</div>
      {/if}
      {#if evidenceResult.isLoading}
        <p class="meta">Loading evidence…</p>
      {:else if evidenceResult.error}
        <p class="meta">Evidence could not be loaded.</p>
      {:else if evidenceClaims.length === 0}
        <p class="meta">Evidence not yet available.</p>
      {:else}
        {#each evidenceClaims as claim}
          <div id={evidenceItemId(claim.claimType, claim.claimKey)} style="border-top:1px solid var(--border);padding:10px 0">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <strong>{CLAIM_LABELS[claim.claimType] ?? claim.claimType}</strong>
              <span class="meta">{STATUS_LABELS[claim.status] ?? claim.status}</span>
            </div>
            <div style="margin-top:4px">{claim.displayValue}</div>
            {#if claim.sourcePassage}
              <blockquote class="quote">{claim.sourcePassage}</blockquote>
            {:else}
              <div class="meta" style="margin-top:6px">No source quote captured yet.</div>
            {/if}
            {#if claim.note}<div class="meta" style="margin-top:4px">{claim.note}</div>{/if}
            <div class="meta" style="margin-top:6px"><a href={claim.sourceUrl} target="_blank" rel="noreferrer">Open source</a> · Checked {new Date(claim.checkedAt).toLocaleDateString()}</div>
          </div>
        {/each}
      {/if}
    </Section>
    <Section id="draft" eyebrow="Your application" title="Get writing help" summary="Drafts from your confirmed answers">
      <p class="meta" style="margin:0 0 10px">Gaps stay marked — you approve before using.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="input" style="flex:1;min-width:160px" bind:value={draftQuestion} aria-label="Application question">
          <option value="business-summary">Describe your business</option>
          <option value="eligibility-statement">Why you are eligible</option>
          <option value="document-cover">Document cover note</option>
        </select>
        <button class="chip" disabled={drafting} onclick={generateDraft}>{drafting ? 'Drafting…' : 'Generate'}</button>
      </div>
      {#if draft}
        <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
          <p class="meta" style="margin:0 0 6px">Status: <strong style="color:var(--fg)">{draft.status}</strong>{#if draft.gaps.length > 0} · {draft.gaps.length} gap{draft.gaps.length === 1 ? '' : 's'} to fill{/if}</p>
          <textarea class="input" rows="8" bind:value={draftEditText} aria-label="Draft text"></textarea>
          {#if draft.gaps.length > 0}
            <div class="meta" style="margin-top:6px">Gaps: {draft.gaps.join(' · ')}</div>
          {/if}
          <button class="chip" style="margin-top:6px" onclick={() => (showTraces = !showTraces)}>{showTraces ? 'Hide sources' : 'Show sources'}</button>
          {#if showTraces}
            {#each draft.traces as t}<p class="meta" style="margin:4px 0">“{t.statement.slice(0, 90)}{t.statement.length > 90 ? '…' : ''}” → {t.source}</p>{/each}
          {/if}
          {#if draft.status === 'draft'}
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="chip" onclick={saveDraftEdit}>Save edits</button>
              <button class="chip" style="background:var(--accent);color:#fff;border-color:var(--accent)" onclick={() => reviewDraft(true)}>Approve ✓</button>
              <button class="chip" onclick={() => reviewDraft(false)}>Reject</button>
            </div>
          {/if}
        </div>
      {/if}
      {#if draftMsg}<p class="meta" style="margin-top:8px">{draftMsg}</p>{/if}
    </Section>
    {#if stories.length > 0}
    <Section id="stories" eyebrow="Social proof" title="Community stories" summary={`${stories.length} shared`}>
      <p class="meta" style="margin:0 0 8px">Anonymous, curator-reviewed. Individual results vary.</p>
      {#each stories.slice(0, 3) as s}<blockquote class="quote">“{s.story}”</blockquote>{/each}
    </Section>
    {/if}
    <div class="banner warn">⚠️ <strong>Stay safe:</strong> {o.scamNote ?? "Never pay upfront — real grants don't ask for fees."} <a href={`/assistant?id=${o._id}`}>Ask about this ✦</a> if unsure.</div>
    <Section id="steps" eyebrow="Your application" title="Application steps" summary={`${ticked.length}/${o.steps.length} done`}>
      <ol style="margin:0;padding-left:18px">{#each o.steps as s}<li style="margin-top:10px"><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" checked={ticked.includes(s.order)} onchange={() => tick(s.order)} aria-label={`Tick step ${s.order}`} style="margin-top:5px" /><span><strong>{s.title}</strong><br /><span class="meta">{s.detail}</span>{#if s.link} <a href={s.link} target="_blank" rel="noreferrer">Open ↗</a>{/if}</span></label></li>{/each}</ol>
      <p class="meta" style="margin-top:10px">Ticking a step auto-saves this to <a href="/track">My Applications</a>.</p>
    </Section>
    <Section id="documents" eyebrow="Your application" title="Documents" summary={`${o.documents.length} to prepare`}>
      <ul style="margin:0;padding-left:18px">{#each o.documents as d}<li style="margin-top:8px"><strong>{d.name}</strong> {d.required ? '(Required)' : '(Optional)'}<br /><span class="meta">How to get: {d.howToGet}</span></li>{/each}</ul>
      <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
        <strong>Your file</strong>
        <p class="meta" style="margin:4px 0 8px">Private to you · PDF/JPEG/PNG up to 256 KB · a new upload resets curator check.</p>
        {#each myDocs as d}
          <p class="meta" style="margin:4px 0"><strong style="color:var(--fg)">{d.fileName}</strong> [{d.state}] <button class="chip" onclick={() => downloadDoc(d._id, d.fileName, d.mimeType)}>Download</button> <button class="chip" onclick={() => removeDoc(d._id)}>Delete</button></p>
        {/each}
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <input class="input" style="flex:1;min-width:140px" type="file" accept=".pdf,.jpg,.jpeg,.png" onchange={(e) => { docFile = e.currentTarget.files?.[0] ?? null; }} aria-label="Choose document" />
          <select class="input" bind:value={docType} aria-label="Document type">
            {#each ['cac-certificate','id-card','bank-statement','business-plan','other'] as t}<option value={t}>{t}</option>{/each}
          </select>
          <button class="chip" disabled={uploadingDoc || !docFile} onclick={uploadDoc}>{uploadingDoc ? 'Uploading…' : 'Upload'}</button>
        </div>
        {#if docMsg}<p class="meta" style="margin-top:8px">{docMsg}</p>{/if}
      </div>
    </Section>
    <Section id="contacts" eyebrow="Talk to them" title="Contacts">
        {#if o.contacts.phone}<p style="margin:0 0 8px"><a href={`tel:${o.contacts.phone}`}>Call: {o.contacts.phone}</a></p>{/if}
        {#if o.contacts.email}<p style="margin:0 0 8px"><a href={`mailto:${o.contacts.email}`}>Email: {o.contacts.email}</a></p>{/if}
        {#if o.contacts.office}<p class="meta" style="margin:0 0 8px">Office: {o.contacts.office}</p>{/if}
        <a class="btn btn-outline" style="text-decoration:none;margin-top:8px" href={o.contacts.officialLink} target="_blank" rel="noreferrer">Open official portal ↗</a>
        <p class="meta" style="margin:8px 0 0"><a href="#evidence-officialDestination" onclick={() => (proofOpen = true)}>See source</a></p>
    </Section>
    <div style="margin:10px 14px">
      <p class="meta" style="margin-top:12px">Source: {o.sourceUrl} · Last checked: {new Date(o.lastVerified).toLocaleDateString()} · <a href={`/report?id=${o._id}`}>Report issue</a></p>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <a class="btn btn-outline" style="text-decoration:none;flex:1" href={`https://wa.me/?text=${encodeURIComponent(o.title + ' · ' + o.amountOrBenefit + ' · ' + o.contacts.officialLink)}`} target="_blank" rel="noreferrer">Share via WhatsApp</a>
        <button class="btn btn-outline" style="flex:1" onclick={() => { navigator.clipboard?.writeText(window.location.href); savedMsg = 'Link copied ✓'; setTimeout(()=>savedMsg='',2000); }}>Copy link</button>
        <a class="btn btn-outline" style="text-decoration:none;flex:1" href={`/assistant?id=${o._id}`}>Ask about this ✦</a>
      </div>
    </div>
    <div style="position:sticky;bottom:58px;padding:12px 14px;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-outline" style="flex:1" onclick={save}>{isTracked ? '♥ Saved' : '♡ Save to Track'}</button>
      <button class="btn btn-primary" style="flex:1.2" onclick={startChecklist} disabled={starting}>{#if isTracked}Continue checklist →{:else if starting}Saving…{:else}Start checklist →{/if}</button>
    </div>
  {/if}
  <Tabbar active="discover" />
</div>
