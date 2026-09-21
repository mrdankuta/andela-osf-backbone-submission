<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '@fontsource-variable/bricolage-grotesque';
	import '@fontsource-variable/karla';
	import '../app.css';

  import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte'; 
  import { authClient } from '$lib/auth-client';
  import { browser } from '$app/environment';

  createSvelteAuthClient({ authClient }); 

	const { children } = $props();
	let online = $state(browser ? navigator.onLine : true);
	let savedAt = $state(browser ? localStorage.getItem('ba-saved-at') : null);
	$effect(() => {
		if (!browser) return;
		const stamp = () => { const v = new Date().toLocaleDateString(); localStorage.setItem('ba-saved-at', v); savedAt = v; };
		window.addEventListener('online', () => { online = true; stamp(); });
		window.addEventListener('offline', () => { online = false; });
		stamp();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
{#if !online}<div style="position:sticky;bottom:0;background:#fdf0d5;border-top:1px solid var(--border);padding:8px 14px;font-size:13px;text-align:center">Offline · Showing saved{savedAt ? ` from ${savedAt}` : ''}. Saves and ticks will sync.</div>{/if}
