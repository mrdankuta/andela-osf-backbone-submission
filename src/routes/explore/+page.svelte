<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  // /explore is folded into Discover (?view=all). This route stays as a
  // redirect so old links and bookmarks keep working.
  $effect(() => {
    if (browser) goto('/home?view=all', { replaceState: true });
  });
</script>
<div class="phone">
  <div class="card"><p class="meta">Taking you to Discover… <a href="/home?view=all">Continue →</a></p></div>
</div>
