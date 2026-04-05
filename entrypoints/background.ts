export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  if (!import.meta.env.DEV) {
    return;
  }

  const devReaderUrl =
    'https://play.google.com/books/reader?id=t2QyDwAAQBAJ&pg=GBS.PT41.w.1.0.0_33&hl=en';

  void browser.tabs.create({ url: devReaderUrl });
});
