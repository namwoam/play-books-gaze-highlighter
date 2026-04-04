import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <h1>Play Books Gaze Highlighter</h1>
    <p class="lead">Follows your eyes and highlights the sentence you are reading.</p>

    <section>
      <h2>How To Use</h2>
      <ol>
        <li>Open any Google Play Books reader page.</li>
        <li>Allow camera access when prompted.</li>
        <li>Keep your face centered for better sentence detection.</li>
      </ol>
    </section>

    <section>
      <h2>Tips</h2>
      <p>Best results come from stable lighting and sitting around an arm's length from the screen.</p>
    </section>

    <footer>
      <a href="https://play.google.com/books/reader" target="_blank" rel="noreferrer">Open Play Books Reader</a>
    </footer>
  </main>
`;
