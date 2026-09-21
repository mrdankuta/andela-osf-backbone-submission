import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Web default (Cloudflare Pages) stays untouched.
// Tauri native shells need a static SPA bundle: TAURI_BUILD=1 bun run build:tauri
const useTauri = process.env.TAURI_BUILD === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
    // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
    // See https://svelte.dev/docs/kit/adapters for more information about adapters.
    adapter: useTauri
      ? adapterStatic({ pages: 'build', assets: 'build', fallback: 'index.html', strict: false })
      : adapterCloudflare(),
    alias: {
      $convex: './src/convex'
    }
  }
};

export default config;
