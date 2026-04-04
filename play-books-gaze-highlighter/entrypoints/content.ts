import numeric from 'numeric';

export default defineContentScript({
  matches: ['https://play.google.com/*', 'https://books.googleusercontent.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
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

type FaceMeshPoint = [number, number, number?];

type FaceTrackerLike = {
  name?: string;
  getPositions?: () => FaceMeshPoint[] | null;
};

type WebGazerLike = {
  setGazeListener: (
    listener: (data: WebGazerPoint | null, elapsedTime: number) => void,
  ) => WebGazerLike;
  begin: (onNoStream?: () => void) => Promise<WebGazerLike>;
  addMouseEventListeners: () => WebGazerLike;
  recordScreenPosition: (x: number, y: number, eventType?: string) => WebGazerLike;
  applyKalmanFilter: (enabled: boolean) => WebGazerLike;
  saveDataAcrossSessions: (enabled: boolean) => WebGazerLike;
  setTracker: (name: string) => WebGazerLike;
  showVideoPreview: (show: boolean) => WebGazerLike;
  showVideo: (show: boolean) => WebGazerLike;
  showPredictionPoints: (show: boolean) => WebGazerLike;
  showFaceOverlay: (show: boolean) => WebGazerLike;
  showFaceFeedbackBox: (show: boolean) => WebGazerLike;
  setRegression: (name: string) => WebGazerLike;
  getTracker?: () => FaceTrackerLike;
  getCurrentPrediction?: () => Promise<WebGazerPoint | null> | WebGazerPoint | null;
  clearData?: () => Promise<void>;
};

const HIGHLIGHT_NAME = 'play-books-gaze-sentence';
const STYLE_ID = 'play-books-gaze-style';
const OVERLAY_ID = 'play-books-gaze-overlay';
const DEBUG_HUD_ID = 'play-books-gaze-debug';
const DEBUG_CURSOR_ID = 'play-books-gaze-cursor';
const REFRESH_DEBOUNCE_MS = 300;
const GAZE_SAMPLE_MS = 120;
const GAZE_STALE_MS = 1200;
const DEBUG_CURSOR_HIDE_MS = 250;
const REQUIRED_CALIBRATION_CLICKS = 12;
const PREDICTION_PROBE_MS = 300;
const CALIBRATION_TO_ASSIST_MS = 5000;
const CALIBRATION_HINT_COOLDOWN_MS = 1000;
const GAZE_KALMAN_PROCESS_NOISE = 6;
const GAZE_KALMAN_MEASUREMENT_NOISE = 90;
const PAGE_TURN_DEBOUNCE_MS = 1200;
const HEAD_TILT_NEUTRAL_DEG = 10;
const HEAD_TILT_SWING_DEG = 35;
const HEAD_TILT_SWING_WINDOW_MS = 700;
const FACEMESH_RIGHT_EYE_OUTER_INDEX = 33;
const FACEMESH_LEFT_EYE_OUTER_INDEX = 263;
const SENTENCE_PATTERN = /[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g;
const SHOW_DEBUG_UI = window.top === window.self;
const CALIBRATION_MSG_TYPE = '__play_books_gaze_calibration_click__';
const CALIBRATION_RESET_MSG_TYPE = '__play_books_gaze_calibration_reset__';
const GAZE_POINT_MSG_TYPE = '__play_books_gaze_point__';
const PAGE_TURN_MSG_TYPE = '__play_books_gaze_page_turn__';

type AxisKalmanState = {
  estimate: number;
  covariance: number;
  initialized: boolean;
};

let sentences: SentenceRange[] = [];
let refreshTimer: number | null = null;
let overlay: HTMLDivElement | null = null;
let activeSentenceId: number | null = null;
let lastSampleAt = 0;
let lastPredictionAt = 0;
let latestMousePoint: WebGazerPoint | null = null;
let cursorHideTimer: number | null = null;
let activeWebGazer: WebGazerLike | null = null;
const pendingCalibrationPoints: WebGazerPoint[] = [];
let calibrationClicks = 0;
let predictionProbeTimer: number | null = null;
let calibrationCompletedAt = 0;
let assistModeActive = false;
let webGazerCrashGuardInstalled = false;
let lastCalibrationHintAt = 0;
let gazeKalmanX: AxisKalmanState = {
  estimate: 0,
  covariance: 1,
  initialized: false,
};
let gazeKalmanY: AxisKalmanState = {
  estimate: 0,
  covariance: 1,
  initialized: false,
};
let lastPageTurnAt = 0;
let lastNeutralTiltAt = 0;

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function emitPageTurnKey(direction: 'next' | 'prev', target: EventTarget) {
  const key = direction === 'next' ? 'ArrowRight' : 'ArrowLeft';
  const code = direction === 'next' ? 'ArrowRight' : 'ArrowLeft';

  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
    }),
  );
  target.dispatchEvent(
    new KeyboardEvent('keyup', {
      key,
      code,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function tryPageTurnByKey(direction: 'next' | 'prev') {
  const focusTarget = document.body ?? document.documentElement;
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus();
  }

  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return false;
  }

  if (active instanceof HTMLElement && active.isContentEditable) {
    return false;
  }

  const targets: EventTarget[] = [];
  if (active) {
    targets.push(active);
  }
  targets.push(document);
  targets.push(window);

  for (const target of targets) {
    emitPageTurnKey(direction, target);
  }

  return true;
}

function clickPageButton(direction: 'next' | 'prev') {
  const selector =
    direction === 'next'
      ? [
          'button[aria-label*="next" i]',
          '[role="button"][aria-label*="next" i]',
          'button[title*="next" i]',
          '[role="button"][title*="next" i]',
        ]
      : [
          'button[aria-label*="prev" i]',
          'button[aria-label*="previous" i]',
          '[role="button"][aria-label*="prev" i]',
          '[role="button"][aria-label*="previous" i]',
          'button[title*="prev" i]',
          'button[title*="previous" i]',
          '[role="button"][title*="prev" i]',
          '[role="button"][title*="previous" i]',
        ];

  for (const query of selector) {
    const element = document.querySelector<HTMLElement>(query);
    if (!element) {
      continue;
    }

    element.click();
    return true;
  }

  return false;
}

function attemptPageTurnLocal(direction: 'next' | 'prev') {
  const usedButton = clickPageButton(direction);
  const usedKeyboard = tryPageTurnByKey(direction);
  return usedButton || usedKeyboard;
}

function triggerPageTurn(direction: 'next' | 'prev') {
  const now = Date.now();
  if (now - lastPageTurnAt < PAGE_TURN_DEBOUNCE_MS) {
    return;
  }

  let turned = attemptPageTurnLocal(direction);

  if (window.top === window.self) {
    for (let i = 0; i < window.frames.length; i += 1) {
      try {
        window.frames[i]?.postMessage(
          {
            type: PAGE_TURN_MSG_TYPE,
            direction,
          },
          '*',
        );
      } catch {
        // Ignore frame messaging failures for detached or restricted frames.
      }
    }
  }

  // Treat any attempt as consumed so repeated extreme poses don't spam commands.
  if (!turned && import.meta.env.DEV) {
    console.info('[WebGazer] page turn command dispatched but no local control consumed it', {
      direction,
    });
  }

  lastPageTurnAt = now;
}

function getHeadRollDegrees(): number | null {
  const landmarks = activeWebGazer?.getTracker?.()?.getPositions?.();
  if (!landmarks || landmarks.length <= FACEMESH_LEFT_EYE_OUTER_INDEX) {
    return null;
  }

  const eyeA = landmarks[FACEMESH_RIGHT_EYE_OUTER_INDEX];
  const eyeB = landmarks[FACEMESH_LEFT_EYE_OUTER_INDEX];
  if (!eyeA || !eyeB) {
    return null;
  }

  const leftEye = eyeA[0] <= eyeB[0] ? eyeA : eyeB;
  const rightEye = eyeA[0] <= eyeB[0] ? eyeB : eyeA;

  const dx = rightEye[0] - leftEye[0];
  const dy = rightEye[1] - leftEye[1];
  if (Math.abs(dx) < 0.001) {
    return null;
  }

  return toDegrees(Math.atan2(dy, dx));
}

function handleHeadTiltPageTurn(): number | null {
  const roll = getHeadRollDegrees();
  if (roll === null) {
    return null;
  }

  const now = Date.now();
  const absRoll = Math.abs(roll);
  if (absRoll <= HEAD_TILT_NEUTRAL_DEG) {
    lastNeutralTiltAt = now;
    return roll;
  }

  if (lastNeutralTiltAt <= 0) {
    return roll;
  }

  if (now - lastNeutralTiltAt > HEAD_TILT_SWING_WINDOW_MS) {
    return roll;
  }

  if (roll <= -HEAD_TILT_SWING_DEG) {
    console.info('[WebGazer] extreme tilt detected', {
      direction: 'negative',
      tiltDeg: Number(roll.toFixed(1)),
      transitionMs: now - lastNeutralTiltAt,
      action: 'next',
    });
    triggerPageTurn('next');
    lastNeutralTiltAt = 0;
    return roll;
  }

  if (roll >= HEAD_TILT_SWING_DEG) {
    console.info('[WebGazer] extreme tilt detected', {
      direction: 'positive',
      tiltDeg: Number(roll.toFixed(1)),
      transitionMs: now - lastNeutralTiltAt,
      action: 'prev',
    });
    triggerPageTurn('prev');
    lastNeutralTiltAt = 0;
  }

  return roll;
}

function resetGazeKalman() {
  gazeKalmanX = {
    estimate: 0,
    covariance: 1,
    initialized: false,
  };
  gazeKalmanY = {
    estimate: 0,
    covariance: 1,
    initialized: false,
  };
}

function updateKalmanAxis(state: AxisKalmanState, measurement: number): number {
  if (!state.initialized) {
    state.estimate = measurement;
    state.covariance = GAZE_KALMAN_MEASUREMENT_NOISE;
    state.initialized = true;
    return measurement;
  }

  state.covariance += GAZE_KALMAN_PROCESS_NOISE;
  const kalmanGain = state.covariance / (state.covariance + GAZE_KALMAN_MEASUREMENT_NOISE);
  state.estimate = state.estimate + kalmanGain * (measurement - state.estimate);
  state.covariance = (1 - kalmanGain) * state.covariance;

  return state.estimate;
}

function filterGazePoint(point: WebGazerPoint): WebGazerPoint {
  return {
    x: updateKalmanAxis(gazeKalmanX, point.x),
    y: updateKalmanAxis(gazeKalmanY, point.y),
  };
}

function isCalibrationComplete() {
  return calibrationClicks >= REQUIRED_CALIBRATION_CLICKS;
}

function maybeShowCalibrationRequiredHint() {
  const now = Date.now();
  if (now - lastCalibrationHintAt < CALIBRATION_HINT_COOLDOWN_MS) {
    return;
  }

  lastCalibrationHintAt = now;
  const remaining = Math.max(0, REQUIRED_CALIBRATION_CLICKS - calibrationClicks);
  updateDebugHud(
    `Calibration required before gaze tracking\nClicks left: ${remaining}\n(Press Shift+R to reset anytime)`,
  );
}

function installWebGazerCrashGuard() {
  if (webGazerCrashGuardInstalled) {
    return;
  }
  webGazerCrashGuardInstalled = true;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason ?? '');
    if (!reason.includes('forwardFunc is not a function')) {
      return;
    }

    event.preventDefault();
    activeWebGazer = null;
    disableAssistMode();
    updateDebugHud(
      'WebGazer model failed (forwardFunc).\nUsing mouse fallback only in this session.',
    );
  });

  window.addEventListener('error', (event) => {
    const message = String(event.error ?? event.message ?? '');
    if (!message.includes('forwardFunc is not a function')) {
      return;
    }

    event.preventDefault();
    activeWebGazer = null;
    disableAssistMode();
    updateDebugHud(
      'WebGazer model failed (forwardFunc).\nUsing mouse fallback only in this session.',
    );
  });
}

async function resetCalibration(clearModelData = false) {
  calibrationClicks = 0;
  calibrationCompletedAt = 0;
  lastPredictionAt = 0;
  lastCalibrationHintAt = 0;
  resetGazeKalman();
  disableAssistMode();

  if (clearModelData && activeWebGazer?.clearData) {
    await activeWebGazer.clearData();
  }

  updateDebugHud(
    `Calibration reset\nCalibration is required: click ${REQUIRED_CALIBRATION_CLICKS} points across the page.\n(Press Shift+R to reset anytime)`,
  );
}

function shouldUseMouseFallback(isTopFrame: boolean) {
  return !isTopFrame || Date.now() - lastPredictionAt > GAZE_STALE_MS;
}

function handleCalibrationPoint(x: number, y: number, source: 'top' | 'iframe') {
  calibrationClicks += 1;
  const progress = Math.min(calibrationClicks, REQUIRED_CALIBRATION_CLICKS);
  const progressLine = `Calibration: ${progress}/${REQUIRED_CALIBRATION_CLICKS}`;

  if (!activeWebGazer) {
    pendingCalibrationPoints.push({ x, y });
    updateDebugHud(
      `${progressLine}\nCalibration queued (${source})\nx: ${Math.round(x)} y: ${Math.round(y)}`,
    );
    return;
  }

  activeWebGazer.recordScreenPosition(x, y, 'click');

  if (calibrationClicks === REQUIRED_CALIBRATION_CLICKS) {
    calibrationCompletedAt = Date.now();
    updateDebugHud(
      `${progressLine}\nCalibration clicks complete.\nWaiting for first gaze prediction...`,
    );
  } else {
    updateDebugHud(
      `${progressLine}\nCalibration click captured (${source})\nx: ${Math.round(x)} y: ${Math.round(y)}`,
    );
  }
}

function toTopViewportPoint(x: number, y: number): WebGazerPoint {
  let topX = x;
  let topY = y;

  try {
    const frame = window.frameElement as HTMLElement | null;
    if (frame) {
      const rect = frame.getBoundingClientRect();
      topX += rect.left;
      topY += rect.top;
    }
  } catch {
    // Cross-origin iframe access can fail; fall back to local coordinates.
  }

  return { x: topX, y: topY };
}

function toLocalViewportPoint(x: number, y: number): WebGazerPoint {
  let localX = x;
  let localY = y;

  try {
    const frame = window.frameElement as HTMLElement | null;
    if (frame) {
      const rect = frame.getBoundingClientRect();
      localX -= rect.left;
      localY -= rect.top;
    }
  } catch {
    // Cross-origin iframe access can fail; fall back to shared viewport coordinates.
  }

  return { x: localX, y: localY };
}

function handleResetShortcut(event: KeyboardEvent, isTopFrame: boolean) {
  if (!event.shiftKey || (event.key !== 'R' && event.key !== 'r')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (isTopFrame) {
    void resetCalibration(true);
    return;
  }

  window.top?.postMessage({ type: CALIBRATION_RESET_MSG_TYPE }, '*');
}

function installInteractionListeners(isTopFrame: boolean) {
  const mouseHandler = (event: MouseEvent) => {
    latestMousePoint = { x: event.clientX, y: event.clientY };

    if (!shouldUseMouseFallback(isTopFrame)) {
      return;
    }

    updateDebugCursor(Math.round(event.clientX), Math.round(event.clientY), 'mouse');
    processPoint(latestMousePoint, 'mouse');
  };

  const resetHandler = (event: KeyboardEvent) => {
    handleResetShortcut(event, isTopFrame);
  };

  window.addEventListener('mousemove', mouseHandler, { capture: true });
  document.addEventListener('mousemove', mouseHandler, { capture: true });
  window.addEventListener('keydown', resetHandler, { capture: true });
  document.addEventListener('keydown', resetHandler, { capture: true });
  window.addEventListener('keyup', resetHandler, { capture: true });
  document.addEventListener('keyup', resetHandler, { capture: true });
  window.addEventListener(
    'click',
    (event) => {
      const clickPoint = toTopViewportPoint(event.clientX, event.clientY);

      if (isTopFrame) {
        handleCalibrationPoint(clickPoint.x, clickPoint.y, 'top');
      } else {
        window.top?.postMessage(
          {
            type: CALIBRATION_MSG_TYPE,
            x: clickPoint.x,
            y: clickPoint.y,
          },
          '*',
        );
      }

      if (!shouldUseMouseFallback(isTopFrame)) {
        return;
      }

      updateDebugCursor(Math.round(event.clientX), Math.round(event.clientY), 'mouse');
    },
    { capture: true },
  );
}

function installIframeMessageHandlers() {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      x?: number;
      y?: number;
      direction?: 'next' | 'prev';
    };
    if (data?.type === PAGE_TURN_MSG_TYPE) {
      if (data.direction === 'next' || data.direction === 'prev') {
        attemptPageTurnLocal(data.direction);
      }
      return;
    }

    if (data?.type !== GAZE_POINT_MSG_TYPE) {
      return;
    }
    if (typeof data.x !== 'number' || typeof data.y !== 'number') {
      return;
    }

    const localPoint = toLocalViewportPoint(data.x, data.y);
    lastPredictionAt = Date.now();
    updateDebugCursor(Math.round(localPoint.x), Math.round(localPoint.y), 'gaze');
    highlightSentenceAtPoint(localPoint.x, localPoint.y);
  });

  updateDebugHud('Iframe mode\nmouse fallback active');
}

function installTopFrameMessageHandlers() {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; x?: number; y?: number };
    if (!data?.type) {
      return;
    }

    if (data.type === CALIBRATION_RESET_MSG_TYPE) {
      void resetCalibration(true);
      return;
    }

    if (data.type !== CALIBRATION_MSG_TYPE) {
      return;
    }
    if (typeof data.x !== 'number' || typeof data.y !== 'number') {
      return;
    }

    handleCalibrationPoint(data.x, data.y, 'iframe');
  });
}

function startPredictionProbe() {
  if (predictionProbeTimer) {
    window.clearInterval(predictionProbeTimer);
  }

  predictionProbeTimer = window.setInterval(async () => {
    maybeEnableAssistMode();

    if (!activeWebGazer?.getCurrentPrediction) {
      return;
    }

    try {
      const prediction = await Promise.resolve(activeWebGazer.getCurrentPrediction());
      if (!prediction) {
        return;
      }

      if (!isCalibrationComplete()) {
        maybeShowCalibrationRequiredHint();
        return;
      }

      lastPredictionAt = Date.now();
      disableAssistMode();
      processPoint(prediction, 'gaze');
    } catch {
      // Ignore probe errors, listener path remains active.
    }
  }, PREDICTION_PROBE_MS);
}

function installGazeListener(webgazer: WebGazerLike) {
  webgazer.setGazeListener((point) => {
    if (!point) {
      maybeEnableAssistMode();

      const shouldFallback = Date.now() - lastPredictionAt > GAZE_STALE_MS;
      if (import.meta.env.DEV && latestMousePoint && shouldFallback) {
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

    if (!isCalibrationComplete()) {
      maybeShowCalibrationRequiredHint();
      return;
    }

    lastPredictionAt = Date.now();
    disableAssistMode();
    processPoint(point, 'gaze');
  });
}

async function startGazeHighlighter() {
  console.log('[WebGazer] content script started');
  installWebGazerCrashGuard();
  installStyle();
  updateDebugHud('Starting WebGazer...');
  collectSentences();
  watchDomForRefresh();

  const isTopFrame = window.top === window.self;
  installInteractionListeners(isTopFrame);

  if (!isTopFrame) {
    installIframeMessageHandlers();
    return;
  }

  installTopFrameMessageHandlers();

  const webgazer = await initWebGazer();
  if (!webgazer) {
    updateDebugHud('WebGazer init failed\nmouse fallback active');
    return;
  }

  activeWebGazer = webgazer;
  await resetCalibration(true);

  if (pendingCalibrationPoints.length > 0) {
    for (const point of pendingCalibrationPoints.splice(0)) {
      activeWebGazer.recordScreenPosition(point.x, point.y, 'click');
    }
    updateDebugHud('WebGazer ready\nqueued calibration points applied');
  }

  updateDebugHud('WebGazer ready, waiting for gaze data...');

  startPredictionProbe();
  installGazeListener(webgazer);
}

function maybeEnableAssistMode() {
  if (
    calibrationCompletedAt <= 0 ||
    assistModeActive ||
    Date.now() - calibrationCompletedAt <= CALIBRATION_TO_ASSIST_MS
  ) {
    return;
  }

  assistModeActive = true;
  activeWebGazer
    ?.showVideo(true)
    .showVideoPreview(true)
    .showFaceOverlay(true)
    .showFaceFeedbackBox(true);
  updateDebugHud(
    'No gaze prediction after calibration.\nCamera assist enabled - align face in box.',
  );
}

function disableAssistMode() {
  if (!assistModeActive) {
    return;
  }

  assistModeActive = false;
  activeWebGazer
    ?.showVideo(false)
    .showVideoPreview(false)
    .showFaceOverlay(false)
    .showFaceFeedbackBox(false);
}

function processPoint(point: WebGazerPoint, source: 'gaze' | 'mouse') {
  const now = Date.now();
  if (now - lastSampleAt < GAZE_SAMPLE_MS) {
    return;
  }
  lastSampleAt = now;

  const processedPoint = source === 'gaze' ? filterGazePoint(point) : point;

  const roundedX = Math.round(processedPoint.x);
  const roundedY = Math.round(processedPoint.y);

  console.info('[WebGazer] point', {
    source,
    x: roundedX,
    y: roundedY,
  });

  let tiltLabel = '';
  if (source === 'gaze' && window.top === window.self) {
    const tiltDegrees = handleHeadTiltPageTurn();
    tiltLabel =
      tiltDegrees === null ? '\ntilt: unavailable' : `\ntilt: ${tiltDegrees.toFixed(1)} deg`;
  }

  const sourceLabel = source === 'gaze' ? 'gaze' : 'mouse fallback';
  updateDebugHud(`${sourceLabel}\nx: ${roundedX} y: ${roundedY}${tiltLabel}`);
  updateDebugCursor(roundedX, roundedY, source);

  if (source === 'gaze' && window.top === window.self) {
    for (let i = 0; i < window.frames.length; i += 1) {
      try {
        window.frames[i]?.postMessage(
          {
            type: GAZE_POINT_MSG_TYPE,
            x: processedPoint.x,
            y: processedPoint.y,
          },
          '*',
        );
      } catch {
        // Ignore frame messaging failures for detached or restricted frames.
      }
    }
  }

  highlightSentenceAtPoint(processedPoint.x, processedPoint.y);
}

function highlightSentenceAtPoint(x: number, y: number) {
  const sentence = findSentenceAtPoint(x, y);
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

  if (!SHOW_DEBUG_UI) {
    return;
  }

  const debugHud = document.createElement('div');
  debugHud.id = DEBUG_HUD_ID;
  debugHud.textContent = 'Initializing...';
  document.body.append(debugHud);
}

function updateDebugHud(message: string) {
  if (!SHOW_DEBUG_UI) {
    return;
  }

  const debugHud = document.getElementById(DEBUG_HUD_ID);
  if (!debugHud) {
    return;
  }
  debugHud.textContent = `[WebGazer]\n${message}`;
}

function updateDebugCursor(x: number, y: number, source: 'gaze' | 'mouse') {
  const debugCursor = document.getElementById(DEBUG_CURSOR_ID);
  if (!debugCursor) {
    return;
  }

  debugCursor.style.display = 'block';
  debugCursor.style.left = `${x - 6}px`;
  debugCursor.style.top = `${y - 6}px`;
  debugCursor.style.background = source === 'gaze' ? '#ef4444' : '#f59e0b';

  // Hover-highlight follows only gaze (red) cursor movement.
  if (source === 'gaze') {
    highlightSentenceAtPoint(x, y);
  }

  if (cursorHideTimer) {
    window.clearTimeout(cursorHideTimer);
  }
  cursorHideTimer = window.setTimeout(() => {
    debugCursor.style.display = 'none';
  }, DEBUG_CURSOR_HIDE_MS);
}

async function initWebGazer(): Promise<WebGazerLike | null> {
  try {
    // WebGazer's numeric dependency resolves `numeric` from global scope.
    const globals = globalThis as Record<string, unknown>;
    globals.numeric = numeric as unknown;

    // Ensure FaceMesh constructor is available on global scope before WebGazer initializes.
    // WebGazer expects this symbol in some runtime/bundler combinations.
    try {
      const faceMeshModule = (await import('@mediapipe/face_mesh')) as Record<string, unknown>;
      const faceMeshModuleDefault = (faceMeshModule.default ??
        faceMeshModule['module.exports'] ??
        faceMeshModule) as Record<string, unknown>;
      const faceMeshCtor =
        (faceMeshModule.FaceMesh as unknown) ??
        (faceMeshModuleDefault.FaceMesh as unknown) ??
        (globals.FaceMesh as unknown);

      if (faceMeshCtor) {
        globals.FaceMesh = faceMeshCtor;
      }
    } catch {
      // Ignore preload errors; WebGazer init below reports the real failure reason.
    }

    const module = await import('webgazer');
    const maybeWebGazer = (module.default ?? module) as WebGazerLike;

    maybeWebGazer.saveDataAcrossSessions(false).applyKalmanFilter(true);

    const trackerCandidates = ['TFFacemesh', 'TFFaceMesh'];
    for (const candidate of trackerCandidates) {
      maybeWebGazer.setTracker(candidate);
      const selectedTracker = maybeWebGazer.getTracker?.()?.name ?? '';
      if (selectedTracker.toLowerCase().includes('facemesh')) {
        break;
      }
    }

    const instance = await maybeWebGazer
      .setRegression('ridge')
      .showVideoPreview(false)
      .showPredictionPoints(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .begin(() => {
        updateDebugHud(
          'Camera stream unavailable.\nAllow camera access for play.google.com then reload.',
        );
      });

    instance.addMouseEventListeners();

    console.log('[WebGazer] initialized');

    return instance;
  } catch (error) {
    const message = String(error ?? '');
    if (
      message.includes('forwardFunc is not a function') ||
      message.includes('is not a constructor')
    ) {
      console.info('[WebGazer] unavailable in this runtime, using mouse fallback only');
      return null;
    }

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
