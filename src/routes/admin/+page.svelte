<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery } from '@mmailaender/convex-svelte';
  import { useConvexClient } from '@mmailaender/convex-svelte';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  const client = useConvexClient();
  const auth = useAuth();
  const gate = useQuery(api.curation.isCurator, () => ({}));
  const flags = useQuery(api.curation.queue, () => ({}));
  const opps = useQuery(api.opportunities.list, () => ({}));
  const data = $derived(opps.data ?? []);
  const drafts = useQuery(api.importDrafts.listDrafts, () => ({}));
  const draftList = $derived(drafts.data ?? []);
  const linksQuery = useQuery(api.entityLinks.listLinks, () => ({}));
  const linkList = $derived(linksQuery.data ?? []);
  const conflictsQuery = useQuery(api.curation.conflictQueue, () => ({}));
  const conflictList = $derived(conflictsQuery.data ?? []);
  const pendingDocsQuery = useQuery(api.userDocuments.pendingDocuments, () => ({}));
  const pendingDocs = $derived(pendingDocsQuery.data ?? []);
  const pendingStoriesQuery = useQuery(api.successStories.pendingStories, () => ({}));
  const pendingStories = $derived(pendingStoriesQuery.data ?? []);
  async function reviewStory(storyId: string, approved: boolean) {
    reviewMsg = '';
    try {
      await client.mutation(api.successStories.reviewStory, { storyId: storyId as any, approved });
      reviewMsg = approved ? 'Story published ✓' : 'Story rejected.';
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Review failed.'; }
  }
  async function verifyDoc(docId: string, accepted: boolean) {
    reviewMsg = '';
    try {
      await client.mutation(api.userDocuments.verifyDocument, { documentId: docId as any, accepted });
      reviewMsg = accepted ? 'Document accepted ✓' : 'Sent back to unverified.';
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Verify failed.'; }
  }
  const suggestionsQuery = useQuery(api.linkIntake.listSuggestions, () => ({}));
  const suggestionList = $derived(suggestionsQuery.data ?? []);
  async function promoteSuggestion(suggestionId: string, url: string) {
    reviewMsg = 'Importing…';
    try {
      const r = await client.action(api.importDrafts.requestImport, { sourceUrl: url });
      if (r.captureStatus === 'captured') {
        await client.mutation(api.linkIntake.resolveSuggestion, { suggestionId: suggestionId as any, outcome: 'imported', draftId: r.draftId });
        reviewMsg = `Imported ✓ draft ready for review (${r.proposed} proposed, ${r.unresolved} to review).`;
      } else {
        reviewMsg = `Capture failed: ${r.error}`;
      }
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Import failed.'; }
  }
  async function declineSuggestion(suggestionId: string) {
    try {
      await client.mutation(api.linkIntake.resolveSuggestion, { suggestionId: suggestionId as any, outcome: 'declined' });
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Decline failed.'; }
  }
  let contraClaim = $state('');
  let contraPassage = $state('');
  let contraSource = $state('');
  let contraOpp = $state('');
  let compareMsg = $state('');
  async function recordContradiction() {
    if (!contraOpp) return;
    reviewMsg = '';
    try {
      await client.mutation(api.curation.recordContradiction, {
        opportunityId: contraOpp as any,
        claimKey: contraClaim.trim(),
        sourceUrl: contraSource.trim(),
        sourcePassage: contraPassage.trim(),
      });
      contraClaim = ''; contraPassage = ''; contraSource = '';
      reviewMsg = 'Contradiction recorded — publication is blocked until resolved.';
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Record failed.'; }
  }
  async function resolveRow(evidenceId: string, status: 'supported' | 'unsupported') {
    reviewMsg = '';
    try { await client.mutation(api.curation.resolveEvidence, { evidenceId: evidenceId as any, status }); }
    catch (e) { reviewMsg = e instanceof Error ? e.message : 'Resolve failed.'; }
  }
  async function compareWithModel(claim: string, passage: string) {
    compareMsg = 'Asking…';
    try {
      const r = await client.action(api.curation.comparePassages, { claim, passage });
      compareMsg = `${r.relation} (${Math.round(r.confidence * 100)}%) — record only what you verified.`;
    } catch { compareMsg = 'Model unavailable — judge the passages yourself.'; }
  }
  let dupes = $state<any[]>([]);
  let cohortLabels = $state<Record<string, string>>({});
  let providerNameInput = $state('');
  let providerLinkInput = $state('');
  let providerDupes = $state<any[]>([]);
  let importUrl = $state('');
  let importing = $state(false);
  let importMsg = $state('');
  async function importOfficialUrl() {
    if (!importUrl.trim() || importing) return;
    importing = true;
    importMsg = 'Capturing…';
    try {
      const r = await client.action(api.importDrafts.requestImport, { sourceUrl: importUrl.trim() });
      importMsg = r.captureStatus === 'captured'
        ? `Captured ✓ ${r.proposed} proposed, ${r.unresolved} need review. See drafts below.`
        : `Capture failed: ${r.error}`;
      importUrl = '';
    } catch (e) {
      importMsg = e instanceof Error ? e.message : 'Import failed.';
    }
    importing = false;
  }
  let selectedDraft = $state<any>(null);
  let corrections = $state<Record<string, string>>({});
  let reviewMsg = $state('');
  let providerName = $state('');
  let providerType = $state('');
  let publishType = $state('grant');
  function fieldEntries(d: any) {
    const singles = ['title', 'benefit', 'deadline', 'contacts', 'programStatus', 'applyDestination']
      .map((key) => ({ key, field: d[key], family: null as string | null, role: null as string | null }));
    const crits = (d.criteria ?? []).map((c: any, i: number) => ({ key: `criterion:${i}`, field: c.field, family: c.family as string, role: c.role as string }));
    return [...singles, ...crits];
  }
  function decisionFor(key: string) { return (selectedDraft?.decisions ?? []).find((d: any) => d.fieldKey === key); }
  async function openDraft(id: string) {
    reviewMsg = '';
    dupes = [];
    try {
      selectedDraft = await client.query(api.importDrafts.getDraft, { draftId: id as any });
      dupes = await client.query(api.entityLinks.suggestProgramLinks, { draftId: id as any });
    }
    catch (e) { reviewMsg = e instanceof Error ? e.message : 'Could not load draft.'; }
  }
  async function linkDupe(candidateId: string, relation: 'same' | 'related' | 'cohort', key: string) {
    if (!selectedDraft) return;
    reviewMsg = '';
    try {
      await client.mutation(api.entityLinks.linkEntities, {
        kind: 'program',
        fromId: selectedDraft._id,
        fromKind: 'draft',
        toId: candidateId,
        relation,
        cohortLabel: relation === 'cohort' ? (cohortLabels[key] ?? '') : undefined,
      });
      dupes = await client.query(api.entityLinks.suggestProgramLinks, { draftId: selectedDraft._id });
      reviewMsg = `Linked ✓ (${relation}). The draft stays intact for provenance.`;
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Link failed.'; }
  }
  async function revertLink(linkId: string) {
    try { await client.mutation(api.entityLinks.revertLink, { linkId: linkId as any }); }
    catch (e) { reviewMsg = e instanceof Error ? e.message : 'Revert failed.'; }
  }
  async function checkProvider() {
    if (!providerNameInput.trim()) return;
    reviewMsg = '';
    try {
      providerDupes = await client.query(api.entityLinks.suggestProviderLinks, {
        name: providerNameInput.trim(),
        officialLink: providerLinkInput.trim() || undefined,
      });
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Provider check failed.'; }
  }
  async function saveAndLinkProvider(candidateId: string, relation: 'same' | 'related') {
    reviewMsg = '';
    try {
      const newId = await client.mutation(api.providers.upsert, {
        name: providerNameInput.trim(),
        type: 'Unknown',
        verified: false,
        officialLink: providerLinkInput.trim() || undefined,
      });
      await client.mutation(api.entityLinks.linkEntities, {
        kind: 'provider',
        fromId: newId,
        toId: candidateId,
        relation,
      });
      providerDupes = await client.query(api.entityLinks.suggestProviderLinks, {
        name: providerNameInput.trim(),
        officialLink: providerLinkInput.trim() || undefined,
      });
      reviewMsg = `Saved and linked ✓ (${relation}). Both records keep their sources.`;
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Save failed.'; }
  }
  async function decide(key: string, decision: 'accept' | 'correct' | 'reject' | 'ambiguous') {
    if (!selectedDraft) return;
    reviewMsg = '';
    try {
      await client.mutation(api.importDrafts.decideField, {
        draftId: selectedDraft._id,
        fieldKey: key,
        decision,
        correctedValue: decision === 'correct' ? (corrections[key] ?? '') : undefined,
      });
      selectedDraft = await client.query(api.importDrafts.getDraft, { draftId: selectedDraft._id });
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Decision failed.'; }
  }
  async function publishDraft() {
    if (!selectedDraft) return;
    reviewMsg = '';
    try {
      const r = await client.mutation(api.importDrafts.publishDraft, {
        draftId: selectedDraft._id,
        providerName,
        providerType,
        type: publishType as any,
      });
      reviewMsg = r.status === 'verified'
        ? `Published ✓ verified and public.`
        : `Published as unverified (hidden) — gaps: ${r.gaps.join(', ')}.`;
      selectedDraft = null;
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Publish failed.'; }
  }
  const openFlags = $derived(flags.data ?? []);
  async function resolveFlag(flagId: string, outcome: 'fixed' | 'no-issue' | 'escalated', staleLinked: boolean) {
    reviewMsg = '';
    try {
      const r = await client.mutation(api.curation.resolveReport, {
        flagId: flagId as any,
        outcome,
        note: resolveNotes[flagId] || undefined,
        staleLinkedClaims: staleLinked,
      });
      reviewMsg = r.effects.length > 0 ? `Resolved ✓ ${r.effects.join(' ')}` : `Resolved ✓ (${outcome}).`;
    } catch (e) { reviewMsg = e instanceof Error ? e.message : 'Resolve failed.'; }
  }
  let resolveNotes = $state<Record<string, string>>({});
  let checks = $state<Record<string, { link: boolean; deadline: boolean; contacts: boolean }>>({});
  let msg = $state('');
  let redirected = $state(false);
  type AdminView = 'review' | 'import' | 'evidence' | 'records';
  let activeView = $state<AdminView>('review');
  const reviewCount = $derived(openFlags.length + draftList.length + pendingDocs.length + pendingStories.length);
  function readableLabel(value: string) {
    return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  function closeDraft() {
    selectedDraft = null;
    corrections = {};
    dupes = [];
  }
  function fieldLabel(key: string) {
    const match = key.match(/^criterion:(\d+)$/);
    if (match) return `Eligibility requirement ${Number(match[1]) + 1}`;
    return readableLabel(key);
  }
  function sourceHost(url: string) {
    try { return new URL(url).hostname; } catch { return url; }
  }
  function check(id: string) { return checks[id] ?? { link: false, deadline: false, contacts: false }; }
  function toggle(id: string, k: 'link' | 'deadline' | 'contacts') {
    checks[id] = { ...check(id), [k]: !check(id)[k] };
  }
  async function publish(id: any) {
    const c = check(id);
    if (!c.link || !c.deadline || !c.contacts) { msg = 'Tick all three verify checks first.'; return; }
    try {
      await client.mutation(api.curation.publish, { opportunityId: id });
      msg = 'Published ✓ · Verified badge is live on the detail page.';
    } catch { msg = 'Publish failed — curator sign-in required.'; }
  }
  $effect(() => {
    // Non-curators (and signed-out users) never see this tool: bounce to app.
    if (browser && !redirected && gate.data && !gate.data.curator) {
      redirected = true;
      setTimeout(() => goto('/home'), 1800);
    }
  });
</script>
<svelte:head>
  <title>Curation | Backbone Africa</title>
</svelte:head>
<main class="phone">
  {#if gate.isLoading}
    <div class="topbar"><strong>Curation</strong><a href="/home">Back to app</a></div>
    <div class="card"><p class="meta">Checking access…</p></div>
  {:else if !gate.data?.authed}
    <div class="topbar"><strong>Curation</strong><a href="/home">Back to app</a></div>
    <div class="card empty">
      <h1 class="admin-heading">Curator sign-in required</h1>
      <p class="meta" style="margin:8px 0 0">This workspace is limited to the team that verifies sources and publishes opportunities.</p>
      <a href="/auth" class="btn btn-primary" style="text-decoration:none;margin-top:14px">Sign in</a>
      <a href="/home" class="btn btn-outline" style="text-decoration:none;margin-top:8px">Back to app</a>
    </div>
  {:else if !gate.data?.curator}
    <div class="topbar"><strong>Curation</strong><a href="/home">Back to app</a></div>
    <div class="card empty">
      <h1 class="admin-heading">You don’t have curator access</h1>
      <p class="meta" style="margin:8px 0 0">This workspace is only available to approved Backbone curators. You’ll return to the app shortly.</p>
      <a href="/home" class="btn btn-primary" style="text-decoration:none;margin-top:14px">Back to app</a>
    </div>
  {:else}
    <div class="topbar"><strong>Curation</strong><a href="/home">Back to app</a></div>
    {#if selectedDraft}
      {@const fields = fieldEntries(selectedDraft)}
      {@const decidedCount = fields.filter((entry) => decisionFor(entry.key)).length}
      <button class="admin-back" onclick={closeDraft}>← Back to review queue</button>
      {#if reviewMsg}<div class="admin-notice" role="status">{reviewMsg}</div>{/if}
      <div class="card">
        <p class="eyebrow" style="margin:0 0 2px">Draft review</p>
        <h1 class="admin-heading">Check every claim before publishing</h1>
        <p class="meta admin-source" style="margin:6px 0 0"><a href={selectedDraft.sourceUrl} target="_blank" rel="noreferrer">{selectedDraft.sourceUrl}</a>{#if selectedDraft.publishedBy} · published by {selectedDraft.publishedBy}{/if}</p>
        <div class="admin-actions"><span class="admin-status">{readableLabel(selectedDraft.captureStatus)}</span></div>
        <p class="meta" style="margin:8px 0 0">{decidedCount} of {fields.length} fields reviewed</p>
      </div>
      <div class="card">
        {#each fields as entry}
          {@const decided = decisionFor(entry.key)}
          <div class="admin-row">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <strong>{fieldLabel(entry.key)}</strong>
              <span class="admin-status">{readableLabel(entry.field?.status ?? 'missing')}</span>
              {#if decided}<span class="admin-status">{readableLabel(decided.decision)} · {decided.reviewer}</span>{/if}
            </div>
            {#if entry.family}<div class="meta" style="margin-top:2px">{readableLabel(entry.family)}{#if entry.role} · {readableLabel(entry.role)}{/if}</div>{/if}
            {#if entry.field?.value !== null && entry.field?.value !== undefined}<p style="margin:6px 0 0">Value: {entry.field.value}</p>{/if}
            {#if entry.field?.passage}
              <div class="meta" style="margin-top:6px">Source passage</div>
              <blockquote class="quote">{entry.field.passage}</blockquote>
            {/if}
            {#if decided?.decision === 'correct'}<p class="meta" style="margin:6px 0 0">Corrected: {decided.correctedValue}</p>{/if}
            <div class="admin-actions">
              <button class="chip" aria-pressed={decided?.decision === 'accept'} onclick={() => decide(entry.key, 'accept')}>Accept</button>
              <button class="chip" aria-pressed={decided?.decision === 'ambiguous'} onclick={() => decide(entry.key, 'ambiguous')}>Cannot verify</button>
              <button class="chip" aria-pressed={decided?.decision === 'reject'} onclick={() => decide(entry.key, 'reject')}>Reject</button>
            </div>
            <label class="admin-field"><span>Corrected value</span>
              <input class="input" bind:value={corrections[entry.key]} />
            </label>
            <div class="admin-actions" style="margin-top:6px">
              <button class="chip" aria-pressed={decided?.decision === 'correct'} onclick={() => decide(entry.key, 'correct')}>Save correction</button>
            </div>
          </div>
        {/each}
      </div>
      <div class="card">
        <h2 class="admin-card-title">Possible duplicate records</h2>
        {#if dupes.length === 0}<p class="admin-empty">No plausible existing records — nothing to merge.</p>{/if}
        {#each dupes as s}
          <div class="admin-row">
            <strong>{s.candidateName}</strong>
            <div class="meta" style="margin-top:2px">{readableLabel(s.relation)} · {Math.round(s.confidence * 100)}% match · {s.reason}</div>
            {#if s.relation === 'same' || s.relation === 'related' || s.relation === 'review'}
              <div class="admin-actions">
                <button class="chip" onclick={() => linkDupe(s.candidateId, 'same', s.candidateId)}>Same programme</button>
                <button class="chip" onclick={() => linkDupe(s.candidateId, 'related', s.candidateId)}>Related programme</button>
              </div>
              <label class="admin-field"><span>Cohort label</span>
                <input class="input" placeholder="e.g. 2026" bind:value={cohortLabels[s.candidateId]} />
              </label>
              <div class="admin-actions" style="margin-top:6px">
                <button class="chip" onclick={() => linkDupe(s.candidateId, 'cohort', s.candidateId)}>Same cohort</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="card">
        <h2 class="admin-card-title">Publish this opportunity</h2>
        <p class="meta" style="margin:4px 0 0">Publishing is blocked by unresolved or rejected fields. Confirm the provider details before continuing.</p>
        <div class="admin-grid">
          <label class="admin-field"><span>Provider name</span>
            <input class="input" bind:value={providerName} />
          </label>
          <label class="admin-field"><span>Provider type</span>
            <input class="input" bind:value={providerType} />
          </label>
          <label class="admin-field"><span>Opportunity type</span>
            <select class="input" bind:value={publishType}>
              {#each ['grant','loan','accelerator','incubator','fellowship','gov-program'] as t}<option value={t}>{t}</option>{/each}
            </select>
          </label>
        </div>
        <div class="admin-actions">
          <button class="chip admin-action-primary" onclick={publishDraft}>Publish opportunity</button>
        </div>
      </div>
    {:else}
      <div class="card admin-hero">
        <p class="eyebrow" style="margin:0 0 2px">Internal workspace</p>
        <h1 class="admin-heading">Review and publish with evidence</h1>
        <p class="meta" style="margin:6px 0 0">Work through one queue at a time. Nothing becomes public until a curator approves it.</p>
      </div>
      <nav class="admin-tabs" aria-label="Curation sections">
        <button class="admin-tab" aria-pressed={activeView === 'review'} onclick={() => (activeView = 'review')}>Review{#if reviewCount > 0}<span class="admin-badge">{reviewCount}</span>{/if}</button>
        <button class="admin-tab" aria-pressed={activeView === 'import'} onclick={() => (activeView = 'import')}>Import{#if suggestionList.length > 0}<span class="admin-badge">{suggestionList.length}</span>{/if}</button>
        <button class="admin-tab" aria-pressed={activeView === 'evidence'} onclick={() => (activeView = 'evidence')}>Evidence{#if conflictList.length > 0}<span class="admin-badge">{conflictList.length}</span>{/if}</button>
        <button class="admin-tab" aria-pressed={activeView === 'records'} onclick={() => (activeView = 'records')}>Records</button>
      </nav>
      {#if reviewMsg}<div class="admin-notice" role="status">{reviewMsg}</div>{/if}
      {#if activeView === 'review'}
        <div class="admin-section-head">
          <p class="eyebrow" style="margin:0">Work queue</p>
          <h2 class="admin-heading">Items needing a decision</h2>
          <p class="meta" style="margin:4px 0 0">Start with reports and drafts; document and story checks follow.</p>
        </div>
        <div class="card">
          <h3 class="admin-card-title">Open reports</h3>
          {#if openFlags.length === 0}<p class="admin-empty">No open reports.</p>{/if}
          {#each openFlags as f}
            <div class="admin-row">
              <strong>{f.opportunityTitle}</strong>
              <div class="admin-actions" style="margin-top:6px">
                <span class="admin-status">{readableLabel(f.category ?? f.reason)}</span>
                <span class="admin-status">{readableLabel(f.priority ?? 'queue')}</span>
                {#if f.routingConfidence}<span class="admin-status">{readableLabel(f.routingConfidence)} confidence</span>{/if}
                {#if (f.duplicateCount ?? 0) > 0}<span class="admin-status">{(f.duplicateCount ?? 0) + 1} reports</span>{/if}
              </div>
              {#if f.claimKey}<div class="meta" style="margin-top:6px">Linked fact: {f.claimKey}</div>{/if}
              {#if f.note}<div class="meta" style="margin-top:2px">“{f.note}”</div>{/if}
              <label class="admin-field"><span>Resolution note (optional)</span>
                <input class="input" bind:value={resolveNotes[f._id]} />
              </label>
              <div class="admin-actions">
                <button class="chip admin-action-primary" onclick={() => resolveFlag(f._id, 'fixed', true)}>Mark fixed + recheck</button>
                <button class="chip" onclick={() => resolveFlag(f._id, 'fixed', false)}>Mark fixed</button>
                <button class="chip" onclick={() => resolveFlag(f._id, 'no-issue', false)}>No issue</button>
                <button class="chip" onclick={() => resolveFlag(f._id, 'escalated', false)}>Escalate</button>
              </div>
            </div>
          {/each}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Imported drafts</h3>
          {#if draftList.length === 0}<p class="admin-empty">No imported drafts waiting for review.</p>{/if}
          {#each draftList as d}
            <div class="admin-row">
              <strong>{sourceHost(d.sourceUrl)}</strong>
              <div class="meta admin-source" style="margin-top:2px">{d.sourceUrl}</div>
              <div style="margin-top:6px"><span class="admin-status">{readableLabel(d.captureStatus)}</span>{#if d.captureStatus === 'captured'}<span class="meta"> · {d.unresolved} fields left</span>{/if}</div>
              <div class="admin-actions">
                <button class="chip admin-action-primary" onclick={() => openDraft(d._id)}>Review draft</button>
              </div>
            </div>
          {/each}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Documents to verify</h3>
          {#if pendingDocs.length === 0}<p class="admin-empty">No documents waiting for verification.</p>{/if}
          {#each pendingDocs as d}
            <div class="admin-row">
              <strong class="admin-source">{d.fileName}</strong>
              <div class="meta" style="margin-top:2px">{readableLabel(d.docType)} · {Math.round(d.sizeBytes / 1024)} KB</div>
              <div class="admin-actions">
                <button class="chip admin-action-primary" onclick={() => verifyDoc(d._id, true)}>Accept document</button>
                <button class="chip" onclick={() => verifyDoc(d._id, false)}>Return for changes</button>
              </div>
            </div>
          {/each}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Community stories</h3>
          {#if pendingStories.length === 0}<p class="admin-empty">No community stories waiting for review.</p>{/if}
          {#each pendingStories as s}
            <div class="admin-row">
              <strong>{s.opportunityTitle}</strong>
              <blockquote class="quote">“{s.story}”</blockquote>
              <div class="admin-actions">
                <button class="chip admin-action-primary" onclick={() => reviewStory(s._id, true)}>Publish story</button>
                <button class="chip" onclick={() => reviewStory(s._id, false)}>Reject</button>
              </div>
            </div>
          {/each}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Catalog publication checks</h3>
          <p class="meta" style="margin:4px 0 0">Confirm the source, deadline, and contact details before publishing an existing listing.</p>
          {#if data.length === 0}<p class="admin-empty">No listings to check.</p>{/if}
          {#each data.slice(0,8) as o}
            <div class="admin-row">
              <strong>{o.title}</strong>
              <div class="meta admin-source" style="margin-top:2px">{o.sourceUrl}</div>
              <div class="meta" style="margin-top:6px">{o.steps.length} application steps on record.</div>
              <ol class="meta" style="margin:4px 0;padding-left:18px">{#each o.steps as s}<li>{s.title}</li>{/each}</ol>
              <label style="display:flex;gap:8px;min-height:44px;align-items:center"><input type="checkbox" checked={check(o._id).link} onchange={() => toggle(o._id, 'link')} /> Official link works</label>
              <label style="display:flex;gap:8px;min-height:44px;align-items:center"><input type="checkbox" checked={check(o._id).deadline} onchange={() => toggle(o._id, 'deadline')} /> Deadline confirmed</label>
              <label style="display:flex;gap:8px;min-height:44px;align-items:center"><input type="checkbox" checked={check(o._id).contacts} onchange={() => toggle(o._id, 'contacts')} /> Contacts confirmed</label>
              <button class="btn btn-primary" style="margin-top:8px" onclick={() => publish(o._id)}>Publish listing</button>
            </div>
          {/each}
          {#if msg}<p class="meta" role="status" style="margin:10px 0 0">{msg}</p>{/if}
        </div>
      {:else if activeView === 'import'}
        <div class="admin-section-head">
          <p class="eyebrow" style="margin:0">Intake</p>
          <h2 class="admin-heading">Create evidence-linked drafts</h2>
          <p class="meta" style="margin:4px 0 0">Start from an official programme page or review a community-submitted link.</p>
        </div>
        <div class="card">
          <h3 class="admin-card-title">Import an official page</h3>
          <p class="meta" style="margin:4px 0 0">We save a source snapshot and propose a draft. A curator must review every field before publication.</p>
          <label class="admin-field"><span>Official programme URL</span>
            <input class="input" placeholder="https://official-site.example/programme" bind:value={importUrl} />
          </label>
          <div class="admin-actions">
            <button class="chip admin-action-primary" disabled={importing} onclick={importOfficialUrl}>{importing ? 'Capturing source…' : 'Create draft'}</button>
          </div>
          {#if importMsg}<p class="meta" style="margin:10px 0 0">{importMsg}</p>{/if}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Community-submitted links</h3>
          {#if suggestionList.length === 0}<p class="admin-empty">No suggested links waiting for review.</p>{/if}
          {#each suggestionList as s}
            <div class="admin-row">
              <div class="admin-source">{s.url}</div>
              <div class="admin-actions">
                <button class="chip admin-action-primary" onclick={() => promoteSuggestion(s._id, s.url)}>Create draft</button>
                <button class="chip" onclick={() => declineSuggestion(s._id)}>Decline</button>
              </div>
            </div>
          {/each}
        </div>
      {:else if activeView === 'evidence'}
        <div class="admin-section-head">
          <p class="eyebrow" style="margin:0">Source quality</p>
          <h2 class="admin-heading">Resolve conflicting evidence</h2>
          <p class="meta" style="margin:4px 0 0">Publication stays blocked until every contradiction has a curator decision.</p>
        </div>
        <div class="card">
          <h3 class="admin-card-title">Source conflicts</h3>
          {#if conflictList.length === 0}<p class="admin-empty">No unresolved source conflicts.</p>{/if}
          {#each conflictList as entry}
            <div class="admin-row">
              <strong>{entry.opportunityTitle}</strong>
              {#each entry.conflicts as c}
                <div style="margin-top:8px">
                  <div class="meta"><strong style="color:var(--fg)">{readableLabel(c.claimKey)}</strong> — sources disagree. Nothing here is chosen for you.</div>
                  {#each c.supported as s}
                    <div style="margin-top:8px">
                      <span class="admin-status">Supported source</span>
                      <div class="meta admin-source" style="margin-top:4px">{s.sourceUrl}</div>
                      {#if s.sourcePassage}<blockquote class="quote">“{s.sourcePassage}”</blockquote>{/if}
                      <div class="admin-actions">
                        <button class="chip" onclick={() => resolveRow(s._id, 'unsupported')}>Mark unsupported</button>
                      </div>
                    </div>
                  {/each}
                  {#each c.contradicted as s}
                    <div style="margin-top:8px">
                      <span class="admin-status">Contradicted source</span>
                      <div class="meta admin-source" style="margin-top:4px">{s.sourceUrl}</div>
                      {#if s.sourcePassage}<blockquote class="quote">“{s.sourcePassage}”</blockquote>{/if}
                      <div class="admin-actions">
                        <button class="chip" onclick={() => resolveRow(s._id, 'unsupported')}>Reject source</button>
                        <button class="chip" onclick={() => compareWithModel(c.claimKey, s.sourcePassage ?? '')}>Compare passages</button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/each}
          {#if compareMsg}<div class="admin-notice" role="status" style="margin:10px 0 0">{compareMsg}</div>{/if}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Record a contradiction</h3>
          <p class="meta" style="margin:4px 0 0">Use this when an official source disagrees with a claim already on the listing.</p>
          <div class="admin-grid">
            <label class="admin-field"><span>Opportunity</span>
              <select class="input" bind:value={contraOpp}>
                <option value="">Select an opportunity…</option>
                {#each data as o}<option value={o._id}>{o.title}</option>{/each}
              </select>
            </label>
            <label class="admin-field"><span>Claim key</span>
              <input class="input" bind:value={contraClaim} />
            </label>
            <label class="admin-field"><span>Contradicting source URL</span>
              <input class="input" bind:value={contraSource} />
            </label>
            <label class="admin-field"><span>Source passage</span>
              <input class="input" bind:value={contraPassage} />
            </label>
          </div>
          <div class="admin-actions">
            <button class="chip admin-action-primary" onclick={recordContradiction}>Block publication and record</button>
          </div>
        </div>
      {:else}
        <div class="admin-section-head">
          <p class="eyebrow" style="margin:0">Entity records</p>
          <h2 class="admin-heading">Prevent duplicate providers and programmes</h2>
          <p class="meta" style="margin:4px 0 0">Compare before creating a new record. Links preserve both sources and can be reverted.</p>
        </div>
        <div class="card">
          <h3 class="admin-card-title">Check a provider</h3>
          <div class="admin-grid">
            <label class="admin-field"><span>Provider name</span>
              <input class="input" bind:value={providerNameInput} />
            </label>
            <label class="admin-field"><span>Official website (optional)</span>
              <input class="input" bind:value={providerLinkInput} />
            </label>
          </div>
          <div class="admin-actions">
            <button class="chip admin-action-primary" onclick={checkProvider}>Find possible matches</button>
          </div>
          {#each providerDupes as s}
            <div class="admin-row">
              <strong>{s.candidateName}</strong>
              <div class="meta" style="margin-top:2px">{readableLabel(s.relation)} · {Math.round(s.confidence * 100)}% match · {s.reason}</div>
              {#if s.relation === 'same' || s.relation === 'related'}
                <div class="admin-actions">
                  <button class="chip" onclick={() => saveAndLinkProvider(s.candidateId, 'same')}>Save as same provider</button>
                  <button class="chip" onclick={() => saveAndLinkProvider(s.candidateId, 'related')}>Save as related provider</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        <div class="card">
          <h3 class="admin-card-title">Link history</h3>
          {#if linkList.length === 0}<p class="admin-empty">No provider or programme links yet.</p>{/if}
          {#each linkList as l}
            <div class="admin-row">
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <span class="admin-status">{readableLabel(l.kind)} · {readableLabel(l.relation)}{#if l.cohortLabel} · {l.cohortLabel}{/if}</span>
                {#if l.status !== 'active'}<span class="admin-status">Reverted</span>{/if}
              </div>
              <strong style="display:block;margin-top:4px">{l.fromName} → {l.toName}</strong>
              <div class="meta" style="margin-top:2px">Decided by {l.decidedBy}</div>
              {#if l.status === 'active'}
                <div class="admin-actions"><button class="chip" onclick={() => revertLink(l._id)}>Revert link</button></div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</main>
<style>
  .admin-hero{margin-top:12px}
  .admin-heading{font-family:var(--font-display);font-size:22px;line-height:1.25;letter-spacing:-.02em;margin:0}
  .admin-section-head{margin:18px 14px 4px}
  .admin-section-head .admin-heading{font-size:20px}
  .admin-tabs{display:flex;gap:6px;overflow-x:auto;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:46px;z-index:9}
  .admin-tab{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:10px 16px;border-radius:999px;border:1.5px solid var(--border);background:var(--surface);font-weight:700;font-size:13.5px;color:var(--fg);cursor:pointer;white-space:nowrap;flex:0 0 auto}
  .admin-tab[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
  .admin-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;font-weight:800;display:inline-grid;place-items:center}
  .admin-tab[aria-pressed="true"] .admin-badge{background:#fff;color:var(--accent)}
  .admin-card-title{font-family:var(--font-display);font-size:16px;letter-spacing:-.01em;margin:0}
  .admin-row{border-top:1px solid var(--border);margin-top:10px;padding-top:10px}
  .admin-card-title + .admin-row,.admin-empty + .admin-row{border-top:0;margin-top:0;padding-top:0}
  .admin-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  .admin-action-primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .admin-action-primary:hover{background:var(--accent-2)}
  .admin-field{display:block;margin-top:10px}
  .admin-field > span{display:block;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:color-mix(in srgb,var(--muted),var(--fg) 18%);margin-bottom:4px}
  .admin-status{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;background:var(--bg);border:1px solid var(--border);color:color-mix(in srgb,var(--muted),var(--fg) 18%);font-size:11px;font-weight:750;letter-spacing:.04em;text-transform:uppercase}
  .admin-notice{margin:10px 14px;padding:10px 14px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid var(--border);font-size:13.5px}
  .admin-source{overflow-wrap:anywhere}
  .admin-grid{display:grid;gap:4px;margin-top:4px}
  .admin-grid .admin-field{margin-top:6px}
  .admin-back{display:inline-flex;align-items:center;margin:8px 14px 0;padding:0 4px;min-height:44px;background:none;border:0;color:var(--accent);font-weight:750;font-size:14px;cursor:pointer}
  .admin-empty{margin:8px 0 0;font-size:13px}
  .phone :global(.meta),.admin-empty{color:color-mix(in srgb,var(--muted),var(--fg) 18%)}
</style>
