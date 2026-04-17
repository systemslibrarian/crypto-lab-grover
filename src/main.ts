import './style.css';
import { computeGroverState, groverProbabilityCurve, groverQueryCount, type GroverState } from './grover.ts';
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

/* ── Render root ───────────────────────────────────────── */
document.querySelector<HTMLDivElement>('#app')!.innerHTML = buildHTML();

/* ── State ─────────────────────────────────────────────── */
let n = 4;
let N = 2 ** n;
let targetIndex = cryptoRandomBelow(N);
let currentK = 0;
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
const barChart = $('#bar-chart');
const barLabels = $('#bar-labels');
const ampValues = $('#amp-values');
const probCanvas = $('#prob-canvas') as HTMLCanvasElement;
const banner = $('#banner');
const liveRegion = $('#live-region');

/* Race panel */
const raceClassicalBar = $('#race-classical-bar');
const raceQuantumBar = $('#race-quantum-bar');
const raceClassicalStats = $('#race-classical-stats');
const raceQuantumStats = $('#race-quantum-stats');
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

stepBtn.addEventListener('click', () => {
  const state = computeGroverState(n, targetIndex, currentK);
  const maxK = 2 * state.optimalIterations;
  if (currentK < maxK) {
    currentK++;
    renderState();
  }
});

autoBtn.addEventListener('click', () => {
  if (autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
    autoBtn.textContent = '\u25B6\u25B6 Auto-run';
    autoBtn.classList.remove('active');
    return;
  }
  autoBtn.textContent = '\u23F9 Stop';
  autoBtn.classList.add('active');
  autoTimer = window.setInterval(() => {
    const state = computeGroverState(n, targetIndex, currentK);
    const maxK = 2 * state.optimalIterations;
    if (currentK >= maxK) {
      clearInterval(autoTimer!);
      autoTimer = null;
      autoBtn.textContent = '\u25B6\u25B6 Auto-run';
      autoBtn.classList.remove('active');
      return;
    }
    currentK++;
    renderState();
  }, 400);
});

resetBtn.addEventListener('click', () => resetState());

/* ── Core render ───────────────────────────────────────── */
function resetState(): void {
  if (autoTimer !== null) { clearInterval(autoTimer); autoTimer = null; }
  autoBtn.textContent = '\u25B6\u25B6 Auto-run';
  autoBtn.classList.remove('active');
  currentK = 0;
  renderState();
  renderRace();
}

function renderState(): void {
  const state = computeGroverState(n, targetIndex, currentK);
  const kStar = state.optimalIterations;

  /* Controls display */
  nValue.textContent = `N = 2^${n} = ${N.toLocaleString()}`;
  targetDisplay.textContent = `Target: index ${targetIndex} (${toBin(targetIndex, n)})`;
  iterDisplay.innerHTML = `Iteration: <span class="current">k = ${currentK}</span> / <span class="optimal">k* = ${kStar}</span>`;

  /* Bars */
  renderBars(state);

  /* Amplitude values */
  renderAmpValues(state);

  /* Probability curve */
  renderProbCurve(state);

  /* Banner */
  if (currentK === kStar) {
    banner.className = 'banner optimal';
    banner.style.display = 'block';
    banner.textContent = `\u2713 Optimal k* reached \u2014 measuring now would succeed with ${(state.successProbability * 100).toFixed(2)}% probability`;
  } else if (currentK > kStar) {
    banner.className = 'banner overshoot';
    banner.style.display = 'block';
    banner.textContent = `\u26A0 Past optimal \u2014 probability is now decreasing. More iterations = lower success.`;
  } else {
    banner.style.display = 'none';
  }

  /* Accessibility live region */
  liveRegion.textContent = `Iteration ${currentK} of ${kStar} optimal. Success probability: ${(state.successProbability * 100).toFixed(1)}%.`;
}

/* ── Bar chart ─────────────────────────────────────────── */
function renderBars(state: GroverState): void {
  barChart.innerHTML = '';
  barLabels.innerHTML = '';

  const showBars = n <= 8;
  if (!showBars) {
    barChart.innerHTML = `<div style="font-family:var(--mono);font-size:.75rem;color:var(--text-dim);padding:1rem;">N = ${N.toLocaleString()} is too large for individual bars. See probability curve below.</div>`;
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

  const maxAmp = Math.max(Math.abs(state.targetAmplitude), Math.abs(state.nonTargetAmplitude), 0.01);

  for (const idx of indices) {
    const amp = idx === targetIndex ? state.targetAmplitude : state.nonTargetAmplitude;
    const h = Math.max(1, Math.abs(amp) / maxAmp * 100);
    const bar = document.createElement('div');
    bar.className = `bar ${idx === targetIndex ? 'target' : 'non-target'}`;
    bar.style.height = `${h}%`;
    barChart.appendChild(bar);

    const lbl = document.createElement('span');
    lbl.textContent = n <= 4 ? toBin(idx, n) : String(idx);
    barLabels.appendChild(lbl);
  }

  if (n > 4) {
    const note = document.createElement('div');
    note.className = 'bar-note';
    note.style.cssText = 'font-family:var(--mono);font-size:.6rem;color:var(--text-dim);margin-top:.25rem';
    note.textContent = `Showing ${indices.length} of ${N} states`;
    barLabels.appendChild(note);
  }

  barChart.setAttribute('aria-label',
    `Amplitude bar chart showing Grover state after ${currentK} iterations. Target amplitude: ${state.targetAmplitude.toFixed(4)}. Success probability: ${(state.successProbability * 100).toFixed(1)}%.`
  );
}

/* ── Amplitude values panel ────────────────────────────── */
function renderAmpValues(state: GroverState): void {
  const mean = (state.targetAmplitude + (N - 1) * state.nonTargetAmplitude) / N;
  ampValues.innerHTML =
    `<span class="highlight">Target amplitude:     ${fmtAmp(state.targetAmplitude)}</span>  → <span class="prob">probability: ${(state.successProbability * 100).toFixed(2)}%</span>\n` +
    `Non-target amplitude: ${fmtAmp(state.nonTargetAmplitude)}\n` +
    `Mean amplitude:       ${fmtAmp(mean)}\n\n` +
    `<span style="color:var(--text-dim);font-size:.7rem">Classically simulated amplitude evolution (not a real quantum computation)</span>`;
}

function fmtAmp(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(4);
}

/* ── Probability curve canvas ──────────────────────────── */
function renderProbCurve(state: GroverState): void {
  const curve = groverProbabilityCurve(n);
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
  }

  /* Current position dot */
  const curPt = curve.find(p => p.iteration === currentK);
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
    ctx.fillText('Overshoot: past k* decreases probability', x(kStar) + 8, pad.t + 12);
  }

  canvas.setAttribute('aria-label',
    `Probability curve: ${curve.length} points. Current k=${currentK}, probability ${((curPt?.probability ?? 0) * 100).toFixed(1)}%. Peak at k*=${kStar}.`
  );
}

/* ── Race panel ────────────────────────────────────────── */
function renderRace(): void {
  const kStar = computeGroverState(n, targetIndex, 0).optimalIterations;
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

  /* Animated race for small n */
  if (raceTimer !== null) { clearInterval(raceTimer); raceTimer = null; }
  if (raceTimeout !== null) { clearTimeout(raceTimeout); raceTimeout = null; }

  if (n <= 16) {
    let classicalProgress = 0;
    let quantumProgress = 0;
    const quantumTarget = kStar;
    const classicalTarget = classicalExpected;
    const tickMs = 50;

    function tick() {
      const classicalStep = Math.max(1, cryptoRandomBelow(3) + 1);
      classicalProgress = Math.min(classicalProgress + classicalStep, classicalTarget);
      quantumProgress = Math.min(quantumProgress + 1, quantumTarget);

      raceClassicalBar.style.width = `${(classicalProgress / classicalTarget) * 100}%`;
      raceQuantumBar.style.width = `${(quantumProgress / quantumTarget) * 100}%`;

      if (quantumProgress >= quantumTarget && classicalProgress >= classicalTarget) {
        if (raceTimer !== null) clearInterval(raceTimer);
      }
    }

    raceClassicalBar.style.width = '0%';
    raceQuantumBar.style.width = '0%';
    raceTimer = window.setInterval(tick, tickMs);
    // Stop after a reasonable duration
    raceTimeout = window.setTimeout(() => { if (raceTimer !== null) { clearInterval(raceTimer); raceTimer = null; } }, tickMs * (quantumTarget + 10));
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

/* ── Initial render ────────────────────────────────────── */
renderState();
renderRace();

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
<header style="position: relative;">
  <button class="theme-toggle" id="theme-toggle" style="position: absolute; top: 0; right: 0;" aria-label="Switch to light mode">🌙</button>
</header>

<main class="app">

  <!-- Panel A: Amplitude Visualizer -->
  <section class="panel" id="panel-a" aria-labelledby="panel-a-heading">
    <h1 id="panel-a-heading" class="panel-header">Grover's Algorithm &mdash; Amplitude Amplification</h1>

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
    </div>

    <div class="iter-display" id="iter-display">Iteration: <span class="current">k = 0</span> / <span class="optimal">k* = 3</span></div>

    <div class="bar-chart" id="bar-chart" role="img" aria-label="Amplitude bar chart showing Grover state after 0 iterations"></div>
    <div class="bar-labels" id="bar-labels"></div>

    <div class="amp-values" id="amp-values"></div>

    <div id="banner" class="banner"></div>

    <div class="prob-curve-wrap">
      <canvas id="prob-canvas" aria-label="Probability vs iteration curve"></canvas>
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
          <div class="race-stats" id="race-classical-stats"></div>
        </div>
        <div class="race-col">
          <h3>Quantum Search (Grover)</h3>
          <div class="race-bar-wrap"><div class="race-bar quantum" id="race-quantum-bar" style="width:0%"></div></div>
          <div class="race-stats" id="race-quantum-stats"></div>
        </div>
      </div>
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

      <div class="insight-box">KEY INSIGHT: The circuit depth matters more than the qubit count.

AES-128 needs 2^82 logical qubit-cycles \u2014 not just 2^64 oracle calls.
Each "Grover iteration" requires running the entire AES circuit coherently
inside the quantum computer. This makes Grover attacks on AES significantly
more expensive in practice than the headline 2^64 number suggests.

Source: NIST/ETSI practical cost estimates for Grover on AES (2024)</div>

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

      <div class="fix-box">
        <h3>The Fix Is Simple</h3>
        <p>Grover halves effective key length. Double your key length to restore security.</p>
        <p style="margin-top:.5rem">AES-128 \u2192 AES-256 &ensp;(already standardized)<br>
SHA-256 \u2192 SHA-512 &ensp;(straightforward upgrade)<br>
HMAC-SHA-256 \u2192 HMAC-SHA-512</p>
        <p style="margin-top:.5rem">Unlike Shor\u2019s algorithm \u2014 which requires entirely new cryptographic
algorithms \u2014 Grover\u2019s threat is mitigated by a parameter change alone.</p>
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
        <p style="margin-top:.75rem;font-family:var(--mono);font-size:.72rem;color:var(--text-dim)">Grover is the lesser threat. Shor is the existential one. Both must be addressed, but they require different responses.</p>
      </details>
    </section>
  </div>

  <footer>
    <p>\u201CWhether therefore ye eat, or drink, or whatsoever ye do,
    do all to the glory of God.\u201D \u2014 1 Corinthians 10:31</p>
  </footer>
</main>`;
}

/* ── Theme toggle ──────────────────────────────────────── */
const themeBtn = $('#theme-toggle');

function syncThemeButton(): void {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  themeBtn.textContent = current === 'dark' ? '🌙' : '☀️';
  themeBtn.setAttribute('aria-label', current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

syncThemeButton();

themeBtn.addEventListener('click', () => {
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
