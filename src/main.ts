import './style.css';
import {
  simulateGroverState,
  simulateGroverSubStep,
  simulateProbabilityCurve,
  groverQueryCount,
  type GroverSubStep,
  type SubPhase,
} from './grover.ts';
import { analyzeKeySize, aesQuantumCost, analyzeHashFunction } from './aes-impact.ts';

/* ── Helpers ───────────────────────────────────────────── */
function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

function cryptoRandomBelow(max: number): number {
  const buf = new Uint32Array(1);
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % max);
  let v: number;
  do { crypto.getRandomValues(buf); v = buf[0]!; } while (v >= limit);
  return v % max;
}

function toBin(index: number, bits: number): string {
  return index.toString(2).padStart(bits, '0');
}

/** Uniform double in [0, 1) from the CSPRNG — for measurement sampling. */
function cryptoUnitInterval(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x1_0000_0000;
}

const deg = (radians: number): number => (radians * 180) / Math.PI;

/* ── Render root ───────────────────────────────────────── */
document.querySelector<HTMLDivElement>('#app')!.innerHTML = buildHTML();

/* ── State ─────────────────────────────────────────────── */
let n = 4;
let N = 2 ** n;
let targetIndex = cryptoRandomBelow(N);
let currentK = 0;
let subPhase: SubPhase = 'superposition';
let decompose = false;
let autoTimer: number | null = null;

/* ── DOM refs ──────────────────────────────────────────── */
const nSlider = $('#n-slider') as HTMLInputElement;
const nValue = $('#n-value');
const targetDisplay = $('#target-display');
const stepBtn = $('#step-btn');
const autoBtn = $('#auto-btn');
const resetBtn = $('#reset-btn');
const randomBtn = $('#random-btn');
const iterDisplay = $('#iter-display');
const decomposeToggle = $('#decompose-toggle') as HTMLInputElement;
const phaseLabel = $('#phase-label');
const rotationCanvas = $('#rotation-canvas') as HTMLCanvasElement;
const barChart = $('#bar-chart');
const barLabels = $('#bar-labels');
const ampValues = $('#amp-values');
const probCanvas = $('#prob-canvas') as HTMLCanvasElement;
const banner = $('#banner');
const liveRegion = $('#live-region');
const mathLayer = $('#math-layer');
const measureBtn = $('#measure-btn');
const measureDots = $('#measure-dots');
const measureStats = $('#measure-stats');

/* Reactive teaching panels */
const misconceptionEl = $('#misconception');
const mentalBox = $('#mental-box');
const mentalBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.mental-btn'));
const vizRotation = $('#viz-rotation');
const vizAmplitudes = $('#viz-amplitudes');

/* Prediction checkpoints */
const predictToggle = $('#predict-toggle') as HTMLInputElement;
const predictPrompt = $('#predict-prompt');
let predictMode = false;
let pendingPrediction = false;   // true while waiting for the learner to commit
let lastProb = 0;                // probability before the most recent advance

/* Compare-the-mental-models view */
type MentalView = 'algebra' | 'geometry' | 'amplitudes';
let mentalView: MentalView = 'geometry';

/* Guided lesson */
const lessonStartBtn = $('#lesson-start');
const lessonNav = $('#lesson-nav');
const lessonPrevBtn = $('#lesson-prev') as HTMLButtonElement;
const lessonNextBtn = $('#lesson-next') as HTMLButtonElement;
const lessonExitBtn = $('#lesson-exit');
const lessonBody = $('#lesson-body');
const lessonProgress = $('#lesson-progress');
let lessonStage = -1;            // -1 = not in a lesson

/* Race panel */
const raceClassicalBar = $('#race-classical-bar');
const raceQuantumBar = $('#race-quantum-bar');
const raceClassicalStats = $('#race-classical-stats');
const raceQuantumStats = $('#race-quantum-stats');
const raceClassicalStatus = $('#race-classical-status');
const raceQuantumStatus = $('#race-quantum-status');
const speedupBody = $('#speedup-body');
let raceTimer: number | null = null;
let raceTimeout: number | null = null;

/* ── Event bindings ────────────────────────────────────── */
nSlider.addEventListener('input', () => {
  n = parseInt(nSlider.value, 10);
  N = 2 ** n;
  targetIndex = cryptoRandomBelow(N);
  nSlider.setAttribute('aria-valuenow', String(n));
  resetState();
});

randomBtn.addEventListener('click', () => {
  targetIndex = cryptoRandomBelow(N);
  resetState();
});

/** Largest completed-iteration count we walk to (2*k*, to show overshoot). */
function maxIterations(): number {
  return 2 * simulateGroverState(n, targetIndex, 0).optimalIterations;
}

/**
 * Advance one user step. With sub-steps off, a step is a full Grover
 * iteration. With sub-steps on, a step is a single reflection
 * (superposition \u2192 oracle \u2192 diffusion \u2192 next oracle \u2026). Returns false
 * when already at the end (k = 2\u00B7k*).
 */
function advance(): boolean {
  const maxK = maxIterations();
  if (!decompose) {
    if (currentK >= maxK) return false;
    currentK += 1;
    subPhase = 'superposition';
    return true;
  }
  if (subPhase === 'superposition') {
    if (currentK >= maxK) return false;
    subPhase = 'oracle';
    return true;
  }
  if (subPhase === 'oracle') {
    subPhase = 'diffusion'; // diffusion(k) is exactly superposition(k+1)
    return true;
  }
  // subPhase === 'diffusion'  \u2192 step into the next iteration's oracle
  if (currentK + 1 >= maxK) return false;
  currentK += 1;
  subPhase = 'oracle';
  return true;
}

function stopAuto(): void {
  if (autoTimer !== null) { clearInterval(autoTimer); autoTimer = null; }
  autoBtn.textContent = '\u25B6\u25B6 Auto-run';
  autoBtn.classList.remove('active');
}

stepBtn.addEventListener('click', () => {
  // Prediction mode: a Step opens a guess; the reveal happens when the learner
  // picks a direction, so ignore further Step clicks until they commit.
  if (predictMode) {
    if (!pendingPrediction) showPredictionPrompt();
    return;
  }
  if (advance()) renderState();
});

predictToggle.addEventListener('change', () => {
  predictMode = predictToggle.checked;
  pendingPrediction = false;
  predictPrompt.style.display = predictMode ? 'block' : 'none';
  predictPrompt.innerHTML = predictMode
    ? '<span class="predict-idle">Prediction mode on — press <strong>Step</strong> and commit a guess before each reveal.</span>'
    : '';
  // Predictions and auto-run don't mix: pause auto so guesses aren't skipped.
  if (predictMode) stopAuto();
});

/** Success probability of the state we'd be revealing from. */
function currentProb(): number {
  return simulateGroverSubStep(n, targetIndex, currentK, subPhase).successProbability;
}

function showPredictionPrompt(): void {
  pendingPrediction = true;
  lastProb = currentProb();
  const sub = simulateGroverSubStep(n, targetIndex, currentK, subPhase);
  let q: string;
  if (decompose && subPhase === 'superposition') q = 'Next step is the ORACLE — will the target’s success probability go up, down, or stay about the same?';
  else if (decompose && subPhase === 'oracle') q = 'Next step is DIFFUSION — up, down, or about the same?';
  else if (sub.effectiveIteration >= sub.optimalIterations) q = 'You’re at or past k*. After one more iteration — up, down, or about the same?';
  else q = 'Before you step: will the target’s success probability go up, down, or stay about the same?';

  predictPrompt.style.display = 'block';
  predictPrompt.innerHTML = `<span class="predict-q">${q}</span>`;
  (['up', 'down', 'same'] as const).forEach((choice) => {
    const btn = document.createElement('button');
    btn.className = 'btn predict-choice';
    btn.textContent = choice === 'up' ? '↑ Increase' : choice === 'down' ? '↓ Decrease' : '→ About the same';
    btn.addEventListener('click', () => resolvePrediction(choice));
    predictPrompt.appendChild(btn);
  });
}

function resolvePrediction(choice: 'up' | 'down' | 'same'): void {
  const before = lastProb;
  if (!advance()) {
    pendingPrediction = false;
    predictPrompt.innerHTML = '<span class="predict-idle">End of the walk (k = 2·k*). Press Reset to start over.</span>';
    return;
  }
  renderState();
  const after = currentProb();
  const eps = 1e-6;
  const actual: 'up' | 'down' | 'same' = after > before + eps ? 'up' : after < before - eps ? 'down' : 'same';
  const word = { up: 'increased', down: 'decreased', same: 'stayed about the same' }[actual];
  const correct = choice === actual;
  pendingPrediction = false;
  predictPrompt.style.display = 'block';
  predictPrompt.innerHTML =
    `<div class="predict-result ${correct ? 'right' : 'wrong'}">` +
    `${correct ? '✓ Correct' : '✗ Not quite'} — probability ${word} ` +
    `(${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%). ` +
    `Press <strong>Step</strong> to predict the next one.</div>`;
}

autoBtn.addEventListener('click', () => {
  if (autoTimer !== null) { stopAuto(); return; }
  autoBtn.textContent = '\u23F9 Stop';
  autoBtn.classList.add('active');
  // Sub-steps are quick to read individually, so pace them a touch faster.
  const tick = decompose ? 550 : 400;
  autoTimer = window.setInterval(() => {
    if (!advance()) { stopAuto(); return; }
    renderState();
  }, tick);
});

decomposeToggle.addEventListener('change', () => {
  decompose = decomposeToggle.checked;
  stopAuto();
  // Land on a clean resting state so the two modes stay consistent.
  subPhase = 'superposition';
  renderState();
});

resetBtn.addEventListener('click', () => resetState());

measureBtn.addEventListener('click', () => runMeasurements());

/* ── Core render ───────────────────────────────────────── */
function resetState(): void {
  stopAuto();
  currentK = 0;
  subPhase = 'superposition';
  renderState();
  renderRace();
}

const PHASE_TEXT: Record<SubPhase, string> = {
  superposition: 'State \u2014 equal-ish superposition after the last iteration',
  oracle: 'Oracle \u2014 flip the target\u2019s phase (reflect across the non-target axis)',
  diffusion: 'Diffusion \u2014 invert all amplitudes about the mean (completes one rotation by 2\u03B8)',
};

function renderState(): void {
  const sub = simulateGroverSubStep(n, targetIndex, currentK, subPhase);
  const kStar = sub.optimalIterations;
  const effK = sub.effectiveIteration;

  /* Controls display */
  nValue.textContent = `N = 2^${n} = ${N.toLocaleString()}`;
  targetDisplay.textContent = `Target: index ${targetIndex} (${toBin(targetIndex, n)})`;
  iterDisplay.innerHTML = `Iteration: <span class="current">k = ${effK}</span> / <span class="optimal">k* = ${kStar}</span>`;

  /* Sub-phase indicator (only meaningful when decomposing) */
  if (decompose) {
    phaseLabel.style.display = 'block';
    phaseLabel.className = `phase-label ${subPhase}`;
    phaseLabel.textContent = PHASE_TEXT[subPhase];
  } else {
    phaseLabel.style.display = 'none';
  }

  /* Geometric rotation view */
  renderRotation(sub);

  /* Bars (signed, with live mean line) */
  renderBars(sub);

  /* Amplitude values */
  renderAmpValues(sub);

  /* Probability curve */
  renderProbCurve(sub);

  /* Math layer (algebra view of the same state) */
  renderMathLayer(sub);

  /* Reactive teaching: misconception correction + mental-model view */
  renderMisconception(sub);
  renderMentalModels(sub);

  /* Measurement is tied to a specific k \u2014 invalidate stale results on any change */
  resetMeasurement();

  /* Banner \u2014 only call out optimal/overshoot on a resting state, not mid-oracle */
  const resting = subPhase !== 'oracle';
  if (resting && effK === kStar) {
    banner.className = 'banner optimal';
    banner.style.display = 'block';
    banner.textContent = `\u2713 Optimal k* reached \u2014 measuring now would succeed with ${(sub.successProbability * 100).toFixed(2)}% probability`;
  } else if (resting && effK > kStar) {
    banner.className = 'banner overshoot';
    banner.style.display = 'block';
    banner.textContent = `\u26A0 Past optimal \u2014 the state vector has rotated beyond the target axis, so probability is now decreasing.`;
  } else {
    banner.style.display = 'none';
  }

  /* Accessibility live region */
  const phaseSpoken = decompose ? `${subPhase} step. ` : '';
  liveRegion.textContent =
    `${phaseSpoken}Iteration ${effK} of ${kStar} optimal. ` +
    `Target amplitude ${sub.targetAmplitude.toFixed(3)}. ` +
    `Success probability ${(sub.successProbability * 100).toFixed(1)}%.`;
}

/* ── Bar chart (signed amplitudes about a zero baseline) ──── */
function renderBars(state: GroverSubStep): void {
  barChart.innerHTML = '';
  barLabels.innerHTML = '';

  const showBars = n <= 8;
  if (!showBars) {
    barChart.innerHTML = `<div class="bar-toobig">N = ${N.toLocaleString()} is too large for individual bars. See the rotation view and probability curve below.</div>`;
    barLabels.innerHTML = '';
    return;
  }

  let indices: number[];
  if (n <= 4) {
    indices = Array.from({ length: N }, (_, i) => i);
  } else {
    const step = Math.max(1, Math.floor(N / 32));
    const set = new Set<number>();
    for (let i = 0; i < N; i += step) set.add(i);
    set.add(targetIndex);
    indices = Array.from(set).sort((a, b) => a - b);
  }

  // Symmetric scale so positive and negative amplitudes are comparable.
  const maxAmp = Math.max(
    Math.abs(state.targetAmplitude),
    Math.abs(state.nonTargetAmplitude),
    Math.abs(state.mean),
    0.01,
  );

  // Zero baseline through the middle of the chart.
  const baseline = document.createElement('div');
  baseline.className = 'bar-baseline';
  barChart.appendChild(baseline);

  // Live "mean" line — the axis the diffusion step reflects about.
  const meanLine = document.createElement('div');
  meanLine.className = 'bar-mean';
  meanLine.style.top = `${50 - (state.mean / maxAmp) * 50}%`;
  meanLine.setAttribute('title', `mean amplitude ≈ ${state.mean.toFixed(4)}`);
  const meanTag = document.createElement('span');
  meanTag.className = 'bar-mean-tag';
  meanTag.textContent = 'mean';
  meanLine.appendChild(meanTag);
  barChart.appendChild(meanLine);

  for (const idx of indices) {
    const amp = idx === targetIndex ? state.targetAmplitude : state.nonTargetAmplitude;
    const hPct = Math.max(0.6, (Math.abs(amp) / maxAmp) * 50);
    const slot = document.createElement('div');
    slot.className = 'bar-slot';

    const fill = document.createElement('div');
    const sign = amp < 0 ? 'neg' : 'pos';
    fill.className = `bar ${idx === targetIndex ? 'target' : 'non-target'} ${sign}`;
    fill.style.height = `${hPct}%`;
    if (amp < 0) fill.style.top = '50%'; else fill.style.bottom = '50%';
    slot.appendChild(fill);
    barChart.appendChild(slot);

    const lbl = document.createElement('span');
    lbl.textContent = n <= 4 ? toBin(idx, n) : String(idx);
    barLabels.appendChild(lbl);
  }

  if (n > 4) {
    const note = document.createElement('div');
    note.className = 'bar-note';
    note.textContent = `Showing ${indices.length} of ${N} states`;
    barLabels.appendChild(note);
  }

  const phaseNote = decompose ? ` Sub-step: ${subPhase}.` : '';
  barChart.setAttribute('aria-label',
    `Signed amplitude bar chart. Bars above the centre line are positive, below are negative.` +
    ` Target amplitude ${state.targetAmplitude.toFixed(4)}, other amplitudes ${state.nonTargetAmplitude.toFixed(4)},` +
    ` mean ${state.mean.toFixed(4)}.${phaseNote}` +
    ` Success probability ${(state.successProbability * 100).toFixed(1)}%.`
  );
}

/* ── Amplitude values panel ────────────────────────────── */
function renderAmpValues(state: GroverSubStep): void {
  ampValues.innerHTML =
    `<span class="highlight">Target amplitude:     ${fmtAmp(state.targetAmplitude)}</span>  → <span class="prob">probability: ${(state.successProbability * 100).toFixed(2)}%</span>\n` +
    `Other amplitude:      ${fmtAmp(state.nonTargetAmplitude)}  (each of the ${(N - 1).toLocaleString()} non-target states)\n` +
    `Mean amplitude:       ${fmtAmp(state.mean)}\n\n` +
    `<span style="color:var(--text-dim);font-size:.7rem">Classically simulated amplitude evolution (not a real quantum computation)</span>`;
}

function fmtAmp(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(4);
}

/* ── Math layer: the algebra view, with the current numbers plugged in ── */
function renderMathLayer(state: GroverSubStep): void {
  const theta = Math.asin(1 / Math.sqrt(state.N));
  const effK = state.effectiveIteration;
  const angleDeg = deg(state.angle).toFixed(2);

  // (2k+1)θ for resting states; the oracle reflects to the negative angle.
  const angleLine = state.subPhase === 'oracle'
    ? `angle = −(2k+1)·θ = −(2·${currentK}+1)·${deg(theta).toFixed(2)}° = ${angleDeg}°`
    : `angle = (2k+1)·θ = (2·${effK}+1)·${deg(theta).toFixed(2)}° = ${angleDeg}°`;

  mathLayer.innerHTML =
    `<span class="ml-term">θ = asin(1/√N) = asin(1/√${state.N.toLocaleString()}) = ${deg(theta).toFixed(2)}°</span>\n` +
    `<span class="ml-term">${angleLine}</span>\n` +
    `<span class="ml-term hot">P(target) = sin²(angle) = ${(state.successProbability * 100).toFixed(2)}%</span>\n` +
    `<span class="ml-term">k* = ⌊π / (4θ)⌋ = ${state.optimalIterations}` +
    ` ·  query cost ≈ O(√N) = O(√${state.N.toLocaleString()})</span>\n` +
    `<span class="ml-note">k* is floored — the rotation rarely lands exactly on the target axis, so the optimum is approximate. ` +
    `Algebra (sin²), geometry (the rotation), and amplitudes (oracle flip + diffusion) are three views of this one state.</span>`;
}

/* ── Measurement simulator: sampling makes "amplitude ≠ certainty" concrete ── */
function resetMeasurement(): void {
  measureDots.innerHTML = '';
  const sub = simulateGroverSubStep(n, targetIndex, currentK, subPhase);
  measureStats.textContent =
    `Each measurement returns one outcome, with P(target) = ${(sub.successProbability * 100).toFixed(1)}%. ` +
    `Press "Measure ×100" to sample the current state.`;
}

function runMeasurements(): void {
  const sub = simulateGroverSubStep(n, targetIndex, currentK, subPhase);
  const p = sub.successProbability;
  const shots = 100;
  let hits = 0;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < shots; i++) {
    const hit = cryptoUnitInterval() < p;
    if (hit) hits += 1;
    const dot = document.createElement('span');
    dot.className = `m-dot ${hit ? 'hit' : 'miss'}`;
    frag.appendChild(dot);
  }
  measureDots.innerHTML = '';
  measureDots.appendChild(frag);

  const theoretical = (p * 100).toFixed(1);
  measureStats.innerHTML =
    `<span class="m-hit-text">■ Target: ${hits}/100</span> ` +
    `<span class="m-miss-text">■ Wrong: ${shots - hits}/100</span> ` +
    `Empirical success: <strong>${hits}%</strong> Theoretical: <strong>${theoretical}%</strong>`;

  liveRegion.textContent =
    `Measured 100 times at k=${sub.effectiveIteration}: ${hits} target outcomes, ` +
    `${shots - hits} wrong outcomes. Theoretical success ${theoretical}%.`;
}

/* ── Reactive misconception panel ──────────────────────────
 * Surfaces the correction at the moment a learner is most likely to form the
 * wrong idea — keyed to the current sub-step and where we are on the curve. */
function renderMisconception(state: GroverSubStep): void {
  const effK = state.effectiveIteration;
  const kStar = state.optimalIterations;
  let myth: string;
  let reality: string;

  if (decompose && state.subPhase === 'oracle') {
    myth = 'The oracle “checks every key at once” and tells Grover the answer.';
    reality = 'The oracle only flips the *phase* of the marked state (its amplitude goes negative). It never reveals which key is correct — the information is hidden in interference, not read out.';
  } else if (decompose && state.subPhase === 'diffusion') {
    myth = 'Diffusion “measures” the state and keeps the best amplitude.';
    reality = 'Diffusion is a deterministic reflection of every amplitude about their mean — no measurement happens. The phase-flipped target ends up above the mean, so it grows; nothing is observed yet.';
  } else if (effK > kStar) {
    myth = 'More Grover iterations are always better.';
    reality = 'Past k* the state vector rotates *beyond* the target axis, so success probability falls again. Grover needs the right number of steps, not the most.';
  } else if (effK === kStar && effK > 0) {
    myth = 'At k* the answer is guaranteed.';
    reality = `At k* probability peaks (~${(state.successProbability * 100).toFixed(0)}%) but measurement is still a sample, not a certainty. Press “Measure ×100” to see the spread.`;
  } else {
    myth = 'Quantum search tries all keys in parallel and then reads the winner.';
    reality = 'Amplitudes interfere so the marked state grows and the rest shrink; measurement is probabilistic. This is a quadratic (√N) speedup — not the exponential break Shor gives RSA.';
  }

  misconceptionEl.innerHTML =
    `<div class="mc-myth"><span class="mc-tag">Myth ✗</span> ${myth}</div>` +
    `<div class="mc-real"><span class="mc-tag real">Reality ✓</span> ${reality}</div>`;
}

/* ── Compare the mental models: algebra / geometry / amplitudes ──
 * Three routes to the same fact. Each lens gets the overshoot explanation it
 * tells best, and we highlight the matching visual. */
function renderMentalModels(state: GroverSubStep): void {
  const theta = Math.asin(1 / Math.sqrt(state.N));
  const angleDeg = deg(state.angle).toFixed(0);
  const thetaDeg = deg(theta).toFixed(1);

  const views: Record<MentalView, { label: string; text: string }> = {
    algebra: {
      label: 'Algebra',
      text: `P(target) = sin²((2k+1)·θ), with θ = ${thetaDeg}°. Overshoot is when (2k+1)·θ climbs past 90°: sin² peaks at 90° and then *decreases*, so extra iterations lower the probability.`,
    },
    geometry: {
      label: 'Geometry',
      text: `The state is a unit vector at ${angleDeg}° from the wrong-answer axis; each step rotates it +2θ (${(2 * deg(theta)).toFixed(1)}°) toward |target⟩ at 90°. Overshoot is simply rotating *past* vertical — the vector’s height (the amplitude) starts shrinking.`,
    },
    amplitudes: {
      label: 'Amplitudes',
      text: `Each step the oracle flips the target amplitude negative, then diffusion reflects every amplitude about their mean. Once the target is already the tallest bar, reflecting about the mean overshoots it back downward — that is overshoot, bar by bar.`,
    },
  };

  mentalBtns.forEach((b) => {
    const active = b.dataset.view === mentalView;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });

  const v = views[mentalView];
  mentalBox.innerHTML =
    `<p><strong>${v.label} — why overshoot happens:</strong> ${v.text}</p>` +
    `<p class="mm-hint">Switch lenses above: each explains the <em>same</em> overshoot a different way. Which one clicks for you?</p>`;

  // Highlight the visual that matches the chosen lens.
  vizRotation.classList.toggle('mm-highlight', mentalView === 'geometry');
  vizAmplitudes.classList.toggle('mm-highlight', mentalView === 'amplitudes');
  mathLayer.classList.toggle('mm-highlight', mentalView === 'algebra');
}

/* ── Probability curve canvas ──────────────────────────── */
function renderProbCurve(state: GroverSubStep): void {
  const effK = state.effectiveIteration;
  const curve = simulateProbabilityCurve(n);
  const canvas = probCanvas;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;
  const pad = { l: 40, r: 16, t: 16, b: 28 };

  const kStar = state.optimalIterations;
  const maxK = curve.length - 1 || 1;

  function x(k: number) { return pad.l + (k / maxK) * (W - pad.l - pad.r); }
  function y(p: number) { return pad.t + (1 - p) * (H - pad.t - pad.b); }

  /* Grid */
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#1e293b';
  ctx.lineWidth = 0.5;
  for (let p = 0; p <= 1; p += 0.25) {
    ctx.beginPath(); ctx.moveTo(pad.l, y(p)); ctx.lineTo(W - pad.r, y(p)); ctx.stroke();
  }

  /* Axis labels */
  const dimColor = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || '#94a3b8';
  ctx.fillStyle = dimColor;
  ctx.font = '10px Courier New';
  ctx.textAlign = 'right';
  for (let p = 0; p <= 1; p += 0.25) {
    ctx.fillText(`${(p * 100).toFixed(0)}%`, pad.l - 4, y(p) + 3);
  }
  ctx.textAlign = 'center';
  ctx.fillText('k →', W / 2, H - 2);

  /* Optimal k* line */
  const goldColor = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#ffd700';
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x(kStar), pad.t); ctx.lineTo(x(kStar), H - pad.b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = goldColor;
  ctx.font = '9px Courier New';
  ctx.fillText(`k*=${kStar}`, x(kStar), pad.t - 3);

  /* Curve line */
  const magentaColor = getComputedStyle(document.documentElement).getPropertyValue('--magenta').trim() || '#ff00ff';
  ctx.strokeStyle = magentaColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i]!;
    const px = x(pt.iteration);
    const py = y(pt.probability);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  /* Optimal dot */
  const optPt = curve.find(p => p.isOptimal);
  if (optPt) {
    ctx.fillStyle = goldColor;
    ctx.beginPath();
    ctx.arc(x(optPt.iteration), y(optPt.probability), 5, 0, Math.PI * 2);
    ctx.fill();

    /* "Optimal stopping point" label */
    ctx.font = '9px Courier New';
    ctx.fillStyle = goldColor;
    ctx.textAlign = 'right';
    ctx.fillText('Optimal stopping point', x(optPt.iteration) - 8, y(optPt.probability) - 8);
  }

  /* Current position dot */
  const curPt = curve.find(p => p.iteration === effK);
  if (curPt) {
    ctx.fillStyle = magentaColor;
    ctx.beginPath();
    ctx.arc(x(curPt.iteration), y(curPt.probability), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Overshoot label */
  if (maxK > kStar) {
    ctx.fillStyle = dimColor;
    ctx.font = '8px Courier New';
    ctx.textAlign = 'left';
    ctx.fillText('Overshoot \u2014 probability decreases', x(kStar) + 8, pad.t + 12);
  }

  canvas.setAttribute('aria-label',
    `Probability curve: ${curve.length} points. Current k=${effK}, probability ${((curPt?.probability ?? 0) * 100).toFixed(1)}%. Peak at k*=${kStar}.`
  );
}

/* ── Geometric rotation view ───────────────────────────────
 * Grover lives in the 2-D plane spanned by |target⟩ (vertical axis) and the
 * uniform mix of every wrong answer (horizontal axis). The state is a unit
 * vector; each iteration rotates it by 2θ toward the target axis. Success
 * probability is the squared vertical projection, sin²(angle) — which is why
 * rotating PAST vertical (overshoot) lowers it again. */
function renderRotation(sub: GroverSubStep): void {
  const canvas = rotationCanvas;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;
  // Bail if the canvas is laid out too small to draw — otherwise the radius
  // below goes negative and ctx.arc() throws. A later render fixes it.
  if (W < 64 || H < 64) return;

  const css = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const dim = css('--text-dim', '#94a3b8');
  const border = css('--border', '#1e293b');
  const magenta = css('--magenta', '#ff00ff');
  const gold = css('--gold', '#ffd700');
  const blue = css('--dim-blue', '#1a4a8a');
  const textCol = css('--text', '#e2e8f0');

  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 30;
  const pt = (ang: number, r = R) => ({ x: cx + r * Math.cos(ang), y: cy - r * Math.sin(ang) });

  const theta = Math.asin(1 / Math.sqrt(sub.N));
  const kStar = sub.optimalIterations;

  function vector(ang: number, color: string, width: number, alpha = 1): void {
    const tip = pt(ang);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    // arrowhead
    const head = 9;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - head * Math.cos(ang - 0.4), tip.y + head * Math.sin(ang - 0.4));
    ctx.lineTo(tip.x - head * Math.cos(ang + 0.4), tip.y + head * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* Unit circle */
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  /* Axes */
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke(); // non-target
  ctx.strokeStyle = magenta;
  ctx.globalAlpha = 0.45;
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke(); // target axis
  ctx.globalAlpha = 1;

  /* Axis labels */
  ctx.font = '11px Courier New';
  ctx.fillStyle = magenta;
  ctx.textAlign = 'center';
  ctx.fillText('|target⟩', cx, cy - R - 10);
  ctx.fillStyle = dim;
  ctx.textAlign = 'left';
  ctx.fillText('wrong answers →', cx + 6, cy - 8);

  /* Accumulated-rotation arc from the +x axis up to the current angle */
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const arcEnd = sub.angle >= 0 ? sub.angle : 0;
  ctx.arc(cx, cy, 26, 0, -arcEnd, sub.angle >= 0);
  ctx.stroke();

  /* Sub-step ghosts: show the reflection / prior vector when decomposing */
  if (decompose) {
    const prePhi = (2 * currentK + 1) * theta; // pre-oracle superposition angle
    if (sub.subPhase === 'oracle') {
      vector(prePhi, blue, 2, 0.4); // faint pre-oracle vector
      // dashed reflection across the non-target (x) axis
      const a = pt(prePhi), b = pt(sub.angle);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = dim;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    } else if (sub.subPhase === 'diffusion') {
      vector(-prePhi, blue, 2, 0.4); // faint post-oracle vector (before diffusion)
    }
  }

  /* The state vector */
  vector(sub.angle, magenta, 3);

  /* Projection onto the target axis = target amplitude (= sin angle) */
  const tip = pt(sub.angle);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = gold;
  ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(cx, tip.y); ctx.stroke();
  ctx.restore();

  /* Readout */
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px Courier New';
  ctx.fillStyle = textCol;
  const deg = (sub.angle * 180 / Math.PI);
  ctx.fillText(`angle = ${deg.toFixed(1)}°   (2θ per step, θ = ${(theta * 180 / Math.PI).toFixed(1)}°)`, cx, H - 22);
  ctx.fillStyle = gold;
  ctx.font = '11px Courier New';
  ctx.fillText(`P(target) = sin²(angle) = ${(sub.successProbability * 100).toFixed(1)}%`, cx, H - 6);

  canvas.setAttribute('aria-label',
    `Grover rotation diagram. The state vector is at ${deg.toFixed(0)} degrees from the wrong-answer axis;` +
    ` the target axis is at 90 degrees. Each iteration rotates by ${(2 * theta * 180 / Math.PI).toFixed(0)} degrees.` +
    ` Optimal stopping is k* = ${kStar} iterations, where the vector is closest to the target axis.`
  );
}

/* ── Race panel ────────────────────────────────────────── */
function renderRace(): void {
  const kStar = simulateGroverState(n, targetIndex, 0).optimalIterations;
  const quantumQueries = groverQueryCount(n);
  const classicalExpected = N / 2;

  /* Stats text */
  raceClassicalStats.textContent =
    `Strategy: try random keys until target found\n` +
    `Expected queries: N/2 = ${classicalExpected.toLocaleString()}\n` +
    (n <= 20 ? '' : `For n=${n}: 2^${n - 1} queries\n`) +
    (n === 128 ? 'At 10^15 queries/sec: ~10^23 seconds (~10^15 years)' : '');

  raceQuantumStats.textContent =
    `Strategy: amplitude amplification\n` +
    `Queries: k* = ${kStar.toLocaleString()} (total: ${quantumQueries.toLocaleString()})\n` +
    (n === 128 ? 'At 10^9 quantum ops/sec: ~10^10 seconds (~317 years)' : '');

  /* Shared-scale race: both bars live on ONE query-time axis, so equal width
     means equal oracle queries. Grover (k* queries) finishes while the
     classical search (≈N/2 queries) is still far from done — the honest
     picture the old per-bar normalisation hid. */
  if (raceTimer !== null) { clearInterval(raceTimer); raceTimer = null; }
  if (raceTimeout !== null) { clearTimeout(raceTimeout); raceTimeout = null; }

  const quantumQ = quantumQueries;                       // ~2k*+1 queries to find
  const classicalQ = classicalExpected;                  // ~N/2 queries expected
  const pQuantum = Math.min(1, quantumQ / classicalQ);   // fraction of timeline when Grover finds
  // Keep the quantum bar visible even when it's a sliver of the classical work.
  const quantumDisplayW = Math.max(1.5, pQuantum * 100);

  raceQuantumBar.classList.remove('found');
  raceClassicalBar.style.width = '0%';
  raceQuantumBar.style.width = '0%';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function settle(): void {
    raceClassicalBar.style.width = '100%';
    raceQuantumBar.style.width = `${quantumDisplayW}%`;
    raceQuantumBar.classList.add('found');
    raceQuantumStatus.textContent = `✓ Found after k* = ${kStar.toLocaleString()} queries`;
    raceClassicalStatus.textContent = `scanned ~${classicalQ.toLocaleString()} keys to match`;
  }

  if (reduceMotion || n > 16) {
    settle();
  } else {
    const tickMs = 50;
    const totalTicks = 70; // ~3.5s sweep across the full classical timeline
    let t = 0;
    function tick(): void {
      t += 1;
      const p = Math.min(1, t / totalTicks);
      const classicalW = p * 100;
      const quantumW = Math.min(100, (p / pQuantum) * 100);
      raceClassicalBar.style.width = `${classicalW}%`;
      // Snap the quantum bar to its (possibly sliver) display width once found.
      const found = quantumW >= 100;
      raceQuantumBar.style.width = found ? `${quantumDisplayW}%` : `${quantumW}%`;
      if (found) {
        raceQuantumBar.classList.add('found');
        raceQuantumStatus.textContent = `✓ Found after k* = ${kStar.toLocaleString()} queries`;
      } else {
        raceQuantumStatus.textContent = 'amplifying…';
      }
      raceClassicalStatus.textContent = `scanned ~${Math.round((classicalW / 100) * classicalQ).toLocaleString()} of ${classicalQ.toLocaleString()} keys`;
      if (p >= 1) { if (raceTimer !== null) { clearInterval(raceTimer); raceTimer = null; } }
    }
    raceTimer = window.setInterval(tick, tickMs);
  }

  /* Speedup table */
  const rows = [
    { n: 4, speedup: '4\u00D7', log: 2 },
    { n: 8, speedup: '16\u00D7', log: 4 },
    { n: 16, speedup: '256\u00D7', log: 8 },
    { n: 64, speedup: '2^32 \u2248 4 billion\u00D7', log: 32 },
    { n: 128, speedup: '2^64 \u2248 18 quintillion\u00D7', log: 64 },
  ];
  const maxLog = 64;
  speedupBody.innerHTML = rows.map(r =>
    `<tr>
      <td>n=${r.n}</td>
      <td>${r.speedup}</td>
      <td><div class="speedup-bar" style="width:${(r.log / maxLog) * 100}%"></div></td>
    </tr>`
  ).join('');
}

/* ── Signature feature: Why Grover Doesn't Break AES ───── */
const AES_SIGNATURE_DATA: Record<number, {
  keyBits: number;
  classical: string;
  grover: string;
  reality: string;
  explanation: string;
}> = {
  128: {
    keyBits: 128,
    classical: '2^128',
    grover: '2^64',
    reality: 'Potentially feasible for a very large quantum computer, but circuit depth (~2^82 qubit-cycles) makes this far harder than headline numbers suggest.',
    explanation: `Grover's algorithm reduces brute-force search from 2^128 to ~2^64 operations under idealized assumptions.\n\nWhile this is a major theoretical improvement, it does not represent a practical near-term attack due to:\n• quantum circuit depth (~2^82 logical qubit-cycles per Grassl et al.)\n• oracle construction cost (each iteration runs a full AES-128 circuit coherently)\n• error correction requirements (~2,953 logical qubits needed)\n\nAES-128 is often discussed as having ~64-bit effective brute-force resistance under idealized Grover assumptions. NIST recommends upgrading to AES-256 for post-quantum security.`,
  },
  192: {
    keyBits: 192,
    classical: '2^192',
    grover: '2^96',
    reality: 'Still infeasible — 2^96 idealized operations with deep circuits per iteration.',
    explanation: `Grover's algorithm reduces brute-force search from 2^192 to ~2^96 operations under idealized assumptions.\n\nWhile 2^96 is significantly smaller than 2^192, it remains well beyond foreseeable quantum capability due to:\n• quantum circuit depth (~2^114 logical qubit-cycles)\n• oracle construction cost (AES-192 circuit is deeper than AES-128)\n• error correction requirements (~4,449 logical qubits needed)\n\nAES-192 retains a strong security margin, though NIST recommends AES-256 for maximum post-quantum assurance.`,
  },
  256: {
    keyBits: 256,
    classical: '2^256',
    grover: '2^128',
    reality: 'Still infeasible — 2^128 operations remains far beyond any foreseeable capability.',
    explanation: `Grover's algorithm reduces brute-force search from 2^256 to ~2^128 operations under idealized assumptions.\n\nEven with a quadratic speedup, 2^128 operations is an astronomically large number:\n• quantum circuit depth (~2^146 logical qubit-cycles)\n• oracle construction cost (AES-256 has the deepest circuit of all three)\n• error correction requirements (~6,681 logical qubits needed)\n\nAES-256 is recommended by NIST (CNSA 2.0) as the standard for post-quantum symmetric encryption. The 2^128 effective security margin is considered strong for the foreseeable future.`,
  },
};

function renderSignatureFeature(): void {
  const selector = $('#key-selector') as HTMLSelectElement;
  const keyBits = parseInt(selector.value, 10);
  const data = AES_SIGNATURE_DATA[keyBits]!;

  const exampleBox = $('#aes-example');
  exampleBox.innerHTML =
    `<div class="sig-row"><span class="sig-label">Classical brute force:</span><span class="sig-value">${data.classical}</span></div>` +
    `<div class="sig-row"><span class="sig-label">Grover (idealized):</span><span class="sig-value magenta">${data.grover}</span></div>` +
    `<div class="sig-row"><span class="sig-label">Reality:</span><span class="sig-value amber">${data.reality}</span></div>`;

  const explanationBox = $('#aes-explanation');
  explanationBox.textContent = data.explanation;
}

/* ── Deep link: ?sub=1&steps=N restores a specific state ─── */
function applyDeepLink(): void {
  const p = new URLSearchParams(location.search);

  // ?n= resizes the search space (and reseeds the target so it stays valid).
  const nParam = parseInt(p.get('n') ?? '', 10);
  if (Number.isInteger(nParam) && nParam >= 2 && nParam <= 20) {
    n = nParam;
    N = 2 ** n;
    nSlider.value = String(n);
    nSlider.setAttribute('aria-valuenow', String(n));
    targetIndex = cryptoRandomBelow(N);
  }

  // ?target= pins a specific marked item for reproducible lessons.
  const tParam = parseInt(p.get('target') ?? '', 10);
  if (Number.isInteger(tParam) && tParam >= 0 && tParam < N) {
    targetIndex = tParam;
  }

  if (p.get('sub') === '1') { decompose = true; decomposeToggle.checked = true; }
  const requested = parseInt(p.get('steps') ?? '0', 10);
  const steps = Number.isFinite(requested) ? Math.max(0, Math.min(400, requested)) : 0;
  for (let i = 0; i < steps; i++) { if (!advance()) break; }
}

/* ── Initial render ────────────────────────────────────── */
applyDeepLink();
renderState();
renderRace();
renderSignatureFeature();

// ?measure=1 draws a sample immediately (renderState clears it, so run it after).
if (new URLSearchParams(location.search).get('measure') === '1') runMeasurements();

$('#key-selector').addEventListener('change', () => renderSignatureFeature());

/* ── Compare-the-mental-models toggle ──────────────────── */
mentalBtns.forEach((b) => {
  b.addEventListener('click', () => {
    mentalView = (b.dataset.view as MentalView) ?? 'geometry';
    renderState();
  });
});

/* ── Guided lesson mode ────────────────────────────────── */
interface LessonStage { title: string; body: string; apply: () => void; }

function setN(next: number): void {
  n = next;
  N = 2 ** n;
  nSlider.value = String(n);
  nSlider.setAttribute('aria-valuenow', String(n));
}

const LESSON: LessonStage[] = [
  {
    title: '1 · The search problem',
    body: `<p>We have <strong>N = 2⁴ = 16</strong> possible keys and exactly <strong>one</strong> is correct. A classical attacker tries keys at random and expects to check about <strong>N/2 = 8</strong> before hitting it.</p>
<p>Grover will find it in only about <strong>√N ≈ 4</strong> oracle queries. Watch the bars below: right now every key is equally likely.</p>
<p class="lesson-do">Try it: when you press <em>Next</em>, we’ll run one Grover step as its two halves.</p>`,
    apply: () => { setN(4); targetIndex = 7; decompose = false; decomposeToggle.checked = false; currentK = 0; subPhase = 'superposition'; renderState(); document.getElementById('panel-a')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  },
  {
    title: '2 · One step = oracle + diffusion',
    body: `<p>Sub-steps are now on. The <strong>oracle</strong> flips the target amplitude <em>negative</em> (its bar drops below the zero line) — it marks the answer with a phase, it does not reveal it.</p>
<p>Press <em>Step</em> once more to run <strong>diffusion</strong>: every amplitude is reflected about the mean (the gold line), which lifts the marked one up. Together they are one rotation.</p>`,
    apply: () => { setN(4); targetIndex = 7; decompose = true; decomposeToggle.checked = true; currentK = 0; subPhase = 'oracle'; renderState(); document.getElementById('panel-a')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  },
  {
    title: '3 · It’s a rotation',
    body: `<p>Each full iteration rotates the state vector by <strong>2θ</strong> toward the |target⟩ axis (see the rotation view). Success probability is the squared height, <strong>sin²((2k+1)θ)</strong>.</p>
<p>For N = 16, θ ≈ 14.5°, so the optimum is <strong>k* = 3</strong> iterations. We’re at k = 1 now — still climbing.</p>`,
    apply: () => { setN(4); targetIndex = 7; decompose = false; decomposeToggle.checked = false; currentK = 1; subPhase = 'superposition'; renderState(); document.getElementById('panel-a')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  },
  {
    title: '4 · Overshoot',
    body: `<p>We’ve jumped to <strong>k = 6 = 2·k*</strong>. Notice the probability has fallen back near zero: the vector rotated <em>past</em> the target axis.</p>
<p>This is why “just run more iterations” is wrong — Grover needs the <em>right</em> count, not the most. The probability curve makes the oscillation obvious.</p>`,
    apply: () => { setN(4); targetIndex = 7; decompose = false; decomposeToggle.checked = false; currentK = maxIterations(); subPhase = 'superposition'; renderState(); document.getElementById('panel-a')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  },
  {
    title: '5 · What it means for crypto',
    body: `<p>The same math sets the cost of attacking AES. A brute-force key search over 2¹²⁸ keys needs ~2⁶⁴ Grover iterations — key length is effectively <strong>halved</strong>.</p>
<p>But each iteration runs a full AES circuit coherently, so the real cost (≈2⁸² qubit-cycles for AES-128) is far higher. <strong>AES-256</strong> keeps a 2¹²⁸ margin and stays strong. Grover ≠ Shor: this is a quadratic dent, not an exponential break.</p>
<p>Next, open <strong>“The Real Cost of One Oracle Call”</strong> to see iterations separated from cost-per-call, and <strong>“Assumptions &amp; Sources”</strong> for the references behind these numbers.</p>
<p class="lesson-do">Press <em>Finish</em> to jump to Challenge mode and test yourself.</p>`,
    apply: () => { renderSignatureFeature(); document.getElementById('panel-c')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  },
];

function showLessonStage(): void {
  const s = LESSON[lessonStage]!;
  s.apply();
  lessonBody.innerHTML = `<h3 class="lesson-title">${s.title}</h3>${s.body}`;
  lessonProgress.textContent = `Stage ${lessonStage + 1} of ${LESSON.length}`;
  lessonPrevBtn.disabled = lessonStage === 0;
  lessonNextBtn.textContent = lessonStage === LESSON.length - 1 ? 'Finish ✓' : 'Next →';
}

function startLesson(): void {
  lessonStage = 0;
  stopAuto();
  lessonStartBtn.style.display = 'none';
  lessonNav.style.display = 'flex';
  lessonBody.style.display = 'block';
  showLessonStage();
}

function exitLesson(): void {
  lessonStage = -1;
  lessonStartBtn.style.display = '';
  lessonNav.style.display = 'none';
  lessonBody.style.display = 'none';
  lessonBody.innerHTML = '';
  lessonProgress.textContent = '';
}

lessonStartBtn.addEventListener('click', startLesson);
lessonExitBtn.addEventListener('click', exitLesson);
lessonPrevBtn.addEventListener('click', () => { if (lessonStage > 0) { lessonStage--; showLessonStage(); } });
lessonNextBtn.addEventListener('click', () => {
  if (lessonStage >= LESSON.length - 1) {
    exitLesson();
    // Finishing routes the learner onward to self-assessment.
    document.getElementById('panel-challenge')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  lessonStage++;
  showLessonStage();
});

/* ── Interactive oracle cost budget ────────────────────── */
const budgetSelector = $('#budget-selector') as HTMLSelectElement;
function renderBudget(): void {
  const bits = parseInt(budgetSelector.value, 10) as 128 | 192 | 256;
  const a = analyzeKeySize(bits);
  const c = aesQuantumCost(bits);
  const iterExp = bits / 2;                         // ≈2^(n/2) Grover iterations
  const perIterExp = c.circuitDepthExponent - iterExp; // cost of ONE oracle call
  const box = $('#budget-box');
  box.innerHTML =
    `<div class="budget-grid">` +
    `<div class="budget-row"><span>Grover iterations (oracle calls)</span><span class="bv">≈ 2^${iterExp}</span></div>` +
    `<div class="budget-op">×</div>` +
    `<div class="budget-row"><span>Cost per oracle call (one full AES-${bits} circuit, coherent)</span><span class="bv">≈ 2^${perIterExp} qubit-cycles</span></div>` +
    `<div class="budget-op">=</div>` +
    `<div class="budget-row total"><span>Total circuit depth (idealized lower bound)</span><span class="bv hot">≈ 2^${c.circuitDepthExponent} qubit-cycles</span></div>` +
    `<div class="budget-row"><span>Logical qubits required</span><span class="bv">~${c.logicalQubits.toLocaleString()}</span></div>` +
    `<div class="budget-row"><span>Practical threat</span><span class="bv ${a.practicalThreat === 'strong' ? 'ok' : 'warn'}">${a.practicalThreat.toUpperCase()}</span></div>` +
    `</div>` +
    `<p class="budget-note">${c.note}</p>` +
    `<p class="budget-caveat">⚠ Lower-bound–style estimate (Grassl et al. 2016), <strong>not</strong> a wall-clock prediction. The headline “2^${iterExp}” counts <em>iterations</em>; the real work is iterations × cost-per-iteration. That gap is the difference between pop-science Grover and serious cost analysis.</p>`;
}
budgetSelector.addEventListener('change', renderBudget);
renderBudget();

/* ── Challenge mode ────────────────────────────────────── */
interface Challenge { q: string; options: { label: string; correct: boolean }[]; explain: string; }
const CHALLENGES: Challenge[] = [
  {
    q: 'For n = 5 (N = 32), about how many Grover iterations are optimal (k*)?',
    options: [{ label: '2', correct: false }, { label: '4', correct: true }, { label: '16', correct: false }, { label: '32', correct: false }],
    explain: 'k* = ⌊π/(4θ)⌋ with θ = asin(1/√32) ≈ 10.2°, giving ⌊4.42⌋ = 4. It scales like √N ≈ 5.7, not N.',
  },
  {
    q: 'With sub-steps on, which step flips the target amplitude negative?',
    options: [{ label: 'Oracle', correct: true }, { label: 'Diffusion', correct: false }, { label: 'Measurement', correct: false }],
    explain: 'The oracle reflects across the non-target axis — it negates (phase-flips) the target amplitude. Diffusion then reflects about the mean.',
  },
  {
    q: 'Under idealized Grover assumptions, the effective cost of attacking AES-256 is about…',
    options: [{ label: '2^64', correct: false }, { label: '2^96', correct: false }, { label: '2^128', correct: true }],
    explain: 'Grover halves the effective key length: 2^256 → 2^128. That remains far beyond any foreseeable capability, which is why NIST/CNSA recommends AES-256.',
  },
  {
    q: 'Is Shor’s algorithm a threat to AES?',
    options: [{ label: 'Yes — it breaks AES', correct: false }, { label: 'No — Shor targets public-key crypto', correct: true }],
    explain: 'Shor breaks RSA/ECC/Diffie-Hellman (factoring & discrete log). AES is symmetric; only Grover applies, and only as a quadratic speedup.',
  },
  {
    q: 'True or false: running more Grover iterations always increases success probability.',
    options: [{ label: 'True', correct: false }, { label: 'False', correct: true }],
    explain: 'False — past k* the state vector rotates beyond the target axis and probability decreases (overshoot). The probability curve oscillates.',
  },
];

function renderChallenges(): void {
  const list = $('#challenge-list');
  list.innerHTML = '';
  CHALLENGES.forEach((ch, i) => {
    const card = document.createElement('div');
    card.className = 'challenge-card';
    const qEl = document.createElement('p');
    qEl.className = 'challenge-q';
    qEl.textContent = `${i + 1}. ${ch.q}`;
    card.appendChild(qEl);

    const opts = document.createElement('div');
    opts.className = 'challenge-opts';
    const feedback = document.createElement('div');
    feedback.className = 'challenge-feedback';

    ch.options.forEach((o) => {
      const btn = document.createElement('button');
      btn.className = 'btn challenge-opt';
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        if (card.classList.contains('answered')) return;
        card.classList.add('answered');
        btn.classList.add(o.correct ? 'correct' : 'incorrect');
        // Always reveal the correct option.
        if (!o.correct) {
          Array.from(opts.children).forEach((c, idx) => {
            if (ch.options[idx]!.correct) c.classList.add('correct');
          });
        }
        feedback.innerHTML = `<span class="${o.correct ? 'fb-right' : 'fb-wrong'}">${o.correct ? '✓ Correct.' : '✗ Not quite.'}</span> ${ch.explain}`;
      });
      opts.appendChild(btn);
    });

    card.appendChild(opts);
    card.appendChild(feedback);
    list.appendChild(card);
  });
}
renderChallenges();

/* ── Build HTML ────────────────────────────────────────── */
function buildHTML(): string {
  const aesCards = ([128, 192, 256] as const).map(k => {
    const a = analyzeKeySize(k);
    const cost = aesQuantumCost(k);
    const cls = a.practicalThreat === 'strong' ? 'strong' : 'weakened';
    const icon = a.practicalThreat === 'strong' ? '\u2713' : '\u26A0';
    const threatCls = a.practicalThreat === 'strong' ? 'strong-text' : 'weakened-text';
    return `<div class="aes-card ${cls}">
      <h3>AES-${k}</h3>
      <div class="threat ${threatCls}">${icon} ${a.practicalThreat.toUpperCase()}</div>
      <div class="details">Classical: ${a.classicalOps}
Quantum:   ${a.quantumOps}

${a.recommendation}

Qubits needed: ~${cost.logicalQubits.toLocaleString()} logical
Circuit depth: 2^${cost.circuitDepthExponent}</div>
    </div>`;
  }).join('');

  const hashRows = [
    { name: 'MD5', bits: 128 },
    { name: 'SHA-1', bits: 160 },
    { name: 'SHA-256', bits: 256 },
    { name: 'SHA-384', bits: 384 },
    { name: 'SHA-512', bits: 512 },
    { name: 'SHA3-256', bits: 256 },
    { name: 'SHA3-512', bits: 512 },
  ].map(h => {
    const a = analyzeHashFunction(h.bits);
    const halfBits = h.bits / 2;
    let verdict: string;
    let cls: string;
    if (halfBits < 80) { verdict = 'BROKEN'; cls = 'broken'; }
    else if (halfBits < 128) { verdict = 'BROKEN'; cls = 'broken'; }
    else if (halfBits < 192) { verdict = 'ADEQUATE'; cls = 'adequate'; }
    else { verdict = 'VERY STRONG'; cls = 'strong-hash'; }
    // Override for well-known cases
    if (h.name === 'SHA-384') { verdict = 'STRONG'; cls = 'strong-hash'; }
    if (h.name === 'SHA-256' || h.name === 'SHA3-256') { verdict = 'ADEQUATE'; cls = 'adequate'; }
    return `<tr>
      <td>${h.name}</td><td>${h.bits}</td>
      <td>${a.classicalPreimage}</td><td>${a.quantumPreimage}</td>
      <td>${a.quantumCollision}</td>
      <td class="${cls}">${verdict}</td>
    </tr>`;
  }).join('');

  return `
<a href="#panel-a" class="skip-link">Skip to main content</a>

<main class="app">

  <header class="cl-hero">
    <div class="cl-hero-main">
      <h1 class="cl-hero-title">Grover's Algorithm</h1>
      <p class="cl-hero-sub">Quantum search · amplitude amplification · O(&radic;N)</p>
      <p class="cl-hero-desc">Step through Grover's search as a rotation toward the target: watch the amplitude climb to a peak at k* iterations, then overshoot back down if you run too far.</p>
    </div>
    <aside class="cl-hero-why" aria-label="Why it matters">
      <span class="cl-hero-why-label">WHY IT MATTERS</span>
      <p class="cl-hero-why-text">Grover gives only a quadratic speedup and touches just symmetric primitives &mdash; halving the effective bits of AES and hashes, not breaking them. That is why AES-256 stays safe and post-quantum worry centers on Shor, not Grover.</p>
    </aside>
  </header>

  <!-- Reality / Limits Panel -->
  <section class="reality-panel" id="reality-panel" aria-label="About this demo">
    <h2>About This Demo</h2>
    <div class="reality-grid">
      <div class="reality-col">
        <h3>\u2713 This demo is</h3>
        <ul>
          <li>A correct classical simulation of Grover's amplitude amplification using exact trigonometric formulas</li>
          <li>An educational tool for understanding the quadratic speedup and overshoot behavior of quantum search</li>
          <li>A visualization of Grover's impact on symmetric key sizes (AES-128/192/256) under idealized assumptions</li>
        </ul>
      </div>
      <div class="reality-col">
        <h3>\u2717 This demo is not</h3>
        <ul>
          <li>A quantum hardware execution — all computation is classical math in the browser</li>
          <li>A practical attack feasibility estimate — real costs include circuit depth, error correction, and oracle construction</li>
          <li>A model of decoherence, noise, gate synthesis, error-correction overhead, or wall-clock attack time — none of those are simulated here</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="insight-panel">
    <h2>What This Demonstrates</h2>
    <p>Most explanations of Grover's algorithm focus on the headline \u221AN speedup. This demo shows the full probability oscillation: amplitude rises to a peak at k* iterations, then <em>decreases</em> if you keep going. This overshoot behavior reveals why Grover's algorithm requires precise iteration count — and why "just run more iterations" is counterproductive. It also shows why the practical cost of attacking AES is dominated by circuit depth per iteration, not the number of oracle calls alone.</p>
  </section>

  <!-- Guided lesson -->
  <section class="panel lesson-panel" id="lesson-panel" aria-labelledby="lesson-heading">
    <h2 id="lesson-heading" class="panel-header">Guided Lesson</h2>
    <p class="lesson-intro">New to Grover? Take the 5-step guided path — it drives the simulator below stage by stage, from the search problem to the crypto impact. The free-play controls stay available the whole time.</p>
    <button class="btn lesson-start" id="lesson-start">▶ Start the guided lesson</button>
    <div class="lesson-body" id="lesson-body" style="display:none"></div>
    <div class="lesson-nav" id="lesson-nav" style="display:none">
      <button class="btn" id="lesson-prev">← Prev</button>
      <span class="lesson-progress" id="lesson-progress" aria-live="polite"></span>
      <button class="btn" id="lesson-next">Next →</button>
      <button class="btn lesson-exit" id="lesson-exit">Exit lesson</button>
    </div>
  </section>

  <!-- Panel A: Amplitude Visualizer -->
  <section class="panel" id="panel-a" aria-labelledby="panel-a-heading">
    <h2 id="panel-a-heading" class="panel-header">Grover's Algorithm &mdash; Amplitude Amplification</h2>

    <div class="controls">
      <label for="n-slider">Search space n qubits:</label>
      <input type="range" id="n-slider" min="2" max="20" value="4" aria-valuemin="2" aria-valuemax="20" aria-valuenow="4">
      <span class="value" id="n-value">N = 2^4 = 16</span>
    </div>

    <div class="controls">
      <button class="btn" id="random-btn">&#x1F3B2; Random target</button>
      <span id="target-display" style="font-family:var(--mono);font-size:.8rem;color:var(--text-dim)">Target: index 0 (0000)</span>
    </div>

    <div class="controls">
      <button class="btn" id="step-btn" title="Keyboard: \u2192">&#x25B6; Step</button>
      <button class="btn" id="auto-btn" title="Keyboard: Space">&#x25B6;&#x25B6; Auto-run</button>
      <button class="btn" id="reset-btn" title="Keyboard: R">&#x23F9; Reset</button>
      <label class="checkbox-label" for="decompose-toggle">
        <input type="checkbox" id="decompose-toggle">
        Show oracle + diffusion sub-steps
      </label>
      <label class="checkbox-label" for="predict-toggle">
        <input type="checkbox" id="predict-toggle">
        Prediction mode
      </label>
    </div>

    <div class="predict-prompt" id="predict-prompt" role="status" aria-live="polite" style="display:none"></div>

    <div class="iter-display" id="iter-display">Iteration: <span class="current">k = 0</span> / <span class="optimal">k* = 3</span></div>
    <div class="phase-label" id="phase-label" style="display:none"></div>

    <div class="viz-row">
      <div class="viz-cell" id="viz-rotation">
        <h3 class="viz-title">Grover rotation \u2014 why amplitude concentrates</h3>
        <canvas id="rotation-canvas" role="img" aria-label="Grover rotation diagram"></canvas>
        <p class="graph-caption">The state is a unit vector in the plane of |target&rang; (vertical) and all wrong answers (horizontal). Each iteration rotates it by 2&theta; toward the target axis; success probability is the squared height. Rotating past vertical is overshoot.</p>
      </div>
      <div class="viz-cell" id="viz-amplitudes">
        <h3 class="viz-title">Amplitudes \u2014 oracle flips, diffusion reflects</h3>
        <div class="bar-chart" id="bar-chart" role="img" aria-label="Signed amplitude bar chart"></div>
        <div class="bar-labels" id="bar-labels"></div>
        <p class="graph-caption">Bars rise above / fall below the zero line by sign. The gold line is the mean \u2014 the axis the diffusion step reflects every amplitude about.</p>
        <div class="amp-values" id="amp-values"></div>
      </div>
    </div>

    <div class="mental-models">
      <div class="mental-head">
        <span class="mental-label">Compare the mental models:</span>
        <div class="mental-switch" role="group" aria-label="Mental model view">
          <button class="mental-btn" data-view="algebra" aria-pressed="false">Algebra</button>
          <button class="mental-btn active" data-view="geometry" aria-pressed="true">Geometry</button>
          <button class="mental-btn" data-view="amplitudes" aria-pressed="false">Amplitudes</button>
        </div>
      </div>
      <div class="mental-box" id="mental-box" aria-live="polite"></div>
    </div>

    <div class="math-layer" id="math-layer" aria-label="Math layer: equations for the current state"></div>

    <div id="banner" class="banner"></div>

    <div class="misconception" id="misconception" aria-live="polite" aria-label="Common misconception for the current step"></div>

    <div class="prob-curve-wrap">
      <canvas id="prob-canvas" role="img" aria-label="Probability vs iteration curve"></canvas>
      <p class="graph-caption">Grover's success probability increases toward an optimum, then decreases if applied too many times. This oscillation is inherent to amplitude amplification.</p>
    </div>

    <div class="measure-box">
      <div class="controls">
        <button class="btn" id="measure-btn">&#x269B; Measure &times;100</button>
        <span class="measure-caption">Measurement collapses the state to a single outcome &mdash; you don't read off the amplitudes.</span>
      </div>
      <div class="measure-dots" id="measure-dots" role="img" aria-label="Measurement outcome grid"></div>
      <div class="measure-stats" id="measure-stats"></div>
    </div>

    <div class="oracle-box">ORACLE  f: {0,1}^n \u2192 {0,1}

f(x) = 1  if x is the target
f(x) = 0  otherwise

For AES key search:
f(key) = AES_encrypt(key, pt) == known ciphertext

The oracle is a BLACK BOX.
Grover does not see inside it.</div>

    <!-- WCAG: polite live region for screen readers -->
    <div id="live-region" aria-live="polite" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden"></div>
  </section>

  <!-- Bottom panels -->
  <div class="bottom-panels">
    <!-- Panel B: Race -->
    <section class="panel" id="panel-b" aria-labelledby="panel-b-heading">
      <h2 id="panel-b-heading" class="panel-header">Classical vs Quantum Search</h2>
      <div class="race-columns">
        <div class="race-col">
          <h3>Classical Search</h3>
          <div class="race-bar-wrap"><div class="race-bar classical" id="race-classical-bar" style="width:0%"></div></div>
          <div class="race-status" id="race-classical-status"></div>
          <div class="race-stats" id="race-classical-stats"></div>
        </div>
        <div class="race-col">
          <h3>Quantum Search (Grover)</h3>
          <div class="race-bar-wrap"><div class="race-bar quantum" id="race-quantum-bar" style="width:0%"></div></div>
          <div class="race-status" id="race-quantum-status"></div>
          <div class="race-stats" id="race-quantum-stats"></div>
        </div>
      </div>
      <p class="race-axis-note">Both bars share one timeline: equal width = equal number of oracle queries. Grover reaches the target in k* queries while the classical search is still scanning.</p>
      <table class="speedup-table">
        <caption class="sr-only">Quantum speedup scaling by search space size</caption>
        <thead><tr><th>n</th><th>Speedup</th><th>Scale</th></tr></thead>
        <tbody id="speedup-body"></tbody>
      </table>
    </section>

    <!-- Panel C: AES & Hash Impact -->
    <section class="panel" id="panel-c" aria-labelledby="panel-c-heading">
      <h2 id="panel-c-heading" class="panel-header">Impact on Symmetric Cryptography</h2>

      <div class="aes-cards">${aesCards}</div>

      <div class="insight-box">KEY INSIGHT: Under idealized assumptions, circuit depth matters more than the qubit count.

AES-128 requires ~2^82 logical qubit-cycles \u2014 not just 2^64 oracle calls.
Each Grover iteration requires running the entire AES circuit coherently
inside the quantum computer. This makes Grover attacks on AES significantly
more expensive in practice than the asymptotic 2^(n/2) figure suggests.

These are not practical attack estimates \u2014 they represent idealized lower bounds.

Source: Grassl et al. (2016); NIST/ETSI practical cost estimates (2024)</div>

      <div class="hash-table-wrap">
        <table class="hash-table">
          <caption class="sr-only">Hash function quantum impact analysis</caption>
          <thead><tr>
            <th>Hash</th><th>Output Bits</th>
            <th>Classical Preimage</th><th>Quantum Preimage (Grover)</th>
            <th>Quantum Collision (BHT)</th><th>Verdict</th>
          </tr></thead>
          <tbody>${hashRows}</tbody>
        </table>
      </div>
      <p class="table-note"><strong>Preimage vs collision are different stories.</strong> The Grover halving rule (2<sup>n</sup>&nbsp;&rarr;&nbsp;2<sup>n/2</sup>) is a <em>preimage</em> result. Quantum <em>collision</em> search (BHT, 2<sup>n/3</sup>) uses a different algorithm and is debated in practice — its large memory cost often makes the classical 2<sup>n/2</sup> birthday attack competitive. Don't generalize the key-halving rule to collisions.</p>

      <div class="fix-box">
        <h3>The Mitigation</h3>
        <p>Under idealized Grover assumptions, effective key length is halved. Doubling key length restores the original security margin.</p>
        <p style="margin-top:.5rem">AES-128 \u2192 AES-256 &ensp;(already standardized)<br>
SHA-256 \u2192 SHA-512 &ensp;(straightforward upgrade)<br>
HMAC-SHA-256 \u2192 HMAC-SHA-512</p>
        <p style="margin-top:.5rem">Unlike Shor\u2019s algorithm \u2014 which requires entirely new cryptographic
algorithms \u2014 Grover\u2019s threat to symmetric crypto is mitigated by a parameter change alone.</p>
        <p style="margin-top:.5rem">Post-quantum cryptography (ML-KEM, ML-DSA) is required for public-key
systems. For symmetric systems, longer keys are sufficient.</p>
      </div>

      <details>
        <summary>Grover vs Shor \u2014 The Two Quantum Threats</summary>
        <table class="compare-table">
          <caption class="sr-only">Comparison of Grover and Shor quantum algorithms</caption>
          <thead><tr><th scope="col"></th><th scope="col">Grover</th><th scope="col">Shor</th></tr></thead>
          <tbody>
            <tr><td>Targets</td><td>Symmetric crypto</td><td>Public-key crypto</td></tr>
            <tr><td>Speedup</td><td>Quadratic (\u221AN)</td><td>Exponential (poly)</td></tr>
            <tr><td>Impact on AES</td><td>Halves security</td><td>None</td></tr>
            <tr><td>Impact on RSA</td><td>None</td><td>Complete break</td></tr>
            <tr><td>Impact on ECC</td><td>None</td><td>Complete break</td></tr>
            <tr><td>Fix</td><td>Double key length</td><td>Replace algorithm</td></tr>
            <tr><td>NIST response</td><td>Recommend 256-bit keys</td><td>New standards (ML-KEM, ML-DSA)</td></tr>
          </tbody>
        </table>
        <p style="margin-top:.75rem;font-family:var(--mono);font-size:.72rem;color:var(--text-dim)">Grover is the lesser threat (quadratic speedup). Shor is the existential one (exponential speedup). Both must be addressed, but they require different responses. All speedup figures assume idealized quantum computation.</p>
      </details>
    </section>
  </div>

  <!-- Signature Feature: Why Grover Still Doesn't Break AES Instantly -->
  <section class="panel" id="panel-signature" aria-labelledby="signature-heading">
    <h2 id="signature-heading" class="panel-header">Why Grover Still Doesn't Break AES Instantly</h2>

    <div class="controls">
      <label for="key-selector">Key size:</label>
      <select id="key-selector" class="btn" style="min-width:120px;">
        <option value="128">AES-128</option>
        <option value="192">AES-192</option>
        <option value="256" selected>AES-256</option>
      </select>
    </div>

    <div id="aes-example" class="aes-example-box">
      <!-- populated by renderSignatureFeature() -->
    </div>

    <div id="aes-explanation" class="aes-explanation-box">
      <!-- populated by renderSignatureFeature() -->
    </div>
  </section>

  <!-- Scaling Insight -->
  <section class="panel" id="scaling" aria-labelledby="scaling-heading">
    <h2 id="scaling-heading" class="panel-header">Search Space Intuition</h2>
    <div class="scaling-grid">
      <div class="scaling-row"><span class="scaling-label">Classical brute force:</span><span class="scaling-value">2^128 operations</span></div>
      <div class="scaling-row"><span class="scaling-label">Grover (idealized):</span><span class="scaling-value magenta">2^64 operations</span></div>
    </div>
    <p class="scaling-note">Even 2<sup>64</sup> operations is still enormous — roughly 18.4 quintillion. Under idealized assumptions, this is the best any quantum algorithm can achieve for unstructured search (BBBV lower bound). In practice, circuit depth and error correction make the real cost far higher.</p>
  </section>

  <!-- Interactive oracle cost budget -->
  <section class="panel" id="panel-budget" aria-labelledby="budget-heading">
    <h2 id="budget-heading" class="panel-header">The Real Cost of One Oracle Call</h2>
    <p class="panel-intro">The headline “2^(n/2)” counts Grover <em>iterations</em>. The real attack cost is iterations × the cost of <em>each</em> oracle call — and every call runs a full AES circuit coherently inside the quantum computer. That separation is the difference between pop-science Grover and serious cost analysis.</p>
    <div class="controls">
      <label for="budget-selector">Key size:</label>
      <select id="budget-selector" class="btn" style="min-width:120px">
        <option value="128">AES-128</option>
        <option value="192">AES-192</option>
        <option value="256" selected>AES-256</option>
      </select>
    </div>
    <div id="budget-box"></div>
  </section>

  <!-- Source-traceable assumptions -->
  <section class="panel" id="panel-sources" aria-labelledby="sources-heading">
    <h2 id="sources-heading" class="panel-header">Assumptions &amp; Sources</h2>
    <details class="ref-details">
      <summary>Show the claim-by-claim source table</summary>
    <p class="panel-intro">Every headline number here traces to a published result. The simulation is idealized math (see “About This Demo”); these are the references behind the claims.</p>
    <table class="sources-table">
      <caption class="sr-only">Claims in this demo and their published sources</caption>
      <thead><tr><th scope="col">Claim</th><th scope="col">Source</th></tr></thead>
      <tbody>
        <tr><td>Grover search uses ≈√N oracle queries (quadratic speedup).</td><td>Grover, <em>A fast quantum mechanical algorithm for database search</em>, STOC 1996.</td></tr>
        <tr><td>≈√N is optimal — no quantum algorithm searches unstructured data faster.</td><td>Bennett, Bernstein, Brassard &amp; Vazirani (BBBV), <em>SIAM J. Computing</em>, 1997.</td></tr>
        <tr><td>AES logical-qubit counts and circuit-depth (≈2^82 / 2^114 / 2^146).</td><td>Grassl, Langenberg, Roetteler &amp; Steinwandt, <em>Applying Grover’s algorithm to AES</em>, PQCrypto 2016.</td></tr>
        <tr><td>AES-256 / SHA-512 recommended for post-quantum use.</td><td>NIST SP 800-57; NSA CNSA 2.0 (2022).</td></tr>
        <tr><td>Quantum collision search bound ≈2^(n/3) (distinct from preimage).</td><td>Brassard, Høyer &amp; Tapp (BHT), 1998.</td></tr>
        <tr><td>Shor breaks RSA / ECC / Diffie-Hellman (not symmetric crypto).</td><td>Shor, <em>Polynomial-time algorithms for prime factorization and discrete logarithms</em>, 1994/1997.</td></tr>
      </tbody>
    </table>
    </details>
  </section>

  <!-- Challenge mode -->
  <section class="panel" id="panel-challenge" aria-labelledby="challenge-heading">
    <h2 id="challenge-heading" class="panel-header">Challenge Mode</h2>
    <p class="panel-intro">Test yourself. Each answer is immediate and explained — use the simulator above if you need to check.</p>
    <div id="challenge-list"></div>
  </section>

  <!-- Glossary -->
  <section class="panel" id="panel-glossary" aria-labelledby="glossary-heading">
    <h2 id="glossary-heading" class="panel-header">Glossary</h2>
    <details class="ref-details">
      <summary>Show definitions of nearby terms</summary>
    <p class="panel-intro">Terse definitions, with the distinctions that trip people up.</p>
    <dl class="glossary">
      <dt>Amplitude</dt><dd>A signed number attached to each state. It can be <em>negative</em> — that’s what the oracle exploits. Not directly observable.</dd>
      <dt>Probability</dt><dd>Amplitude <em>squared</em> — what you actually get on measurement. Doubling an amplitude quadruples its probability.</dd>
      <dt>Phase</dt><dd>The sign of an amplitude (its angle, in general). The oracle changes phase, not magnitude.</dd>
      <dt>Oracle</dt><dd>A black box that recognizes the target and flips its phase. It does <em>not</em> output the answer.</dd>
      <dt>Diffusion operator</dt><dd>Reflection of every amplitude about their mean. It amplifies whatever the oracle marked.</dd>
      <dt>Marked item (target)</dt><dd>The state the oracle recognizes — e.g. the correct key.</dd>
      <dt>Query complexity</dt><dd>Number of oracle calls an algorithm needs. Grover’s is O(√N).</dd>
      <dt>Circuit depth</dt><dd>Length of the longest sequential chain of gates. Dominates real attack cost — query count alone understates it.</dd>
      <dt>Logical qubit</dt><dd>An error-corrected qubit built from many noisy physical qubits.</dd>
      <dt>Error correction</dt><dd>Encoding that protects logical qubits from noise. Adds large overhead — not modeled in this demo.</dd>
      <dt>Preimage resistance</dt><dd>Hardness of finding an input for a given hash output. Grover takes it 2ⁿ → 2^(n/2).</dd>
      <dt>Collision resistance</dt><dd>Hardness of finding two inputs with the same output. Classical 2^(n/2); quantum BHT 2^(n/3), but memory-heavy — don’t confuse with the preimage rule.</dd>
      <dt>Symmetric cryptography</dt><dd>One shared key (AES). Only quadratically weakened by Grover.</dd>
      <dt>Public-key cryptography</dt><dd>Separate public/private keys (RSA, ECC). Broken by Shor — Grover doesn’t apply.</dd>
    </dl>
    </details>
  </section>

  <footer class="scripture-footer">
    <p>Related demos:
      <a href="https://systemslibrarian.github.io/crypto-lab-shor/" target="_blank" rel="noopener">crypto-lab-shor</a> ·
      <a href="https://systemslibrarian.github.io/crypto-lab-harvest-vault/" target="_blank" rel="noopener">crypto-lab-harvest-vault</a> ·
      <a href="https://systemslibrarian.github.io/crypto-lab-aes-modes/" target="_blank" rel="noopener">crypto-lab-aes-modes</a> ·
      <a href="https://systemslibrarian.github.io/crypto-lab-hash-zoo/" target="_blank" rel="noopener">crypto-lab-hash-zoo</a> ·
      <a href="https://systemslibrarian.github.io/crypto-lab-bb84/" target="_blank" rel="noopener">crypto-lab-bb84</a></p>
    <p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p>
  </footer>
</main>`;
}

/* ── Theme toggle ──────────────────────────────────────── */
// The shared crypto-lab top bar (#cl-theme-toggle) is the page's theme control;
// this lab's own toggle was removed with the duplicate header, so guard for null.
const themeBtn = document.querySelector<HTMLElement>('#themeToggle');

function syncThemeButton(): void {
  if (!themeBtn) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  themeBtn.textContent = current === 'dark' ? '☀' : '🌙';
  themeBtn.setAttribute('aria-label', current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

syncThemeButton();

themeBtn?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  syncThemeButton();
  // Redraw canvas for new theme colors
  renderState();
});

/* ── Keyboard shortcuts ────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  switch (e.key) {
    case 'ArrowRight': stepBtn.click(); break;
    case ' ':
      e.preventDefault();
      autoBtn.click();
      break;
    case 'r': resetBtn.click(); break;
  }
});

/* ── Redraw on resize (canvas DPR) ─────────────────────── */
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => renderState());
});
