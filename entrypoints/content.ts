import { startGazeHighlighter } from './content/main';

export default defineContentScript({
  matches: ['https://play.google.com/*', 'https://books.googleusercontent.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    void startGazeHighlighter();
  },
});
