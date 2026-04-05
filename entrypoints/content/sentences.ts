import {
  ACTIVE_SENTENCE_CLASS,
  HIGHLIGHT_NAME,
  REFRESH_DEBOUNCE_MS,
  SENTENCE_PATTERN,
} from './constants';
import type { SentenceRange } from './types';

type SentenceControllerOptions = {
  setOverlayRect: (rect: DOMRect) => void;
};

export type SentenceController = {
  collectSentences: () => void;
  watchDomForRefresh: () => void;
  highlightSentenceAtPoint: (x: number, y: number) => void;
};

export function createSentenceController(options: SentenceControllerOptions): SentenceController {
  let sentences: SentenceRange[] = [];
  let refreshTimer: number | null = null;
  let activeSentenceId: number | null = null;
  let activeSentenceElement: HTMLSpanElement | null = null;

  const unwrapActiveSentence = () => {
    if (!activeSentenceElement || !activeSentenceElement.parentNode) {
      activeSentenceElement = null;
      return;
    }

    const parent = activeSentenceElement.parentNode;
    while (activeSentenceElement.firstChild) {
      parent.insertBefore(activeSentenceElement.firstChild, activeSentenceElement);
    }
    parent.removeChild(activeSentenceElement);
    activeSentenceElement = null;
  };

  const clearNativeHighlight = () => {
    const cssWithHighlights = CSS as unknown as {
      highlights?: {
        delete?: (name: string) => void;
      };
    };

    cssWithHighlights.highlights?.delete?.(HIGHLIGHT_NAME);
  };

  const scheduleSentenceRefresh = () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(() => {
      collectSentences();
    }, REFRESH_DEBOUNCE_MS);
  };

  const collectSentences = () => {
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
  };

  const findSentenceAtPoint = (x: number, y: number): SentenceRange | undefined => {
    return sentences.find((sentence) => {
      const pad = 16;
      return (
        x >= sentence.rect.left - pad &&
        x <= sentence.rect.right + pad &&
        y >= sentence.rect.top - pad &&
        y <= sentence.rect.bottom + pad
      );
    });
  };

  const applyHighlight = (range: Range) => {
    unwrapActiveSentence();
    clearNativeHighlight();

    try {
      const wrapper = document.createElement('span');
      wrapper.className = ACTIVE_SENTENCE_CLASS;
      range.surroundContents(wrapper);
      activeSentenceElement = wrapper;
      options.setOverlayRect(wrapper.getBoundingClientRect());
      return;
    } catch {
      const cssWithHighlights = CSS as unknown as {
        highlights?: {
          set?: (name: string, highlight: Highlight) => void;
        };
      };

      if (cssWithHighlights.highlights?.set) {
        const highlight = new Highlight();
        highlight.add(range);
        cssWithHighlights.highlights.set(HIGHLIGHT_NAME, highlight);
      }

      options.setOverlayRect(range.getBoundingClientRect());
    }
  };

  const highlightSentenceAtPoint = (x: number, y: number) => {
    const sentence = findSentenceAtPoint(x, y);
    if (!sentence || sentence.id === activeSentenceId) {
      return;
    }

    activeSentenceId = sentence.id;
    applyHighlight(sentence.range);
  };

  const watchDomForRefresh = () => {
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
  };

  return {
    collectSentences,
    watchDomForRefresh,
    highlightSentenceAtPoint,
  };
}
