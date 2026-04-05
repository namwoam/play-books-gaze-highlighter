import numeric from 'numeric';
import type { WebGazerLike } from './types';

type InitWebGazerOptions = {
  updateDebugHud: (message: string) => void;
};

export async function initWebGazer(options: InitWebGazerOptions): Promise<WebGazerLike | null> {
  try {
    // WebGazer's numeric dependency resolves numeric from global scope.
    const globals = globalThis as Record<string, unknown>;
    globals.numeric = numeric as unknown;

    // Ensure FaceMesh constructor is available on global scope before WebGazer initializes.
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
      // Ignore preload errors; init below reports the actionable failure.
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
        options.updateDebugHud(
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
