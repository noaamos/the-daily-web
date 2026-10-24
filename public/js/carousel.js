// Owner: member 1
// Home page hero carousel. The slides are rendered by the server; this only switches which one is visible.
// Auto-advances, pauses while the pointer or keyboard focus is inside, and stays still for people who prefer reduced motion.

(function () {
  const root = document.querySelector('.carousel');
  if (!root) return;
  const slides = Array.from(root.querySelectorAll('.carousel-slide'));
  const controls = root.querySelector('.carousel-controls');
  const dotsEl = root.querySelector('.carousel-dots');
  if (slides.length < 2 || !controls || !dotsEl) return;

  const AUTO_MS = 6000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let timer = null;
  let paused = false;

  const dots = slides.map((slide, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('aria-label', 'לכתבה ' + (i + 1));
    dot.addEventListener('click', () => show(i));
    dotsEl.appendChild(dot);
    return dot;
  });

  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    dots.forEach((dot, i) => dot.setAttribute('aria-current', i === current ? 'true' : 'false'));
    restartTimer();
  }

  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  function restartTimer() {
    stopTimer();
    if (!paused && !reducedMotion.matches && !document.hidden) timer = setInterval(() => show(current + 1), AUTO_MS);
  }

  // In a right-to-left page "next" goes to the left, so the arrow keys are mirrored
  controls.querySelector('[data-carousel="prev"]').addEventListener('click', () => show(current - 1));
  controls.querySelector('[data-carousel="next"]').addEventListener('click', () => show(current + 1));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(current + 1);
    else if (e.key === 'ArrowRight') show(current - 1);
  });

  function setPaused(value) {
    paused = value;
    restartTimer();
  }
  root.addEventListener('mouseenter', () => setPaused(true));
  root.addEventListener('mouseleave', () => setPaused(false));
  root.addEventListener('focusin', () => setPaused(true));
  root.addEventListener('focusout', () => setPaused(false));
  document.addEventListener('visibilitychange', restartTimer);
  reducedMotion.addEventListener('change', restartTimer);

  // JS is running: reveal the controls (they stay hidden without JS) and start
  controls.hidden = false;
  dotsEl.hidden = false;
  root.classList.add('is-enhanced');
  show(0);
})();
