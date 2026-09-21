<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useConvexClient } from '@mmailaender/convex-svelte';
  import { authClient } from '$lib/auth-client';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  import { browser } from '$app/environment';
  const client = useConvexClient();
  const auth = useAuth();
  let mode = $state<'in' | 'up'>('in');
  let name = $state(''), email = $state(''), password = $state('');
  let err = $state('');
  async function submit(e: Event) {
    e.preventDefault(); err = '';
    try {
      if (mode === 'in') await authClient.signIn.email({ email, password });
      else await authClient.signUp.email({ name, email, password });
      window.location.href = '/home';
    } catch (e: unknown) { err = e instanceof Error ? e.message : 'Auth failed'; }
  }
  async function out() { await authClient.signOut(); }
  let backupMsg = $state('');
  let backingUp = $state(false);
  function device() {
    if (!browser) return '';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  async function backup() {
    if (backingUp) return;
    backingUp = true;
    backupMsg = 'Backing up…';
    try {
      const r = await client.mutation(api.profiles.claimDeviceData, { deviceId: device() });
      backupMsg = !r.profileMigrated && r.plansMigrated === 0 && r.plansMerged === 0
        ? 'Nothing new — this device is already backed up.'
        : `Backed up ✓${r.profileMigrated ? ' profile' : ''}${r.plansMigrated > 0 ? ` · ${r.plansMigrated} plan${r.plansMigrated === 1 ? '' : 's'} moved` : ''}${r.plansMerged > 0 ? ` · ${r.plansMerged} merged` : ''}. Visible on all your devices.`;
    } catch (e) { backupMsg = e instanceof Error ? e.message : 'Backup failed.'; }
    backingUp = false;
  }
</script>
<div class="phone">
  <div class="topbar"><a href="/" style="text-decoration:none;font-weight:700">← Home</a><strong>{mode === 'in' ? 'Sign in' : 'Create account'}</strong><span style="width:48px"></span></div>

  <div class="card" style="background:var(--bg);border-style:dashed">
    <p class="eyebrow">When do you need an account?</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="card" style="margin:0;padding:12px"><div style="font-weight:800">Without account</div><div class="meta">Browse ✓ · Personalised matches ✓ · Save & track on this device ✓ · Works offline ✓</div></div>
      <div class="card" style="margin:0;padding:12px;border-color:var(--accent);background:#EAF2EC"><div style="font-weight:800;color:var(--accent)">With free account</div><div class="meta">Keep Track if you change phones · Deadline emails · Sync across devices</div></div>
    </div>
    <p class="meta" style="margin-top:10px">You can start anonymous and add an account later — we’ll keep your applications. <a href="/home?view=all">Continue browsing without signing in →</a></p>
  </div>

  <div class="card">
    {#if auth.isAuthenticated}
      <div class="banner ok">✓ Signed in. Your Track is backed up.</div>
      <button class="btn btn-primary" style="margin-top:10px" disabled={backingUp} onclick={backup}>{backingUp ? 'Backing up…' : 'Back up this device →'}</button>
      {#if backupMsg}<p class="meta" style="margin-top:8px">{backupMsg}</p>{/if}
      <p><a class="btn btn-primary" style="text-decoration:none" href="/home">Continue to Discover →</a></p>
      <a href="/track" class="btn btn-outline" style="text-decoration:none">Go to My Applications</a>
      <button class="btn btn-ghost" style="margin-top:8px" onclick={out}>Sign out</button>
    {:else}
      <form onsubmit={submit} style="display:flex;flex-direction:column;gap:12px">
        {#if mode === 'up'}<label class="meta" style="font-weight:700">Name<input class="input" style="margin-top:6px" placeholder="Adaeze" bind:value={name} required /></label>{/if}
        <label class="meta" style="font-weight:700">Email<input class="input" style="margin-top:6px" type="email" placeholder="ada@business.ng" bind:value={email} required /></label>
        <label class="meta" style="font-weight:700">Password<input class="input" style="margin-top:6px" type="password" placeholder="8+ characters" bind:value={password} required minlength={8} /></label>
        {#if err}<p class="meta" style="color:var(--danger);font-weight:700">{err}</p>{/if}
        <button class="btn btn-primary" type="submit">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button class="btn btn-ghost" style="margin-top:10px" onclick={() => (mode = mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? "No account? Create one" : 'Have an account? Sign in'}
      </button>
      <p class="meta" style="text-align:center;margin-top:8px">Free · Takes 30 seconds · No spam · <a href="/profile">Back to profile</a></p>
    {/if}
  </div>
</div>
