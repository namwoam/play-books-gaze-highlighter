import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

const faceMeshShimPath = fileURLToPath(
	new URL('./shims/mediapipe-face-mesh.ts', import.meta.url),
);

// See https://wxt.dev/api/config.html
export default defineConfig({
	vite: () => ({
		resolve: {
			alias: [{ find: /^@mediapipe\/face_mesh$/, replacement: faceMeshShimPath }],
		},
	}),
	manifest: {
		name: 'Play Books Gaze Highlighter',
		description:
			'Auto-highlight Google Play Books sentences using WebGazer eye tracking.',
		permissions: ['storage'],
		host_permissions: [
			'https://play.google.com/*',
			'https://books.googleusercontent.com/*',
		],
	},
});
