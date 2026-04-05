import { spawn } from 'node:child_process';

const targetUrl =
  'https://play.google.com/books/reader?id=t2QyDwAAQBAJ&pg=GBS.PT41.w.1.0.0_33&hl=en';

const platform = process.platform;
const openCommand =
  platform === 'darwin'
    ? ['open', [targetUrl]]
    : platform === 'win32'
      ? ['cmd', ['/c', 'start', '', targetUrl]]
      : ['xdg-open', [targetUrl]];

const wxtProcess = spawn('npx', ['wxt'], {
  stdio: 'inherit',
  shell: true,
});

let hasOpenedUrl = false;

const openTimer = setTimeout(() => {
  if (hasOpenedUrl) {
    return;
  }

  hasOpenedUrl = true;
  const [command, args] = openCommand;
  const opener = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
  });

  opener.unref();
}, 3500);

function stopDev(signal) {
  clearTimeout(openTimer);
  if (!wxtProcess.killed) {
    wxtProcess.kill(signal);
  }
}

process.on('SIGINT', () => stopDev('SIGINT'));
process.on('SIGTERM', () => stopDev('SIGTERM'));

wxtProcess.on('exit', (code) => {
  clearTimeout(openTimer);
  process.exit(code ?? 0);
});
