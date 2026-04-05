# Play Books Gaze Highlighter

A browser extension built with WXT that highlights the sentence you are reading in Google Play Books using WebGazer eye tracking.

## What It Does

- Tracks gaze points with WebGazer and highlights the matching sentence.
- Falls back to mouse position when gaze predictions are stale or unavailable.
- Runs in all frames on Play Books pages and syncs gaze points across iframes.
- Supports calibration by click samples before gaze highlighting is enabled.
- Detects head tilt swings to trigger page turns (next/previous).
- Shows a debug HUD in top frame mode to help with setup and calibration.

## Tech Stack

- WXT
- TypeScript
- WebGazer
- Playwright (integration tests)

## Requirements

- Node.js 18+
- npm
- Chromium-based browser for integration tests
- Camera access allowed for Play Books domains

## Installation

```bash
npm install
```

## Development

Start extension dev mode:

```bash
npm run dev
```

Start dev mode and auto-open a Play Books reader URL:

```bash
npm run dev:script
```

Run in Firefox dev mode:

```bash
npm run dev:firefox
```

## Build

Build Chromium output:

```bash
npm run build
```

Build Firefox output:

```bash
npm run build:firefox
```

Create zip package:

```bash
npm run zip
```

Create Firefox zip package:

```bash
npm run zip:firefox
```

## Type Check

```bash
npm run compile
```

## Integration Tests

Install Playwright browser (one-time):

```bash
npm run test:integration:install
```

Run integration tests:

```bash
npm run test:integration
```

Notes:

- Integration tests expect built extension output at `.output/chrome-mv3`.
- The test launches a persistent Chromium context and validates `popup.html` content.

## How To Use

1. Load the extension in development mode (`npm run dev`) or from build output.
2. Open a Google Play Books reader page.
3. Allow camera access when prompted.
4. Click around the reading area to calibrate (12 clicks required).
5. Keep your face centered for stable gaze predictions.
6. Read normally and the active sentence will be highlighted.

## Calibration and Controls

- Calibration requires 12 click samples before gaze tracking is used.
- Press `Shift+R` to reset calibration and clear model data.
- If gaze predictions are delayed, camera assist UI is enabled automatically.
- Mouse fallback remains available when gaze is stale or unavailable.

## Page Turning by Head Tilt

The extension measures face roll (eye landmark angle) and triggers page turns when a fast tilt swing is detected:

- Tilt one direction strongly to go to the next page.
- Tilt the opposite direction strongly to go to the previous page.
- A debounce is applied to avoid repeated turns.

## Permissions and Scope

Manifest permissions:

- `storage`

Host permissions:

- `https://play.google.com/*`
- `https://books.googleusercontent.com/*`

The content script runs in the main world and all frames on those hosts.

## Project Structure

```text
entrypoints/
  background.ts           # Dev helper tab open logic in development
  content.ts              # Content script registration
  content/
    main.ts               # Orchestrates gaze, calibration, fallback, messaging
    sentences.ts          # Sentence collection and point-to-sentence mapping
    ui.ts                 # Highlight styles, overlay, debug HUD/cursor
    webgazer.ts           # WebGazer setup and runtime guards
    pageTurn.ts           # Head tilt detection and page-turn triggering
  popup/
    main.ts               # Popup UI content
```

## Troubleshooting

- No gaze highlight appears:
  - Confirm camera permission is granted for Play Books pages.
  - Complete calibration clicks (12 points).
  - Check the debug HUD for calibration/prediction status.
- Gaze is unstable:
  - Improve lighting and keep your face centered.
  - Stay about an arm's length from the screen.
- Only mouse fallback is active:
  - WebGazer may not have initialized in this runtime; reload page/extension.
  - Reset with `Shift+R` and recalibrate.

## License

No license file is currently included in this repository.
