import { expect, test, type Page } from '@playwright/test';

/**
 * Claims gate: the page's headline verdicts and numbers, asserted against the
 * mathematics they say they implement rather than against fixed strings.
 *
 * The a11y spec proves the page can be read. This one proves it is right: that
 * the optimal-k banner quotes the probability the amplitude panel and the math
 * layer computed, that overshoot really does reduce that probability, that the
 * amplitudes stay unit-norm, that the oracle sub-step really flips the target's
 * sign and diffusion really lands on the closed form for k+1, that measurement
 * hits and misses sum to the shots taken, and that the AES/hash/budget tables
 * halve and multiply the way the README claims.
 *
 * θ and sin²((2k+1)θ) are recomputed independently here, so an error in the
 * simulator surfaces as a mismatch rather than as a matching pair of wrongs.
 */

const HEAVY = 120_000;

/** Reference math: θ = asin(1/√N), P(k) = sin²((2k+1)θ), k* = ⌊π/(4θ)⌋. */
const theta = (n: number): number => Math.asin(1 / Math.sqrt(2 ** n));
const prob = (n: number, k: number): number => Math.sin((2 * k + 1) * theta(n)) ** 2;
const kStarFor = (n: number): number => Math.floor(Math.PI / (4 * theta(n)));

function num(text: string | null | undefined, pattern: RegExp): number {
  const m = pattern.exec(text ?? '');
  expect(m, `expected ${pattern} in ${JSON.stringify(text)}`).not.toBeNull();
  return Number(m![1]!.replaceAll(',', ''));
}

/** The three amplitudes the Amplitude Values panel prints. */
async function readAmplitudes(
  page: Page,
): Promise<{ target: number; other: number; mean: number; probability: number }> {
  const text = (await page.locator('#amp-values').textContent()) ?? '';
  return {
    target: num(text, /Target amplitude:\s+([+-][\d.]+)/),
    other: num(text, /Other amplitude:\s+([+-][\d.]+)/),
    mean: num(text, /Mean amplitude:\s+([+-][\d.]+)/),
    probability: num(text, /probability: ([\d.]+)%/),
  };
}

/** The iteration readout: current k and the optimal k*. */
async function readIteration(page: Page): Promise<{ k: number; kStar: number }> {
  const text = (await page.locator('#iter-display').textContent()) ?? '';
  return { k: num(text, /k = (\d+)/), kStar: num(text, /k\* = (\d+)/) };
}

/** The math layer's three live equations. */
async function readMathLayer(
  page: Page,
): Promise<{ thetaDeg: number; angleDeg: number; probability: number; kStar: number; N: number }> {
  const text = (await page.locator('#math-layer').textContent()) ?? '';
  return {
    N: num(text, /asin\(1\/√([\d,]+)\)/),
    thetaDeg: num(text, /asin\(1\/√[\d,]+\) = ([\d.]+)°/),
    angleDeg: num(text, /angle = [^\n]*?= (-?[\d.]+)°/),
    probability: num(text, /P\(target\) = sin²\(angle\) = ([\d.]+)%/),
    kStar: num(text, /k\* = ⌊π \/ \(4θ\)⌋ = (\d+)/),
  };
}

/** Click Step until the readout reaches iteration `k` (relative to wherever it is). */
async function stepTo(page: Page, k: number): Promise<void> {
  for (let guard = 0; guard < 200; guard += 1) {
    const { k: current } = await readIteration(page);
    if (current >= k) break;
    await page.locator('#step-btn').click();
  }
  await expect(page.locator('#iter-display')).toContainText(`k = ${k}`);
}

// ---------------------------------------------------------------------------
// The headline: amplitude amplification and the optimal stopping point
// ---------------------------------------------------------------------------

test('the amplitudes stay unit-norm at every step, and the mean is their mean', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=4&target=0');
  const N = 16;

  const { kStar } = await readIteration(page);
  expect(kStar).toBe(kStarFor(4));

  for (let k = 0; k <= 2 * kStar; k += 1) {
    if (k > 0) await page.locator('#step-btn').click();
    const a = await readAmplitudes(page);

    // Total probability partitions across the target and the N−1 others.
    const norm = a.target ** 2 + (N - 1) * a.other ** 2;
    expect(norm, `k=${k}: amplitudes are not unit-norm`).toBeCloseTo(1, 3);

    // The mean line the diffusion step reflects about is the actual mean.
    expect(a.mean, `k=${k}: mean is not the mean of the amplitudes`).toBeCloseTo(
      (a.target + (N - 1) * a.other) / N,
      3,
    );

    // The panel's own percentage is the square of its own target amplitude,
    // and both match the closed form sin²((2k+1)θ).
    expect(a.probability / 100).toBeCloseTo(a.target ** 2, 3);
    expect(a.probability / 100).toBeCloseTo(prob(4, k), 3);
  }
});

test('the optimal banner quotes the probability the rest of the page computed', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=6&target=5');
  const kStar = kStarFor(6);

  // No optimal banner before k*.
  await stepTo(page, kStar - 1);
  await expect(page.locator('#banner')).toBeHidden();

  await stepTo(page, kStar);
  const banner = page.locator('#banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/(^|\s)optimal(\s|$)/);

  const quoted = num(await banner.textContent(), /succeed with ([\d.]+)% probability/);
  const amps = await readAmplitudes(page);
  const math = await readMathLayer(page);

  // One number, three renderings — and all three equal sin²((2k*+1)θ).
  expect(quoted).toBeCloseTo(amps.probability, 2);
  expect(quoted).toBeCloseTo(math.probability, 2);
  expect(quoted / 100).toBeCloseTo(prob(6, kStar), 4);

  // k* is where the curve peaks: it beats both neighbours.
  expect(prob(6, kStar)).toBeGreaterThan(prob(6, kStar - 1));
  expect(prob(6, kStar)).toBeGreaterThan(prob(6, kStar + 1));
});

test('running past k* really does reduce the success probability it warns about', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=6&target=5');
  const kStar = kStarFor(6);

  await stepTo(page, kStar);
  const peak = (await readAmplitudes(page)).probability;

  // This is the lab's central failure path: more iterations is not better.
  await page.locator('#step-btn').click();
  const banner = page.locator('#banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/(^|\s)overshoot(\s|$)/);
  await expect(banner).toContainText('rotated beyond the target axis');
  await expect(banner).toContainText('probability is now decreasing');

  const after = (await readAmplitudes(page)).probability;
  expect(after, 'the overshoot warning fired but probability did not fall').toBeLessThan(peak);
  expect(after / 100).toBeCloseTo(prob(6, kStar + 1), 4);

  // And it keeps falling for the rest of the walk to 2·k*.
  let previous = after;
  for (let k = kStar + 2; k <= 2 * kStar; k += 1) {
    await page.locator('#step-btn').click();
    const next = (await readAmplitudes(page)).probability;
    expect(next, `probability rose again at k=${k}`).toBeLessThan(previous);
    previous = next;
  }

  // The walk is bounded at 2·k*: stepping again is a no-op, not a crash.
  await page.locator('#step-btn').click();
  expect((await readIteration(page)).k).toBe(2 * kStar);
});

test('the math layer’s equations agree with the numbers they claim to produce', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=8&target=3');
  await stepTo(page, 5);

  const math = await readMathLayer(page);
  expect(math.N).toBe(256);
  expect(math.kStar).toBe(kStarFor(8));
  expect(math.thetaDeg).toBeCloseTo((theta(8) * 180) / Math.PI, 2);

  // angle = (2k+1)·θ, and P = sin²(angle) — checked against the rendered angle
  // itself, so a wrong angle cannot be hidden by a right probability.
  expect(math.angleDeg).toBeCloseTo(11 * math.thetaDeg, 1);
  expect(math.probability / 100).toBeCloseTo(Math.sin((math.angleDeg * Math.PI) / 180) ** 2, 3);
  expect(math.probability / 100).toBeCloseTo(prob(8, 5), 3);

  // The rotation canvas is labelled with the same angle and the same k*.
  const label = (await page.locator('#rotation-canvas').getAttribute('aria-label')) ?? '';
  expect(num(label, /at (-?[\d.]+) degrees/)).toBeCloseTo(math.angleDeg, 0);
  expect(num(label, /rotates by ([\d.]+) degrees/)).toBeCloseTo(2 * math.thetaDeg, 0);
  expect(num(label, /k\* = (\d+) iterations/)).toBe(math.kStar);
});

// ---------------------------------------------------------------------------
// The oracle / diffusion decomposition
// ---------------------------------------------------------------------------

test('the oracle flips only the target’s sign and diffusion lands on the next closed form', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=4&target=2&sub=1');
  await expect(page.locator('#decompose-toggle')).toBeChecked();

  const before = await readAmplitudes(page);
  await expect(page.locator('#phase-label')).toContainText('State');

  // Oracle: reflect across the non-target axis.
  await page.locator('#step-btn').click();
  await expect(page.locator('#phase-label')).toContainText('Oracle');
  await expect(page.locator('#phase-label')).toContainText('flip the target');
  const oracle = await readAmplitudes(page);
  expect(oracle.target, 'the oracle did not negate the target amplitude').toBeCloseTo(-before.target, 4);
  expect(oracle.other, 'the oracle changed a non-target amplitude').toBeCloseTo(before.other, 4);
  // A reflection preserves the norm, so the probability is unchanged…
  expect(oracle.probability).toBeCloseTo(before.probability, 2);
  // …but the mean has moved, which is what makes diffusion do work.
  expect(oracle.mean).toBeLessThan(before.mean);

  // The target's bar is drawn below the baseline while its amplitude is negative.
  await expect(page.locator('#bar-chart .bar.target')).toHaveClass(/(^|\s)neg(\s|$)/);

  // Diffusion: invert about the mean — exactly the superposition after k+1.
  await page.locator('#step-btn').click();
  await expect(page.locator('#phase-label')).toContainText('Diffusion');
  const diffusion = await readAmplitudes(page);
  expect(diffusion.target).toBeCloseTo(Math.sin(3 * theta(4)), 4);
  expect(diffusion.other).toBeCloseTo(Math.cos(3 * theta(4)) / Math.sqrt(15), 4);
  expect(diffusion.probability / 100).toBeCloseTo(prob(4, 1), 3);
  expect((await readIteration(page)).k).toBe(1);
  await expect(page.locator('#bar-chart .bar.target')).toHaveClass(/(^|\s)pos(\s|$)/);

  // Amplification: the target amplitude grew, the others shrank.
  expect(diffusion.target).toBeGreaterThan(before.target);
  expect(Math.abs(diffusion.other)).toBeLessThan(Math.abs(before.other));

  // The chart's accessible name reports the same three numbers.
  const label = (await page.locator('#bar-chart').getAttribute('aria-label')) ?? '';
  expect(num(label, /Target amplitude ([-\d.]+),/)).toBeCloseTo(diffusion.target, 3);
  expect(num(label, /other amplitudes ([-\d.]+),/)).toBeCloseTo(diffusion.other, 3);
  expect(num(label, /mean ([-\d.]+)\./)).toBeCloseTo(diffusion.mean, 3);
});

// ---------------------------------------------------------------------------
// Measurement: probability is not certainty
// ---------------------------------------------------------------------------

test('measurement outcomes partition the 100 shots and quote the state’s own probability', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=4&target=7');
  await stepTo(page, kStarFor(4));

  const expected = (await readAmplitudes(page)).probability;
  await page.locator('#measure-btn').click();

  const stats = (await page.locator('#measure-stats').textContent()) ?? '';
  const hits = num(stats, /Target: (\d+)\/100/);
  const misses = num(stats, /Wrong: (\d+)\/100/);
  const empirical = num(stats, /Empirical success: (\d+)%/);
  const theoretical = num(stats, /Theoretical: ([\d.]+)%/);

  // Parts sum to the whole, three ways: the two counters, the drawn dots, and
  // the dots' own hit/miss classes.
  expect(hits + misses).toBe(100);
  expect(empirical).toBe(hits);
  await expect(page.locator('#measure-dots .m-dot')).toHaveCount(100);
  expect(await page.locator('#measure-dots .m-dot.hit').count()).toBe(hits);
  expect(await page.locator('#measure-dots .m-dot.miss').count()).toBe(misses);

  // The quoted theoretical rate is the state's own success probability.
  expect(theoretical).toBeCloseTo(expected, 1);
  expect(theoretical / 100).toBeCloseTo(prob(4, kStarFor(4)), 3);

  // Stepping invalidates a stale sample rather than leaving it on screen.
  await page.locator('#step-btn').click();
  await expect(page.locator('#measure-dots .m-dot')).toHaveCount(0);
  await expect(page.locator('#measure-stats')).toContainText('Press "Measure ×100" to sample');
});

// ---------------------------------------------------------------------------
// Prediction mode — the page scores you against what actually happened
// ---------------------------------------------------------------------------

test('prediction mode scores the guess against the probability change it then shows', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=6&target=1');
  await page.locator('#predict-toggle').check();

  // Early in the walk, probability rises: guessing "down" must be marked wrong
  // and the reveal must report the direction it actually moved.
  await page.locator('#step-btn').click();
  const prompt = page.locator('#predict-prompt');
  await expect(prompt).toContainText('will the target’s success probability go up');
  await prompt.getByRole('button', { name: '↓ Decrease' }).click();

  const wrong = (await prompt.textContent()) ?? '';
  expect(wrong).toContain('✗ Not quite');
  expect(wrong).toContain('probability increased');
  await expect(prompt.locator('.predict-result')).toHaveClass(/(^|\s)wrong(\s|$)/);

  const from = num(wrong, /\(([\d.]+)% → /);
  const to = num(wrong, /→ ([\d.]+)%\)/);
  expect(to, 'the reveal said "increased" but the numbers fell').toBeGreaterThan(from);
  expect(to).toBeCloseTo((await readAmplitudes(page)).probability, 1);

  // Past k*, probability falls: now "down" is the right answer.
  await page.locator('#predict-toggle').uncheck();
  await stepTo(page, kStarFor(6));
  await page.locator('#predict-toggle').check();
  await page.locator('#step-btn').click();
  await expect(prompt).toContainText('You’re at or past k*');
  await prompt.getByRole('button', { name: '↓ Decrease' }).click();

  const right = (await prompt.textContent()) ?? '';
  expect(right).toContain('✓ Correct');
  expect(right).toContain('probability decreased');
  await expect(prompt.locator('.predict-result')).toHaveClass(/(^|\s)right(\s|$)/);
  expect(num(right, /→ ([\d.]+)%\)/)).toBeLessThan(num(right, /\(([\d.]+)% → /));
});

// ---------------------------------------------------------------------------
// Search-space controls and the classical-vs-quantum race
// ---------------------------------------------------------------------------

test('resizing the search space rescales N, k* and the race in step', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('.');

  for (const n of [4, 10, 16]) {
    await page.locator('#n-slider').fill(String(n));
    await page.locator('#n-slider').dispatchEvent('input');

    const N = 2 ** n;
    await expect(page.locator('#n-value')).toHaveText(`N = 2^${n} = ${N.toLocaleString()}`);
    expect((await readIteration(page)).kStar).toBe(kStarFor(n));
    expect((await readMathLayer(page)).N).toBe(N);

    // The race quotes N/2 classical queries against 2k*+1 quantum ones — the
    // quadratic speedup the lab exists to show.
    const classical = (await page.locator('#race-classical-stats').textContent()) ?? '';
    const quantum = (await page.locator('#race-quantum-stats').textContent()) ?? '';
    expect(num(classical, /Expected queries: N\/2 = ([\d,]+)/)).toBe(N / 2);
    const kStar = num(quantum, /k\* = ([\d,]+)/);
    const total = num(quantum, /total: ([\d,]+)/);
    expect(kStar).toBe(kStarFor(n));
    expect(total, 'total quantum queries are not 2·k*+1').toBe(2 * kStar + 1);
    expect(total, 'Grover used at least as many queries as classical search').toBeLessThan(N / 2);

    // The target index stays inside the resized space.
    const target = num(await page.locator('#target-display').textContent(), /index (\d+)/);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThan(N);
  }
});

test('the target selector picks a valid index and its binary label matches', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('./?n=4');
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#random-btn').click();
    const text = (await page.locator('#target-display').textContent()) ?? '';
    const index = num(text, /index (\d+)/);
    const bits = /\(([01]+)\)/.exec(text)?.[1] ?? '';
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(16);
    expect(bits).toHaveLength(4);
    expect(Number.parseInt(bits, 2), 'the binary label does not encode the index').toBe(index);
  }

  // Reset returns to k = 0, the uniform superposition.
  await page.locator('#step-btn').click();
  await page.locator('#reset-btn').click();
  expect((await readIteration(page)).k).toBe(0);
  expect((await readAmplitudes(page)).probability / 100).toBeCloseTo(prob(4, 0), 3);
});

// ---------------------------------------------------------------------------
// The crypto-impact tables — the README's halving claim
// ---------------------------------------------------------------------------

test('every AES key size is halved, and the budget multiplies back to its own total', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('.');

  for (const bits of [128, 192, 256]) {
    await page.locator('#key-selector').selectOption(String(bits));
    const example = (await page.locator('#aes-example').textContent()) ?? '';
    const classicalExp = num(example, /Classical brute force:\s*2\^(\d+)/);
    const groverExp = num(example, /Grover \(idealized\):\s*2\^(\d+)/);
    expect(classicalExp).toBe(bits);
    expect(groverExp, `AES-${bits}: Grover exponent is not half the classical one`).toBe(bits / 2);
    await expect(page.locator('#aes-explanation')).toContainText(`2^${bits} to ~2^${bits / 2}`);

    // The cost budget: iterations × cost-per-oracle-call = total depth. In
    // exponents that is an addition, and it must actually add up.
    await page.locator('#budget-selector').selectOption(String(bits));
    const budget = (await page.locator('#budget-box').textContent()) ?? '';
    const iters = num(budget, /Grover iterations \(oracle calls\)≈ 2\^(\d+)/);
    const perCall = num(budget, /coherent\)≈ 2\^(\d+) qubit-cycles/);
    const totalDepth = num(budget, /Total circuit depth \(idealized lower bound\)≈ 2\^(\d+)/);
    expect(iters).toBe(bits / 2);
    expect(iters + perCall, `AES-${bits}: budget factors do not multiply to the stated total`).toBe(totalDepth);
    // The headline the panel exists to puncture: depth ≫ oracle calls.
    expect(totalDepth).toBeGreaterThan(iters);
    await expect(page.locator('#budget-box')).toContainText('not');
    await expect(page.locator('#budget-box')).toContainText(`The headline “2^${bits / 2}” counts`);
  }

  // AES-256 is the one the README says stays strong; the others are flagged.
  await page.locator('#budget-selector').selectOption('256');
  await expect(page.locator('#budget-box .bv.ok')).toHaveText('STRONG');
  await page.locator('#budget-selector').selectOption('128');
  await expect(page.locator('#budget-box .bv.warn')).toHaveText('WEAKENED');
});

test('the hash table halves preimage bits and uses the cube root for collisions', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('.');

  const rows = await page.locator('.hash-table tbody tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')),
  );
  expect(rows.length).toBeGreaterThanOrEqual(7);

  for (const [name, bitsText, classical, quantum, collision, verdict] of rows) {
    const bits = Number(bitsText);
    expect(classical, `${name}: classical preimage`).toBe(`2^${bits}`);
    expect(quantum, `${name}: Grover halves the preimage exponent`).toBe(`2^${bits / 2}`);
    expect(collision, `${name}: BHT collision is 2^(n/3)`).toBe(`2^${Math.floor(bits / 3)}`);
    // The verdict must follow the halved strength, not the raw output size.
    if (bits / 2 < 128) expect(verdict, `${name}`).toBe('BROKEN');
    else expect(['ADEQUATE', 'STRONG', 'VERY STRONG']).toContain(verdict);
  }

  // README: SHA-256 keeps ~128-bit preimage security against Grover.
  const sha256 = rows.find((r) => r[0] === 'SHA-256');
  expect(sha256?.[3]).toBe('2^128');
  expect(sha256?.[5]).toBe('ADEQUATE');
  // …and MD5's halved 64 bits is not enough.
  expect(rows.find((r) => r[0] === 'MD5')?.[5]).toBe('BROKEN');
});

test('challenge mode marks answers right or wrong and explains either way', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('.');
  const cards = page.locator('#challenge-list .challenge-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const optionCount = await cards.nth(i).locator('.challenge-opt').count();
    expect(optionCount).toBeGreaterThan(1);

    // A card locks after the first answer, so each option gets a fresh page.
    let rightAnswers = 0;
    let explanation = '';
    for (let j = 0; j < optionCount; j += 1) {
      await page.goto('.');
      const card = page.locator('#challenge-list .challenge-card').nth(i);
      const options = card.locator('.challenge-opt');
      await options.nth(j).click();
      await expect(card).toHaveClass(/(^|\s)answered(\s|$)/);

      const feedback = card.locator('.challenge-feedback');
      const text = (await feedback.textContent()) ?? '';
      const right = text.startsWith('✓ Correct.');
      if (!right) expect(text, `question ${i} option ${j} gave no verdict`).toContain('✗ Not quite.');
      if (right) rightAnswers += 1;

      // The verdict must agree with how the page styled the option clicked,
      // and the correct option is revealed exactly once either way.
      await expect(options.nth(j)).toHaveClass(new RegExp(`(^|\\s)${right ? 'correct' : 'incorrect'}(\\s|$)`));
      expect(await card.locator('.challenge-opt.correct').count()).toBe(1);
      expect(await feedback.locator(right ? '.fb-right' : '.fb-wrong').count()).toBe(1);

      // The explanation is the same either way — the point is learning.
      const explained = text.replace(/^[^.]*\.\s*/, '');
      expect(explained.length, `question ${i} option ${j} gave no explanation`).toBeGreaterThan(40);
      if (explanation === '') explanation = explained;
      else expect(explained).toBe(explanation);

      // The card is locked: a second click cannot change the verdict.
      await options.nth((j + 1) % optionCount).click();
      expect(await feedback.textContent()).toBe(text);
    }
    expect(rightAnswers, `question ${i} does not have exactly one correct option`).toBe(1);
  }
});

// ---------------------------------------------------------------------------
// Deep links — the README's shareable-state promise
// ---------------------------------------------------------------------------

test('deep links restore the exact state the README advertises', async ({ page }) => {
  test.setTimeout(HEAVY);

  // ?steps=3 jumps to the optimal iteration for the default n = 4.
  await page.goto('./?steps=3');
  expect(await readIteration(page)).toEqual({ k: 3, kStar: kStarFor(4) });
  await expect(page.locator('#banner')).toHaveClass(/(^|\s)optimal(\s|$)/);

  // ?sub=1&steps=1 opens at the oracle sub-step, with the target amplitude
  // already negative.
  await page.goto('./?sub=1&steps=1');
  await expect(page.locator('#decompose-toggle')).toBeChecked();
  await expect(page.locator('#phase-label')).toContainText('Oracle');
  expect((await readAmplitudes(page)).target).toBeLessThan(0);

  // ?n= and ?target= pin a reproducible lesson state.
  await page.goto('./?n=7&target=99&steps=2');
  await expect(page.locator('#n-value')).toHaveText('N = 2^7 = 128');
  await expect(page.locator('#target-display')).toHaveText('Target: index 99 (1100011)');
  const state = await readIteration(page);
  expect(state).toEqual({ k: 2, kStar: kStarFor(7) });
  expect((await readAmplitudes(page)).probability / 100).toBeCloseTo(prob(7, 2), 3);

  // Out-of-range parameters are clamped rather than trusted.
  await page.goto('./?n=99&steps=-5');
  await expect(page.locator('#n-value')).toHaveText('N = 2^4 = 16');
  expect((await readIteration(page)).k).toBe(0);
});

test('the guided lesson walks its stages and drives the simulator', async ({ page }) => {
  test.setTimeout(HEAVY);
  await page.goto('.');
  await page.locator('#lesson-start').click();

  const progress = page.locator('#lesson-progress');
  await expect(progress).toBeVisible();
  const total = num(await progress.textContent(), /Stage \d+ of (\d+)/);
  expect(total).toBe(5);

  for (let stage = 1; stage <= total; stage += 1) {
    await expect(progress).toHaveText(`Stage ${stage} of ${total}`);
    await expect(page.locator('#lesson-body .lesson-title')).toContainText(String(stage));
    // Each stage leaves the simulator in a state its own math layer agrees with.
    const { k } = await readIteration(page);
    const amps = await readAmplitudes(page);
    const n = Math.log2((await readMathLayer(page)).N);
    expect(amps.probability / 100).toBeCloseTo(prob(n, k), 3);
    if (stage < total) await page.locator('#lesson-next').click();
  }

  await expect(page.locator('#lesson-next')).toHaveText('Finish ✓');
  await page.locator('#lesson-exit').click();
  await expect(page.locator('#lesson-body')).toBeHidden();
});
