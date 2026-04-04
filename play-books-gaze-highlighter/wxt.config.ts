import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
	manifest: {
		name: 'Play Books Gaze Highlighter',
		description:
			'Auto-highlight Google Play Books sentences using WebGazer eye tracking.',
		permissions: ['storage'],
		host_permissions: ['https://play.google.com/*'],
	},
});
