import {
  FACEMESH_LEFT_EYE_OUTER_INDEX,
  FACEMESH_RIGHT_EYE_OUTER_INDEX,
  HEAD_TILT_NEUTRAL_DEG,
  HEAD_TILT_SWING_DEG,
  HEAD_TILT_SWING_WINDOW_MS,
  PAGE_TURN_DEBOUNCE_MS,
  PAGE_TURN_MSG_TYPE,
} from './constants';
import type { WebGazerLike } from './types';

type CreatePageTurnControllerOptions = {
  getActiveWebGazer: () => WebGazerLike | null;
};

export type PageTurnController = {
  handleHeadTiltPageTurn: () => number | null;
  attemptPageTurnLocal: (direction: 'next' | 'prev') => boolean;
};

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

export function createPageTurnController(options: CreatePageTurnControllerOptions): PageTurnController {
  let lastPageTurnAt = 0;
  let lastNeutralTiltAt = 0;

  const attemptPageTurnLocal = (direction: 'next' | 'prev') => {
    const usedButton = clickPageButton(direction);
    const usedKeyboard = tryPageTurnByKey(direction);
    return usedButton || usedKeyboard;
  };

  const triggerPageTurn = (direction: 'next' | 'prev') => {
    const now = Date.now();
    if (now - lastPageTurnAt < PAGE_TURN_DEBOUNCE_MS) {
      return;
    }

    const turned = attemptPageTurnLocal(direction);

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

    if (!turned && import.meta.env.DEV) {
      console.info('[WebGazer] page turn command dispatched but no local control consumed it', {
        direction,
      });
    }

    lastPageTurnAt = now;
  };

  const getHeadRollDegrees = (): number | null => {
    const landmarks = options.getActiveWebGazer()?.getTracker?.()?.getPositions?.();
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
  };

  const handleHeadTiltPageTurn = (): number | null => {
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
  };

  return {
    handleHeadTiltPageTurn,
    attemptPageTurnLocal,
  };
}
