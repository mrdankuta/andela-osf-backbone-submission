import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			srcDir: 'src',
			mode: 'production',
			strategies: 'generateSW',
			registerType: 'autoUpdate',
			manifest: {
				name: 'Backbone Africa',
				short_name: 'Backbone',
				description: 'Verified opportunities for African MSMEs, made actionable.',
				theme_color: '#0E3B2E',
				background_color: '#F8F7F4',
				display: 'standalone',
				start_url: '/',
				icons: [
					{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
				]
			},
			workbox: {
				globPatterns: ['client/**/*.{js,css,svg}', 'prerendered/**/*.html'],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/.*\.convex\.cloud\/.*/i,
						handler: 'NetworkFirst',
						options: { cacheName: 'convex-api', networkTimeoutSeconds: 5 }
					}
				]
			},
			devOptions: { enabled: false }
		})
	]
});
