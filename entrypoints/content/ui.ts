import {
  ACTIVE_SENTENCE_CLASS,
  DEBUG_CURSOR_HIDE_MS,
  DEBUG_CURSOR_ID,
  DEBUG_HUD_ID,
  HIGHLIGHT_NAME,
  OVERLAY_ID,
  STYLE_ID,
} from './constants';

type CreateUiOptions = {
  showDebugUi: boolean;
  onGazeCursorMove: (x: number, y: number) => void;
};

export type UiController = {
  install: () => void;
  updateDebugHud: (message: string) => void;
  updateDebugCursor: (x: number, y: number, source: 'gaze' | 'mouse') => void;
  setOverlayRect: (rect: DOMRect) => void;
};

export function createUiController(options: CreateUiOptions): UiController {
  let overlay: HTMLDivElement | null = null;
  let cursorHideTimer: number | null = null;

  const install = () => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background: rgba(255, 230, 135, 0.85);
        border-radius: 6px;
      }

      .${ACTIVE_SENTENCE_CLASS} {
        background: rgba(255, 230, 135, 0.85);
        border-radius: 6px;
        font-size: 1.20em;
      }

      #${OVERLAY_ID} {
        position: absolute;
        z-index: 2147483646;
        pointer-events: none;
        border-radius: 6px;
        background: rgba(255, 230, 135, 0.55);
        box-shadow: 0 0 0 1px rgba(214, 153, 37, 0.45);
        transition: all 90ms ease-out;
        display: none;
      }

      #${DEBUG_HUD_ID} {
        position: fixed;
        right: 10px;
        top: 10px;
        z-index: 2147483647;
        pointer-events: none;
        background: rgba(16, 24, 40, 0.9);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 8px;
        padding: 8px 10px;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        max-width: 280px;
        white-space: pre-wrap;
      }

      #${DEBUG_CURSOR_ID} {
        position: fixed;
        width: 12px;
        height: 12px;
        left: -9999px;
        top: -9999px;
        display: none;
        border-radius: 999px;
        border: 2px solid #fff;
        background: #ef4444;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
        transition: left 70ms linear, top 70ms linear, background 120ms ease;
      }
    `;
    document.head.append(style);

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    document.body.append(overlay);

    const debugCursor = document.createElement('div');
    debugCursor.id = DEBUG_CURSOR_ID;
    document.body.append(debugCursor);

    if (!options.showDebugUi) {
      return;
    }

    const debugHud = document.createElement('div');
    debugHud.id = DEBUG_HUD_ID;
    debugHud.textContent = 'Initializing...';
    document.body.append(debugHud);
  };

  const updateDebugHud = (message: string) => {
    if (!options.showDebugUi) {
      return;
    }

    const debugHud = document.getElementById(DEBUG_HUD_ID);
    if (!debugHud) {
      return;
    }
    debugHud.textContent = `[WebGazer]\n${message}`;
  };

  const updateDebugCursor = (x: number, y: number, source: 'gaze' | 'mouse') => {
    const debugCursor = document.getElementById(DEBUG_CURSOR_ID);
    if (!debugCursor) {
      return;
    }

    debugCursor.style.display = 'block';
    debugCursor.style.left = `${x - 6}px`;
    debugCursor.style.top = `${y - 6}px`;
    debugCursor.style.background = source === 'gaze' ? '#ef4444' : '#f59e0b';

    if (source === 'gaze') {
      options.onGazeCursorMove(x, y);
    }

    if (cursorHideTimer) {
      window.clearTimeout(cursorHideTimer);
    }
    cursorHideTimer = window.setTimeout(() => {
      debugCursor.style.display = 'none';
    }, DEBUG_CURSOR_HIDE_MS);
  };

  const setOverlayRect = (rect: DOMRect) => {
    if (!overlay) {
      return;
    }

    overlay.style.display = 'block';
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  return {
    install,
    updateDebugHud,
    updateDebugCursor,
    setOverlayRect,
  };
}
