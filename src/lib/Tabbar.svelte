<script lang="ts">
  import { api } from '$convex/_generated/api';
  import { useQuery } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';

  let { active }: { active: 'discover' | 'apply' | 'assistant' | 'profile' } = $props();

  function device() {
    if (!browser) return 'none';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  // Badge teaches that saves accumulate somewhere: Apply shows live count.
  const rows = useQuery(api.track.list, () => ({ deviceId: device() }));
  const count = $derived(rows.data?.length ?? 0);
</script>

<nav class="tabbar" aria-label="Primary">
  <a class="tab" aria-current={active === 'discover' ? 'page' : undefined} href="/home"><span class="i">◎</span>Discover</a>
  <a class="tab" aria-current={active === 'apply' ? 'page' : undefined} href="/track"><span class="i">✓</span>My Applications{#if count > 0}<span class="badge">{count > 9 ? '9+' : count}</span>{/if}</a>
  <a class="tab" aria-current={active === 'assistant' ? 'page' : undefined} href="/assistant"><span class="i">✦</span>Assistant</a>
  <a class="tab" aria-current={active === 'profile' ? 'page' : undefined} href="/profile"><span class="i">◯</span>Profile</a>
</nav>
