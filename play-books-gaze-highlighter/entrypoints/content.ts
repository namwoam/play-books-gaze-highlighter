export default defineContentScript({
  matches: ['https://play.google.com/books/reader*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    if (window.top !== window.self) {
      return;
    }

    void startGazeHighlighter();
  },
});

type SentenceRange = {
  id: number;
  range: Range;
  rect: DOMRect;
  text: string;
};

type WebGazerPoint = {
  x: number;
  y: number;
};

type WebGazerLike = {
  setGazeListener: (
    listener: (data: WebGazerPoint | null, elapsedTime: number) => void,
  ) => WebGazerLike;
  begin: () => Promise<WebGazerLike>;
  showVideoPreview: (show: boolean) => WebGazerLike;
  showPredictionPoints: (show: boolean) => WebGazerLike;
  showFaceOverlay: (show: boolean) => WebGazerLike;
  showFaceFeedbackBox: (show: boolean) => WebGazerLike;
  setRegression: (name: string) => WebGazerLike;
};

const HIGHLIGHT_NAME = 'play-books-gaze-sentence';
const STYLE_ID = 'play-books-gaze-style';
const OVERLAY_ID = 'play-books-gaze-overlay';
const DEBUG_HUD_ID = 'play-books-gaze-debug';
const REFRESH_DEBOUNCE_MS = 300;
const GAZE_SAMPLE_MS = 120;
const SENTENCE_PATTERN = /[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g;

let sentences: SentenceRange[] = [];
let refreshTimer: number | null = null;
let overlay: HTMLDivElement | null = null;
let activeSentenceId: number | null = null;
let lastSampleAt = 0;
let lastPredictionAt = 0;
let latestMousePoint: WebGazerPoint | null = null;

async function startGazeHighlighter() {
  console.log('[WebGazer] content script started');
  installStyle();
  updateDebugHud('Starting WebGazer...');
  collectSentences();
  watchDomForRefresh();

  const webgazer = await initWebGazer();
  if (!webgazer) {
    updateDebugHud('WebGazer init failed');
    return;
  }

  if (import.meta.env.DEV) {
    window.addEventListener('mousemove', (event) => {
      latestMousePoint = { x: event.clientX, y: event.clientY };
    });
  }

  updateDebugHud('WebGazer ready, waiting for gaze data...');

  webgazer.setGazeListener((point) => {
    if (!point) {
      if (import.meta.env.DEV && latestMousePoint) {
        processPoint(latestMousePoint, 'mouse');
        return;
      }

      if (Date.now() - lastPredictionAt > 2500) {
        updateDebugHud(
          'No gaze prediction yet.\nAllow camera and click around the reading area to calibrate.',
        );
      }
      return;
    }

    lastPredictionAt = Date.now();
    processPoint(point, 'gaze');
  });
}

function processPoint(point: WebGazerPoint, source: 'gaze' | 'mouse') {
  const now = Date.now();
  if (now - lastSampleAt < GAZE_SAMPLE_MS) {
    return;
  }
  lastSampleAt = now;

  const roundedX = Math.round(point.x);
  const roundedY = Math.round(point.y);

  console.info('[WebGazer] point', {
    source,
    x: roundedX,
    y: roundedY,
  });

  const sourceLabel = source === 'gaze' ? 'gaze' : 'mouse fallback';
  updateDebugHud(`${sourceLabel}\nx: ${roundedX} y: ${roundedY}`);

  const sentence = findSentenceAtPoint(point.x, point.y);
  if (!sentence || sentence.id === activeSentenceId) {
    return;
  }

  activeSentenceId = sentence.id;
  applyHighlight(sentence.range);
}

function installStyle() {
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
  `;
  document.head.append(style);

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  document.body.append(overlay);

  const debugHud = document.createElement('div');
  debugHud.id = DEBUG_HUD_ID;
  debugHud.textContent = 'Initializing...';
  document.body.append(debugHud);
}

function updateDebugHud(message: string) {
  const debugHud = document.getElementById(DEBUG_HUD_ID);
  if (!debugHud) {
    return;
  }
  debugHud.textContent = `[WebGazer]\n${message}`;
}

async function initWebGazer(): Promise<WebGazerLike | null> {
  try {
    // WebGazer's numeric dependency creates functions with `eval` that resolve
    // `numeric` from global scope, so we expose it before loading WebGazer.
    const numericModule = await import('numeric');
    const numericGlobal = (numericModule.default ?? numericModule) as unknown;
    (globalThis as Record<string, unknown>).numeric = numericGlobal;

    const module = await import('webgazer');
    const maybeWebGazer = (module.default ?? module) as WebGazerLike;

    const showDebugAids = import.meta.env.DEV;

    const instance = await maybeWebGazer
      .setRegression('ridge')
      .showVideoPreview(showDebugAids)
      .showPredictionPoints(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .begin();

    console.log('[WebGazer] initialized');

    return instance;
  } catch (error) {
    console.warn('WebGazer failed to initialize:', error);
    return null;
  }
}

function watchDomForRefresh() {
  const observer = new MutationObserver(() => {
    scheduleSentenceRefresh();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener('resize', scheduleSentenceRefresh);
  window.addEventListener('scroll', scheduleSentenceRefresh, { passive: true });
}

function scheduleSentenceRefresh() {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    collectSentences();
  }, REFRESH_DEBOUNCE_MS);
}

function collectSentences() {
  const next: SentenceRange[] = [];
  let id = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const tag = parent.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'textarea', 'input'].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }

      const styles = window.getComputedStyle(parent);
      if (styles.visibility === 'hidden' || styles.display === 'none') {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const sentenceChunks = text.match(SENTENCE_PATTERN) ?? [];
    let cursor = 0;

    for (const chunk of sentenceChunks) {
      const normalized = chunk.replace(/\s+/g, ' ').trim();
      if (normalized.length < 25) {
        cursor += chunk.length;
        continue;
      }

      const startOffset = text.indexOf(chunk, cursor);
      if (startOffset < 0) {
        cursor += chunk.length;
        continue;
      }

      const endOffset = startOffset + chunk.length;
      cursor = endOffset;

      const range = document.createRange();
      range.setStart(node, startOffset);
      range.setEnd(node, endOffset);

      const rect = range.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 12) {
        continue;
      }

      next.push({
        id: id++,
        range,
        rect,
        text: normalized,
      });
    }

    node = walker.nextNode();
  }

  sentences = next;
}

function findSentenceAtPoint(x: number, y: number): SentenceRange | undefined {
  return sentences.find((sentence) => {
    const pad = 16;
    return (
      x >= sentence.rect.left - pad &&
      x <= sentence.rect.right + pad &&
      y >= sentence.rect.top - pad &&
      y <= sentence.rect.bottom + pad
    );
  });
}

function applyHighlight(range: Range) {
  const cssWithHighlights = CSS as unknown as {
    highlights?: {
      set: (name: string, highlight: Highlight) => void;
    };
  };

  if (cssWithHighlights.highlights) {
    const highlight = new Highlight();
    highlight.add(range);
    cssWithHighlights.highlights.set(HIGHLIGHT_NAME, highlight);
  }

  const rect = range.getBoundingClientRect();
  if (!overlay) {
    return;
  }

  overlay.style.display = 'block';
  overlay.style.left = `${rect.left + window.scrollX}px`;
  overlay.style.top = `${rect.top + window.scrollY}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}
