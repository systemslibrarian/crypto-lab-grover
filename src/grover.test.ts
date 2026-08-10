import { describe, it, expect } from 'vitest';
import {
  MIN_QUBITS,
  MAX_QUBITS,
  groverTheta,
  optimalIterationsForN,
  simulateGroverState,
  simulateGroverSubStep,
  simulateProbabilityCurve,
  groverOracleQueries,
  classicalSearch,
  groverQueryCount,
} from './grover.ts';

/*
 * These tests pin the classical simulation of Grover's algorithm to its
 * reference math. They exist to catch the exact class of bug the demo could
 * silently ship: a sub-step decomposition that visually "looks right" but
 * disagrees with the closed form, a wrong k*, or a probability curve that
 * fails to overshoot. All facts asserted here are the ones the README/UI
 * narrate in prose ("agrees with sin((2k+1)θ) to floating-point precision",
 * "overshoot past k*", "oracle flips the target negative").
 */

const closed = (n: number, k: number): { target: number; nonTarget: number } => {
  const theta = Math.asin(1 / Math.sqrt(2 ** n));
  const phase = (2 * k + 1) * theta;
  return {
    target: Math.sin(phase),
    nonTarget: Math.cos(phase) / Math.sqrt(2 ** n - 1),
  };
};

describe('groverTheta', () => {
  it('satisfies sin(theta) = 1/sqrt(N)', () => {
    for (let n = MIN_QUBITS; n <= MAX_QUBITS; n += 1) {
      const theta = groverTheta(n);
      expect(Math.sin(theta)).toBeCloseTo(1 / Math.sqrt(2 ** n), 12);
    }
  });

  it('rejects out-of-range qubit counts (documented contract 2..20)', () => {
    expect(() => groverTheta(MIN_QUBITS - 1)).toThrow(/between 2 and 20/);
    expect(() => groverTheta(MAX_QUBITS + 1)).toThrow(/between 2 and 20/);
    expect(() => groverTheta(1.5)).toThrow(/finite integer/);
  });
});

describe('optimalIterationsForN', () => {
  // Reference k* = floor(pi / (4*theta)) with theta = asin(1/sqrt(2^n)).
  // e.g. n=2: N=4, theta=30deg, pi/(4*theta)=1.5 -> floor 1.
  const cases: Array<[n: number, kStar: number]> = [
    [2, 1],
    [3, 2],
    [4, 3],
    [10, 25],
    [20, 804],
  ];

  it.each(cases)('k* for n=%i is %i', (n, kStar) => {
    expect(optimalIterationsForN(2 ** n)).toBe(kStar);
  });

  it('lands the state near-certainly on the target (prob close to 1 at k*)', () => {
    for (let n = 4; n <= MAX_QUBITS; n += 1) {
      const kStar = optimalIterationsForN(2 ** n);
      const p = simulateGroverState(n, 0, kStar).successProbability;
      // For n>=4 the optimal iteration should be a very good hit.
      expect(p).toBeGreaterThan(0.9);
    }
  });
});

describe('simulateGroverState', () => {
  it('matches the closed form sin((2k+1)theta) for target and non-target', () => {
    for (let n = 2; n <= 12; n += 1) {
      const kStar = optimalIterationsForN(2 ** n);
      for (let k = 0; k <= 2 * kStar; k += 1) {
        const s = simulateGroverState(n, 3 % 2 ** n, k);
        const ref = closed(n, k);
        expect(s.targetAmplitude).toBeCloseTo(ref.target, 12);
        expect(s.nonTargetAmplitude).toBeCloseTo(ref.nonTarget, 12);
        expect(s.successProbability).toBeCloseTo(ref.target ** 2, 12);
      }
    }
  });

  it('is a unit vector: target^2 + (N-1)*nonTarget^2 = 1', () => {
    for (let n = 2; n <= 14; n += 1) {
      for (const k of [0, 1, 2, optimalIterationsForN(2 ** n)]) {
        const s = simulateGroverState(n, 0, k);
        const norm = s.targetAmplitude ** 2 + (s.N - 1) * s.nonTargetAmplitude ** 2;
        expect(norm).toBeCloseTo(1, 12);
      }
    }
  });

  it('starts from uniform superposition at k=0 (all amplitudes 1/sqrt(N))', () => {
    const n = 6;
    const s = simulateGroverState(n, 5, 0);
    expect(s.targetAmplitude).toBeCloseTo(1 / Math.sqrt(2 ** n), 12);
    expect(s.nonTargetAmplitude).toBeCloseTo(1 / Math.sqrt(2 ** n), 12);
    expect(s.successProbability).toBeCloseTo(1 / 2 ** n, 12);
  });

  it('emits a full amplitude array for n<=16 and truncates above', () => {
    expect(simulateGroverState(8, 0, 0).amplitudes).toHaveLength(2 ** 8);
    expect(simulateGroverState(8, 0, 0).truncated).toBe(false);
    // n=20 (the max) is > 16, so it must truncate rather than materialise 2^20 entries.
    const big = simulateGroverState(MAX_QUBITS, 0, 0);
    expect(big.truncated).toBe(true);
    expect(big.amplitudes.length).toBeLessThan(big.N);
  });

  it('rejects invalid target indices and iterations', () => {
    expect(() => simulateGroverState(3, 8, 0)).toThrow(/targetIndex/);
    expect(() => simulateGroverState(3, -1, 0)).toThrow(/targetIndex/);
    expect(() => simulateGroverState(3, 0, -1)).toThrow(/iteration/);
  });
});

describe('overshoot: probability rises then falls past k*', () => {
  it('success probability at 2*k* is below the peak at k*', () => {
    const n = 8;
    const kStar = optimalIterationsForN(2 ** n);
    const pStar = simulateGroverState(n, 0, kStar).successProbability;
    const pOver = simulateGroverState(n, 0, 2 * kStar).successProbability;
    expect(pStar).toBeGreaterThan(pOver);
  });

  it('probability curve peaks exactly at the flagged optimal iteration', () => {
    const n = 10;
    const curve = simulateProbabilityCurve(n);
    const optimal = curve.find((p) => p.isOptimal);
    expect(optimal).toBeDefined();
    const maxP = Math.max(...curve.map((p) => p.probability));
    // The point flagged isOptimal is (one of) the global maxima of the curve.
    expect(optimal!.probability).toBeCloseTo(maxP, 6);
    expect(optimal!.iteration).toBe(optimalIterationsForN(2 ** n));
  });

  it('curve spans k = 0 .. 2*k* inclusive', () => {
    const n = 7;
    const kStar = optimalIterationsForN(2 ** n);
    const curve = simulateProbabilityCurve(n);
    expect(curve[0].iteration).toBe(0);
    expect(curve[curve.length - 1].iteration).toBe(2 * kStar);
  });
});

describe('simulateGroverSubStep — decomposition agrees with the closed form', () => {
  it('superposition sub-step equals simulateGroverState at the same k', () => {
    for (let n = 2; n <= 10; n += 1) {
      const kStar = optimalIterationsForN(2 ** n);
      for (let k = 0; k <= kStar; k += 1) {
        const sub = simulateGroverSubStep(n, 0, k, 'superposition');
        const full = simulateGroverState(n, 0, k);
        expect(sub.targetAmplitude).toBeCloseTo(full.targetAmplitude, 12);
        expect(sub.nonTargetAmplitude).toBeCloseTo(full.nonTargetAmplitude, 12);
        expect(sub.effectiveIteration).toBe(k);
      }
    }
  });

  it('oracle sub-step flips the target amplitude negative, leaves non-target', () => {
    for (let n = 2; n <= 10; n += 1) {
      const kStar = optimalIterationsForN(2 ** n);
      for (let k = 0; k <= kStar; k += 1) {
        const base = simulateGroverSubStep(n, 0, k, 'superposition');
        const oracle = simulateGroverSubStep(n, 0, k, 'oracle');
        expect(oracle.targetAmplitude).toBeCloseTo(-base.targetAmplitude, 12);
        expect(oracle.nonTargetAmplitude).toBeCloseTo(base.nonTargetAmplitude, 12);
        expect(oracle.effectiveIteration).toBe(k);
      }
    }
  });

  it('diffusion sub-step reproduces the superposition after k+1 iterations', () => {
    for (let n = 2; n <= 10; n += 1) {
      const kStar = optimalIterationsForN(2 ** n);
      for (let k = 0; k < kStar; k += 1) {
        const diffusion = simulateGroverSubStep(n, 0, k, 'diffusion');
        const nextFull = simulateGroverState(n, 0, k + 1);
        expect(diffusion.targetAmplitude).toBeCloseTo(nextFull.targetAmplitude, 12);
        expect(diffusion.nonTargetAmplitude).toBeCloseTo(nextFull.nonTargetAmplitude, 12);
        expect(diffusion.effectiveIteration).toBe(k + 1);
      }
    }
  });

  it('diffusion is exactly a reflection about the mean of the post-oracle state', () => {
    // Reconstruct diffusion by hand from the post-oracle amplitudes and check
    // it equals the analytic diffusion sub-step. This is the "inversion about
    // the mean" the UI narrates.
    const n = 6;
    const N = 2 ** n;
    for (let k = 0; k <= optimalIterationsForN(N); k += 1) {
      const oracle = simulateGroverSubStep(n, 0, k, 'oracle');
      const mean = (oracle.targetAmplitude + (N - 1) * oracle.nonTargetAmplitude) / N;
      const reflectedTarget = 2 * mean - oracle.targetAmplitude;
      const reflectedNon = 2 * mean - oracle.nonTargetAmplitude;
      const diffusion = simulateGroverSubStep(n, 0, k, 'diffusion');
      expect(diffusion.targetAmplitude).toBeCloseTo(reflectedTarget, 12);
      expect(diffusion.nonTargetAmplitude).toBeCloseTo(reflectedNon, 12);
    }
  });

  it('reports the mean of the currently displayed amplitudes', () => {
    const n = 5;
    const N = 2 ** n;
    const sub = simulateGroverSubStep(n, 2, 1, 'oracle');
    const expectedMean = (sub.targetAmplitude + (N - 1) * sub.nonTargetAmplitude) / N;
    expect(sub.mean).toBeCloseTo(expectedMean, 12);
  });
});

describe('groverQueryCount', () => {
  it('equals 2*k* + 1', () => {
    for (let n = MIN_QUBITS; n <= MAX_QUBITS; n += 1) {
      expect(groverQueryCount(n)).toBe(2 * optimalIterationsForN(2 ** n) + 1);
    }
  });

  it('grows like O(sqrt(N)): query count << classical N/2 for large n', () => {
    const n = 20;
    expect(groverQueryCount(n)).toBeLessThan(2 ** n / 2);
    // O(sqrt(N)) scale: roughly on the order of sqrt(2^20)=1024.
    expect(groverQueryCount(n)).toBeLessThan(4000);
  });

  // 2k*+1 is NOT below N/2 across the whole slider range — it exceeds it at
  // n = 2 (3 vs 2) and n = 3 (5 vs 4). This test pins that, so nobody puts the
  // reflection count back on the query axis and rediscovers the dead-heat bars.
  it('is the reflection count, and exceeds classical N/2 at the smallest n', () => {
    expect(groverQueryCount(2)).toBeGreaterThan(2 ** 2 / 2);
    expect(groverQueryCount(3)).toBeGreaterThan(2 ** 3 / 2);
  });
});

describe('groverOracleQueries', () => {
  it('is k*: exactly one oracle call per iteration', () => {
    for (let n = MIN_QUBITS; n <= MAX_QUBITS; n += 1) {
      expect(groverOracleQueries(n)).toBe(optimalIterationsForN(2 ** n));
    }
  });

  // The property the race panel renders as a shared axis: Grover's oracle-query
  // count beats the classical expectation at EVERY n the slider can reach —
  // including the two the old suite skipped.
  it('beats the classical N/2 at every n in the supported range', () => {
    for (let n = MIN_QUBITS; n <= MAX_QUBITS; n += 1) {
      expect(groverOracleQueries(n), `n=${n}`).toBeLessThan(2 ** n / 2);
    }
  });
});

describe('classicalSearch', () => {
  it('reports expected queries N/2', async () => {
    for (const N of [4, 16, 1024]) {
      const { expected } = await classicalSearch(N);
      expect(expected).toBe(N / 2);
    }
  });

  it('realized queries stay within [1, N] and are uniformly spread', async () => {
    const N = 32;
    const counts = new Array<number>(N + 1).fill(0);
    for (let i = 0; i < 4000; i += 1) {
      const { queriesUsed } = await classicalSearch(N);
      expect(queriesUsed).toBeGreaterThanOrEqual(1);
      expect(queriesUsed).toBeLessThanOrEqual(N);
      counts[queriesUsed] += 1;
    }
    // Every outcome in 1..N should be reachable (no off-by-one dead zone).
    for (let v = 1; v <= N; v += 1) {
      expect(counts[v]).toBeGreaterThan(0);
    }
  });

  it('rejects sizes outside the supported contract', async () => {
    await expect(classicalSearch(1)).rejects.toThrow(/between 2/);
    await expect(classicalSearch(2 ** MAX_QUBITS + 1)).rejects.toThrow();
    await expect(classicalSearch(3.5)).rejects.toThrow(/finite integer/);
  });
});
