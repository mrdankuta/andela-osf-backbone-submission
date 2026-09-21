<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
  import { authClient } from '$lib/auth-client';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  import Section from '$lib/Section.svelte';
  function owner() {
    if (!browser) return 'server';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  const key = owner();
  const client = useConvexClient();
  const auth = useAuth();
  const res = useQuery(api.profiles.get, () => ({ ownerKey: key }));
  const grantsResult = useQuery(api.adviser.myGrants, () => ({}));
  const grants = $derived(grantsResult.data ?? []);
  let adviserLabel = $state('');
  let grantScopes = $state<string[]>(['plan:view']);
  let inviteCode = $state('');
  let sharingMsg = $state('');
  const SCOPE_LABELS: Record<string, string> = {
    'plan:view': 'View plans',
    'plan:update': 'Update plans',
    'answers:confirm': 'Answer questions',
    'documents:view': 'View documents',
  };
  function toggleScope(s: string) {
    grantScopes = grantScopes.includes(s) ? grantScopes.filter((x) => x !== s) : [...grantScopes, s];
  }
  async function createCode() {
    sharingMsg = '';
    try {
      const r = await client.mutation(api.adviser.createInvite, { label: adviserLabel.trim(), scopes: grantScopes as never });
      inviteCode = r.code;
      adviserLabel = '';
      sharingMsg = 'Share this code with your adviser — it expires in 7 days.';
    } catch (e) { sharingMsg = e instanceof Error ? e.message : 'Invite failed.'; }
  }
  async function revoke(grantId: string) {
    try {
      await client.mutation(api.adviser.revokeGrant, { grantId: grantId as never });
      sharingMsg = 'Access revoked immediately.';
    } catch (e) { sharingMsg = e instanceof Error ? e.message : 'Revoke failed.'; }
  }
  const invResult = useQuery(api.dataControls.inventory, () => ({}));
  const inv = $derived(invResult.data);
  let deleteConfirm = $state('');
  let dataMsg = $state('');
  let working = $state(false);
  async function exportData() {
    if (working) return;
    working = true;
    dataMsg = '';
    try {
      const data = await client.query(api.dataControls.exportMyData, {});
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'backbone-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
      dataMsg = 'Exported ✓ a portable copy is downloading.';
    } catch (e) { dataMsg = e instanceof Error ? e.message : 'Export failed.'; }
    working = false;
  }
  async function deleteData() {
    if (working) return;
    working = true;
    dataMsg = '';
    try {
      const r = await client.mutation(api.dataControls.deleteMyData, { confirmation: deleteConfirm });
      dataMsg = `Deleted ✓ profile, ${r.deleted.plans} plan${r.deleted.plans === 1 ? '' : 's'}, ${r.deleted.conversations} conversation${r.deleted.conversations === 1 ? '' : 's'}. Shared listings are untouched.`;
      deleteConfirm = '';
    } catch (e) { dataMsg = e instanceof Error ? e.message : 'Delete failed.'; }
    working = false;
  }
  const p = $derived(res.data);
  let firstName = $state(''), region = $state(''), businessStage = $state(''), staffSize = $state<number | undefined>(undefined);
  let reminders = $state([7, 3]), lowData = $state(false), language = $state('English');
  let savedMsg = $state('');
  $effect(() => {
    if (p) {
      firstName = p.firstName ?? ''; region = p.state ?? '';
      businessStage = p.businessStage ?? ''; staffSize = p.staffSize;
      reminders = p.reminderDays ?? [7, 3]; lowData = p.lowData ?? false; language = p.language ?? 'English';
    }
  });
  function toggleDay(d: number) { reminders = reminders.includes(d) ? reminders.filter((x: number) => x !== d) : [...reminders, d]; }
  let email = $state('');
  let planUpdates = $state(true);
  $effect(() => {
    if (p) {
      if (p.email !== undefined) email = p.email;
      if (p.planUpdatesOptIn !== undefined) planUpdates = p.planUpdatesOptIn;
    }
  });
  async function save() {
    const clearFields: Array<'firstName' | 'state' | 'businessStage' | 'staffSize'> = [];
    if (!firstName) clearFields.push('firstName');
    if (!region) clearFields.push('state');
    if (!businessStage) clearFields.push('businessStage');
    if (staffSize === undefined) clearFields.push('staffSize');
    await client.mutation(api.profiles.save, { ownerKey: key, firstName: firstName || undefined, state: region || undefined, businessStage: businessStage || undefined, staffSize, reminderDays: reminders, lowData, language, clearFields, source: 'profile', email: email || undefined, planUpdatesOptIn: planUpdates });
    savedMsg = 'Saved ✓';
    setTimeout(()=>savedMsg='', 2000);
  }
</script>
<div class="phone">
  <div class="topbar"><div><strong>Profile & settings</strong><div class="meta" style="font-size:12px">{auth.isAuthenticated ? 'Signed in · backed up' : 'On this device · add account to back up'}</div></div><a href="/auth" class="chip" style="text-decoration:none;min-height:36px">{auth.isAuthenticated ? 'Account ✓' : 'Add account'}</a></div>

  {#if !auth.isAuthenticated}
    <div class="card" style="background:linear-gradient(135deg,#0E3B2E,#1A5E42);color:#fff;border:0">
      <strong style="color:#fff">Save your progress</strong>
      <div class="meta" style="color:rgba(255,255,255,.9);margin-top:4px">Create a free account to keep your Track if you change phones and get deadline reminders by email. Browsing always works without it.</div>
      <a href="/auth" class="btn" style="background:#fff;color:var(--accent);text-decoration:none;margin-top:12px">Create free account</a>
      <div class="meta" style="color:rgba(255,255,255,.75);margin-top:6px;text-align:center">Takes 30 seconds · No spam</div>
    </div>
  {:else}
    <div class="banner ok">✓ Signed in — your profile & reminders are backed up. <a href="/track">My Applications</a> stays with your account.</div>
  {/if}

  <Section eyebrow="About you" title={firstName || 'Your profile'} summary={`${region || 'Any state'} · ${businessStage || 'Any stage'}`} open>
    <p class="meta" style="margin:0 0 10px">{staffSize !== undefined ? `${staffSize} staff` : 'Staff not set'} · Used to rank <a href="/home">Discover</a>.</p>
    <input class="input" placeholder="First name" bind:value={firstName} aria-label="First name" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <select class="input" bind:value={region} aria-label="State"><option value="">Not set</option>{#each ['Lagos','Abuja FCT','Kano','Rivers','Oyo','Kaduna','Abia','Ogun','Kwara','Gombe','Other'] as s}<option>{s}</option>{/each}</select>
      <select class="input" bind:value={businessStage} aria-label="Stage"><option value="">Not set</option><option>Starting</option><option>Growing</option><option>Scaling</option></select>
    </div>
    <label class="meta" style="display:block;margin-top:12px">Staff size<input type="number" class="input" min="0" max="500" placeholder="Not set" value={staffSize ?? ''} oninput={(e) => { const v = e.currentTarget.value; staffSize = v === '' ? undefined : Number.parseInt(v, 10); }} aria-label="Staff size" /></label>
    <div class="meta" style="margin-top:6px">Update anytime — matches refresh instantly.</div>
  </Section>
  <Section eyebrow="Never miss out" title="Reminders" summary={planUpdates && reminders.length > 0 ? `${reminders.length} alert${reminders.length === 1 ? '' : 's'}` : 'Off'}>
    <div class="meta" style="margin:0 0 8px">{auth.isAuthenticated ? 'Emailed to your account.' : 'On-device for now — add account to get email too.'}</div>
    <label style="display:flex;gap:10px;min-height:44px;align-items:center;font-weight:600"><input type="checkbox" bind:checked={planUpdates} /> Email me readiness & deadline updates</label>
    <label class="meta" style="display:block;font-weight:700">Email<input class="input" style="margin-top:6px" type="email" placeholder="you@example.org" bind:value={email} aria-label="Email for updates" /></label>
    {#each [7, 3, 1] as d}<label style="display:flex;gap:10px;min-height:44px;align-items:center;font-weight:600"><input type="checkbox" checked={reminders.includes(d)} onchange={() => toggleDay(d)} /> {d} days before deadline</label>{/each}
    <p class="meta" style="margin:4px 0 0">Uncheck email updates or clear all days to opt out entirely. Messages are short, name the next step, and link the official portal.</p>
  </Section>
  <Section eyebrow="Get help" title="Adviser access" summary={`${grants.filter((g) => g.status === 'active').length} active`}>
    {#if !auth.isAuthenticated}
      <p class="meta" style="margin:4px 0 0">Sign in to invite a mentor or adviser. They see only what you grant — and you can revoke anytime.</p>
    {:else}
      <p class="meta" style="margin:4px 0 8px">Invite one helper with a code. They never own your data.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="input" style="flex:1;min-width:140px" placeholder="Adviser name, e.g. SMEDAN mentor" bind:value={adviserLabel} aria-label="Adviser label" />
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        {#each Object.entries(SCOPE_LABELS) as [value, label]}
          <button class="chip" aria-pressed={grantScopes.includes(value)} onclick={() => toggleScope(value)}>{label}</button>
        {/each}
        <button class="chip" style="background:var(--accent);color:#fff;border-color:var(--accent)" onclick={createCode}>Create invite code</button>
      </div>
      {#if inviteCode}<p class="meta" style="margin-top:8px">Code: <strong style="color:var(--fg);font-size:18px;letter-spacing:.1em">{inviteCode}</strong></p>{/if}
      {#each grants as g}
        <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
          <p class="meta" style="margin:0"><strong style="color:var(--fg)">{g.label}</strong> [{g.status}] · {g.scopes.join(', ')}</p>
          {#if g.status === 'active'}<button class="chip" style="margin-top:6px" onclick={() => revoke(g._id)}>Revoke now</button>{/if}
        </div>
      {/each}
      {#if sharingMsg}<p class="meta" style="margin-top:8px">{sharingMsg}</p>{/if}
    {/if}
  </Section>
  <Section eyebrow="Your rights" title="Your data" summary={auth.isAuthenticated && inv ? `${inv.plans.length} plans · ${inv.conversations.length} chats` : 'On this device'}>
    {#if !auth.isAuthenticated}
      <p class="meta" style="margin:4px 0 0">Your profile and plans live on this device. <a href="/auth">Sign in</a> to back them up, export, or delete them.</p>
    {:else if invResult.isLoading}
      <p class="meta" style="margin:4px 0 0">Loading…</p>
    {:else if invResult.error || !inv}
      <p class="meta" style="margin:4px 0 0">Could not load your data summary.</p>
    {:else}
      <p class="meta" style="margin:4px 0 0">Backbone holds: {inv.profileFields.length} profile field{inv.profileFields.length === 1 ? '' : 's'}, {inv.plans.length} plan{inv.plans.length === 1 ? '' : 's'}, {inv.conversations.length} conversation{inv.conversations.length === 1 ? '' : 's'}. Shared listings are never yours to delete.</p>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-outline" disabled={working} onclick={exportData}>Export my data ↓</button>
      </div>
      <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
        <strong>Permanently delete everything</strong>
        <p class="meta" style="margin:4px 0 8px">Removes your profile, plans, and conversations. Cannot be undone. Type DELETE to confirm.</p>
        <div style="display:flex;gap:8px">
          <input class="input" style="flex:1" placeholder="Type DELETE" bind:value={deleteConfirm} aria-label="Delete confirmation" />
          <button class="btn btn-primary" disabled={working} onclick={deleteData}>Delete</button>
        </div>
      </div>
      {#if dataMsg}<p class="meta" style="margin-top:8px">{dataMsg}</p>{/if}
    {/if}
  </Section>
  <Section eyebrow="Comfort" title="Display" summary={`${language}${lowData ? ' · low-data' : ''}`}>
    <label style="display:flex;gap:10px;min-height:44px;align-items:center;font-weight:600"><input type="checkbox" bind:checked={lowData} /> Low-data mode (text-first)</label>
    <div class="meta" style="margin-left:28px;margin-top:-8px;margin-bottom:10px">Hides images & step chips on Track for slower connections.</div>
    <label class="meta" style="font-weight:700">Language default<select class="input" style="margin-top:6px" bind:value={language}><option>English</option><option>Plain English</option><option>Pidgin</option><option>Hausa</option><option>Yoruba</option><option>Igbo</option></select></label>
  </Section>
  <div class="card" style="background:var(--bg);border-style:dashed">
    <p class="meta" style="margin:0">🔒 Your profile stays on your device and your private account. We never sell your data. Every listing shows its source link + last-checked date — <a href="/home?view=all">see verified listings</a>.</p>
    <div class="meta" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <a href="/home" class="chip" style="text-decoration:none">Discover</a>
      <a href="/home?view=all" class="chip" style="text-decoration:none">Browse all</a>
      <a href="/track" class="chip" style="text-decoration:none">My Applications</a>
    </div>
    <button class="btn btn-primary" style="margin-top:14px" onclick={save}>Save settings</button>
    {#if savedMsg}<p class="meta" style="margin-top:8px;color:var(--success);font-weight:700">{savedMsg}</p>{/if}
    {#if auth.isAuthenticated}<button class="btn btn-outline" style="margin-top:8px" onclick={() => authClient.signOut()}>Log out</button>{/if}
  </div>
  <Tabbar active="profile" />
</div>
