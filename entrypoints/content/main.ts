import {
  CALIBRATION_HINT_COOLDOWN_MS,
  CALIBRATION_MSG_TYPE,
  CALIBRATION_RESET_MSG_TYPE,
  CALIBRATION_TO_ASSIST_MS,
  GAZE_KALMAN_MEASUREMENT_NOISE,
  GAZE_KALMAN_PROCESS_NOISE,
  GAZE_POINT_MSG_TYPE,
  GAZE_SAMPLE_MS,
  GAZE_STALE_MS,
  PAGE_TURN_MSG_TYPE,
  PREDICTION_PROBE_MS,
  REQUIRED_CALIBRATION_CLICKS,
} from './constants';
import { createPageTurnController } from './pageTurn';
import { createSentenceController } from './sentences';
import type { AxisKalmanState, WebGazerLike, WebGazerPoint } from './types';
import { createUiController } from './ui';
import { initWebGazer } from './webgazer';

export async function startGazeHighlighter() {
  const isTopFrame = window.top === window.self;

  let activeWebGazer: WebGazerLike | null = null;
  let lastSampleAt = 0;
  let lastPredictionAt = 0;
  let latestMousePoint: WebGazerPoint | null = null;
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

  let highlightAtPoint = (_x: number, _y: number) => {};
  const ui = createUiController({
    showDebugUi: isTopFrame,
    onGazeCursorMove: (x, y) => {
      highlightAtPoint(x, y);
    },
  });

  const sentenceController = createSentenceController({
    setOverlayRect: ui.setOverlayRect,
  });
  highlightAtPoint = sentenceController.highlightSentenceAtPoint;

  const pageTurnController = createPageTurnController({
    getActiveWebGazer: () => activeWebGazer,
  });

  const resetGazeKalman = () => {
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
  };

  const updateKalmanAxis = (state: AxisKalmanState, measurement: number): number => {
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
  };

  const filterGazePoint = (point: WebGazerPoint): WebGazerPoint => {
    return {
      x: updateKalmanAxis(gazeKalmanX, point.x),
      y: updateKalmanAxis(gazeKalmanY, point.y),
    };
  };

  const isCalibrationComplete = () => {
    return calibrationClicks >= REQUIRED_CALIBRATION_CLICKS;
  };

  const disableAssistMode = () => {
    if (!assistModeActive) {
      return;
    }

    assistModeActive = false;
    activeWebGazer
      ?.showVideo(false)
      .showVideoPreview(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false);
  };

  const maybeShowCalibrationRequiredHint = () => {
    const now = Date.now();
    if (now - lastCalibrationHintAt < CALIBRATION_HINT_COOLDOWN_MS) {
      return;
    }

    lastCalibrationHintAt = now;
    const remaining = Math.max(0, REQUIRED_CALIBRATION_CLICKS - calibrationClicks);
    ui.updateDebugHud(
      `Calibration required before gaze tracking\nClicks left: ${remaining}\n(Press Shift+R to reset anytime)`,
    );
  };

  const maybeEnableAssistMode = () => {
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
    ui.updateDebugHud(
      'No gaze prediction after calibration.\nCamera assist enabled - align face in box.',
    );
  };

  const processPoint = (point: WebGazerPoint, source: 'gaze' | 'mouse') => {
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
    if (source === 'gaze' && isTopFrame) {
      const tiltDegrees = pageTurnController.handleHeadTiltPageTurn();
      tiltLabel =
        tiltDegrees === null ? '\ntilt: unavailable' : `\ntilt: ${tiltDegrees.toFixed(1)} deg`;
    }

    const sourceLabel = source === 'gaze' ? 'gaze' : 'mouse fallback';
    ui.updateDebugHud(`${sourceLabel}\nx: ${roundedX} y: ${roundedY}${tiltLabel}`);
    ui.updateDebugCursor(roundedX, roundedY, source);

    if (source === 'gaze' && isTopFrame) {
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

    sentenceController.highlightSentenceAtPoint(processedPoint.x, processedPoint.y);
  };

  const installWebGazerCrashGuard = () => {
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
      ui.updateDebugHud(
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
      ui.updateDebugHud(
        'WebGazer model failed (forwardFunc).\nUsing mouse fallback only in this session.',
      );
    });
  };

  const resetCalibration = async (clearModelData = false) => {
    calibrationClicks = 0;
    calibrationCompletedAt = 0;
    lastPredictionAt = 0;
    lastCalibrationHintAt = 0;
    resetGazeKalman();
    disableAssistMode();

    if (clearModelData && activeWebGazer?.clearData) {
      await activeWebGazer.clearData();
    }

    ui.updateDebugHud(
      `Calibration reset\nCalibration is required: click ${REQUIRED_CALIBRATION_CLICKS} points across the page.\n(Press Shift+R to reset anytime)`,
    );
  };

  const shouldUseMouseFallback = () => {
    return !isTopFrame || Date.now() - lastPredictionAt > GAZE_STALE_MS;
  };

  const handleCalibrationPoint = (x: number, y: number, source: 'top' | 'iframe') => {
    calibrationClicks += 1;
    const progress = Math.min(calibrationClicks, REQUIRED_CALIBRATION_CLICKS);
    const progressLine = `Calibration: ${progress}/${REQUIRED_CALIBRATION_CLICKS}`;

    if (!activeWebGazer) {
      pendingCalibrationPoints.push({ x, y });
      ui.updateDebugHud(
        `${progressLine}\nCalibration queued (${source})\nx: ${Math.round(x)} y: ${Math.round(y)}`,
      );
      return;
    }

    activeWebGazer.recordScreenPosition(x, y, 'click');

    if (calibrationClicks === REQUIRED_CALIBRATION_CLICKS) {
      calibrationCompletedAt = Date.now();
      ui.updateDebugHud(
        `${progressLine}\nCalibration clicks complete.\nWaiting for first gaze prediction...`,
      );
    } else {
      ui.updateDebugHud(
        `${progressLine}\nCalibration click captured (${source})\nx: ${Math.round(x)} y: ${Math.round(y)}`,
      );
    }
  };

  const toTopViewportPoint = (x: number, y: number): WebGazerPoint => {
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
  };

  const toLocalViewportPoint = (x: number, y: number): WebGazerPoint => {
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
  };

  const handleResetShortcut = (event: KeyboardEvent) => {
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
  };

  const installInteractionListeners = () => {
    const mouseHandler = (event: MouseEvent) => {
      latestMousePoint = { x: event.clientX, y: event.clientY };

      if (!shouldUseMouseFallback()) {
        return;
      }

      ui.updateDebugCursor(Math.round(event.clientX), Math.round(event.clientY), 'mouse');
      processPoint(latestMousePoint, 'mouse');
    };

    window.addEventListener('mousemove', mouseHandler, { capture: true });
    document.addEventListener('mousemove', mouseHandler, { capture: true });
    window.addEventListener('keydown', handleResetShortcut, { capture: true });
    document.addEventListener('keydown', handleResetShortcut, { capture: true });
    window.addEventListener('keyup', handleResetShortcut, { capture: true });
    document.addEventListener('keyup', handleResetShortcut, { capture: true });
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

        if (!shouldUseMouseFallback()) {
          return;
        }

        ui.updateDebugCursor(Math.round(event.clientX), Math.round(event.clientY), 'mouse');
      },
      { capture: true },
    );
  };

  const installIframeMessageHandlers = () => {
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        x?: number;
        y?: number;
        direction?: 'next' | 'prev';
      };
      if (data?.type === PAGE_TURN_MSG_TYPE) {
        if (data.direction === 'next' || data.direction === 'prev') {
          pageTurnController.attemptPageTurnLocal(data.direction);
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
      ui.updateDebugCursor(Math.round(localPoint.x), Math.round(localPoint.y), 'gaze');
      sentenceController.highlightSentenceAtPoint(localPoint.x, localPoint.y);
    });

    ui.updateDebugHud('Iframe mode\nmouse fallback active');
  };

  const installTopFrameMessageHandlers = () => {
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
  };

  const startPredictionProbe = () => {
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
  };

  const installGazeListener = (webgazer: WebGazerLike) => {
    webgazer.setGazeListener((point) => {
      if (!point) {
        maybeEnableAssistMode();

        const shouldFallback = Date.now() - lastPredictionAt > GAZE_STALE_MS;
        if (import.meta.env.DEV && latestMousePoint && shouldFallback) {
          processPoint(latestMousePoint, 'mouse');
          return;
        }

        if (Date.now() - lastPredictionAt > 2500) {
          ui.updateDebugHud(
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
  };

  console.log('[WebGazer] content script started');
  installWebGazerCrashGuard();
  ui.install();
  ui.updateDebugHud('Starting WebGazer...');
  sentenceController.collectSentences();
  sentenceController.watchDomForRefresh();
  installInteractionListeners();

  if (!isTopFrame) {
    installIframeMessageHandlers();
    return;
  }

  installTopFrameMessageHandlers();

  const webgazer = await initWebGazer({ updateDebugHud: ui.updateDebugHud });
  if (!webgazer) {
    ui.updateDebugHud('WebGazer init failed\nmouse fallback active');
    return;
  }

  activeWebGazer = webgazer;
  await resetCalibration(true);

  if (pendingCalibrationPoints.length > 0) {
    for (const point of pendingCalibrationPoints.splice(0)) {
      activeWebGazer.recordScreenPosition(point.x, point.y, 'click');
    }
    ui.updateDebugHud('WebGazer ready\nqueued calibration points applied');
  }

  ui.updateDebugHud('WebGazer ready, waiting for gaze data...');
  startPredictionProbe();
  installGazeListener(webgazer);
}
