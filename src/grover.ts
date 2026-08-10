export interface GroverState {
  n: number;
  N: number;
  targetIndex: number;
  iteration: number;
  optimalIterations: number;
  targetAmplitude: number;
  nonTargetAmplitude: number;
  successProbability: number;
  amplitudes: number[];
  truncated: boolean;
}

/**
 * Supported qubit range for the simulator. This is the demo's public contract:
 * the UI slider, the README, and the core math all share these bounds. The
 * lower bound is 2 (so N >= 4 and the non-target subspace N-1 is non-trivial);
 * the upper bound is 20 (N up to ~10^6, the largest space the amplitude views
 * meaningfully render).
 */
export const MIN_QUBITS = 2;
export const MAX_QUBITS = 20;

function assertFiniteInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be a finite integer.`);
  }
}

function assertQubitRange(n: number): void {
  assertFiniteInteger(n, 'n');
  if (n < MIN_QUBITS || n > MAX_QUBITS) {
    throw new Error(`n must be between ${MIN_QUBITS} and ${MAX_QUBITS}.`);
  }
}

function validateInputs(n: number, targetIndex: number, iteration: number): number {
  assertQubitRange(n);
  assertFiniteInteger(targetIndex, 'targetIndex');
  assertFiniteInteger(iteration, 'iteration');

  if (iteration < 0) {
    throw new Error('iteration must be >= 0.');
  }

  const N = 2 ** n;

  if (targetIndex < 0 || targetIndex >= N) {
    throw new Error(`targetIndex must be in [0, ${N - 1}].`);
  }

  return N;
}

/**
 * Optimal number of Grover iterations k* = ⌊π / (4θ)⌋ for a space of size N,
 * where sin(θ) = 1/√N. This is the rotation count that lands the state vector
 * closest to the target axis; running past it overshoots.
 */
export function optimalIterationsForN(N: number): number {
  const theta = Math.asin(1 / Math.sqrt(N));
  return Math.floor(Math.PI / (4 * theta));
}

// Classical simulation of Grover's algorithm
// Models amplitude amplification mathematically
// Not quantum hardware execution

/**
 * Compute the angle theta for Grover's algorithm.
 * sin(theta) = 1 / sqrt(N) where N = 2^n.
 */
export function groverTheta(n: number): number {
  assertQubitRange(n);
  const N = 2 ** n;
  return Math.asin(1 / Math.sqrt(N));
}

function sampledIndices(N: number, targetIndex: number): number[] {
  const idx = new Set<number>();

  for (let i = 0; i < Math.min(16, N); i += 1) {
    idx.add(i);
  }

  for (let i = targetIndex - 2; i <= targetIndex + 2; i += 1) {
    if (i >= 0 && i < N) {
      idx.add(i);
    }
  }

  return Array.from(idx).sort((a, b) => a - b);
}

/**
 * Simulate Grover amplitude state after k iterations.
 * Classical simulation — models amplitude amplification mathematically,
 * not quantum hardware execution.
 */
export function simulateGroverState(
  n: number,
  targetIndex: number,
  iteration: number,
): GroverState {
  const N = validateInputs(n, targetIndex, iteration);
  const theta = groverTheta(n);
  const phaseAngle = (2 * iteration + 1) * theta;

  const targetAmplitude = Math.sin(phaseAngle);
  const nonTargetAmplitude = Math.cos(phaseAngle) / Math.sqrt(N - 1);
  const successProbability = targetAmplitude ** 2;
  const optimalIterations = optimalIterationsForN(N);

  const truncated = n > 16;
  let amplitudes: number[];

  if (!truncated) {
    amplitudes = Array.from({ length: N }, (_, i) =>
      i === targetIndex ? targetAmplitude : nonTargetAmplitude,
    );
  } else {
    const keep = sampledIndices(N, targetIndex);
    amplitudes = keep.map((i) => (i === targetIndex ? targetAmplitude : nonTargetAmplitude));
  }

  return {
    n,
    N,
    targetIndex,
    iteration,
    optimalIterations,
    targetAmplitude,
    nonTargetAmplitude,
    successProbability,
    amplitudes,
    truncated,
  };
}

/* ── Sub-step decomposition: oracle reflection + diffusion reflection ──
 * A single Grover iteration is two reflections that compose into a rotation
 * by 2θ in the plane spanned by |target⟩ and |non-target⟩:
 *   1. ORACLE     — flip the sign of the target amplitude (reflect across
 *                   the |non-target⟩ axis).
 *   2. DIFFUSION  — invert every amplitude about the mean (reflect across
 *                   the uniform-superposition axis).
 * These exact amplitudes agree with the closed form sin((2k+1)θ); the
 * decomposition just exposes the mechanism step by step. */

export type SubPhase = 'superposition' | 'oracle' | 'diffusion';

export interface GroverSubStep {
  n: number;
  N: number;
  targetIndex: number;
  /** Completed full iterations entering this sub-step. */
  iteration: number;
  subPhase: SubPhase;
  /** Effective iteration count for probability/banner purposes. */
  effectiveIteration: number;
  optimalIterations: number;
  targetAmplitude: number;
  nonTargetAmplitude: number;
  /** Mean amplitude of the current state — the axis diffusion reflects about. */
  mean: number;
  /** Angle of the state vector from the |non-target⟩ axis, in radians. */
  angle: number;
  successProbability: number;
  amplitudes: number[];
  truncated: boolean;
}

/**
 * Exact amplitudes for one sub-step of Grover's algorithm.
 * Classical simulation — models the two reflections mathematically,
 * not quantum hardware execution.
 */
export function simulateGroverSubStep(
  n: number,
  targetIndex: number,
  iteration: number,
  subPhase: SubPhase,
): GroverSubStep {
  const N = validateInputs(n, targetIndex, iteration);
  const theta = groverTheta(n);
  const optimalIterations = optimalIterationsForN(N);

  // State after `iteration` full iterations (the entry superposition).
  const phaseAngle = (2 * iteration + 1) * theta;
  const baseTarget = Math.sin(phaseAngle);
  const baseNon = Math.cos(phaseAngle) / Math.sqrt(N - 1);

  let targetAmplitude: number;
  let nonTargetAmplitude: number;
  let effectiveIteration: number;
  let angle: number;

  if (subPhase === 'superposition') {
    targetAmplitude = baseTarget;
    nonTargetAmplitude = baseNon;
    effectiveIteration = iteration;
    angle = phaseAngle;
  } else if (subPhase === 'oracle') {
    // Reflect across the |non-target⟩ axis: negate the target amplitude.
    targetAmplitude = -baseTarget;
    nonTargetAmplitude = baseNon;
    effectiveIteration = iteration;
    angle = -phaseAngle;
  } else {
    // Diffusion: invert about the mean of the post-oracle state. This yields
    // exactly the superposition after iteration + 1.
    const next = (2 * (iteration + 1) + 1) * theta;
    targetAmplitude = Math.sin(next);
    nonTargetAmplitude = Math.cos(next) / Math.sqrt(N - 1);
    effectiveIteration = iteration + 1;
    angle = next;
  }

  // Mean of the *current* displayed amplitudes (for the live mean line).
  const mean = (targetAmplitude + (N - 1) * nonTargetAmplitude) / N;
  const successProbability = targetAmplitude ** 2;

  const truncated = n > 16;
  let amplitudes: number[];
  if (!truncated) {
    amplitudes = Array.from({ length: N }, (_, i) =>
      i === targetIndex ? targetAmplitude : nonTargetAmplitude,
    );
  } else {
    const keep = sampledIndices(N, targetIndex);
    amplitudes = keep.map((i) => (i === targetIndex ? targetAmplitude : nonTargetAmplitude));
  }

  return {
    n,
    N,
    targetIndex,
    iteration,
    subPhase,
    effectiveIteration,
    optimalIterations,
    targetAmplitude,
    nonTargetAmplitude,
    mean,
    angle,
    successProbability,
    amplitudes,
    truncated,
  };
}

/**
 * Simulate success probability curve across all k from 0 to 2*k*.
 * Classical computation of sin²((2k+1)θ) — not a quantum measurement.
 */
export function simulateProbabilityCurve(n: number): Array<{
  iteration: number;
  probability: number;
  isOptimal: boolean;
}> {
  assertQubitRange(n);

  const N = 2 ** n;
  const theta = groverTheta(n);
  const kStar = optimalIterationsForN(N);
  const maxK = 2 * kStar;

  const points: Array<{ iteration: number; probability: number; isOptimal: boolean }> = [];

  for (let k = 0; k <= maxK; k += 1) {
    const probability = Math.sin((2 * k + 1) * theta) ** 2;
    points.push({ iteration: k, probability, isOptimal: k === kStar });
  }

  return points;
}

function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new Error('maxExclusive must be an integer in (0, 2^32].');
  }

  const maxUint = 0x1_0000_0000;
  const limit = maxUint - (maxUint % maxExclusive);
  const buffer = new Uint32Array(1);

  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? 0;
  } while (value >= limit);

  return value % maxExclusive;
}

/**
 * Classical search expected queries and randomized realized queries.
 */
export async function classicalSearch(N: number): Promise<{
  queriesUsed: number;
  expected: number;
}> {
  assertFiniteInteger(N, 'N');
  if (N < 2 || N > 2 ** MAX_QUBITS) {
    throw new Error(`N must be between 2 and 2^${MAX_QUBITS}.`);
  }

  const queriesUsed = cryptoRandomInt(N) + 1;
  return {
    queriesUsed,
    expected: N / 2,
  };
}

/**
 * Number of ORACLE QUERIES Grover makes: exactly k*, one per iteration.
 *
 * This is the quantity the glossary defines as query complexity ("number of
 * oracle calls"), and the only one that may be compared against the classical
 * N/2 on a shared query axis. `groverQueryCount` below counts something else.
 */
export function groverOracleQueries(n: number): number {
  assertQubitRange(n);
  return optimalIterationsForN(2 ** n);
}

/**
 * Total REFLECTIONS applied, 2*k* + 1 — the initial superposition plus an
 * oracle and a diffusion per iteration.
 *
 * This is not a query count: diffusion touches no oracle. Racing this against
 * the classical N/2 overstates Grover's cost by ~2x, and below n = 4 it
 * overstates it past the classical figure entirely (n = 2: 3 vs 2), which is
 * how the race bars once rendered a dead heat at the slider's own minimum.
 * Use `groverOracleQueries` for anything on the query axis.
 */
export function groverQueryCount(n: number): number {
  assertQubitRange(n);
  const kStar = optimalIterationsForN(2 ** n);
  return 2 * kStar + 1;
}
