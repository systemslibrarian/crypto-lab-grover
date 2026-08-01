export interface KeySizeAnalysis {
  keyBits: number;
  classicalSecurity: number;
  quantumSecurity: number;
  classicalOps: string;
  quantumOps: string;
  optimalGroverIters: string;
  practicalThreat: 'broken' | 'weakened' | 'strong' | 'very-strong';
  recommendation: string;
  nistStatus: string;
}

const KEY_DATA: Record<128 | 192 | 256, Omit<KeySizeAnalysis, 'keyBits' | 'classicalSecurity' | 'quantumSecurity' | 'classicalOps' | 'quantumOps'>> = {
  128: {
    optimalGroverIters: '≈2^64',
    practicalThreat: 'weakened',
    recommendation: 'Upgrade to AES-256. Under idealized Grover assumptions, effective brute-force resistance drops to ~2^64 operations — potentially feasible for a large quantum computer, though circuit depth makes practical cost much higher.',
    nistStatus: 'Not recommended for post-quantum use',
  },
  192: {
    optimalGroverIters: '≈2^96',
    practicalThreat: 'weakened',
    recommendation: 'Upgrade to AES-256. While 2^96 is still very large, AES-256 provides a stronger margin.',
    nistStatus: 'Upgrade to AES-256 recommended',
  },
  256: {
    optimalGroverIters: '≈2^128',
    practicalThreat: 'strong',
    recommendation: 'Keep — 2^128 effective operations remains strong post-quantum.',
    nistStatus: 'Recommended for post-quantum symmetric encryption (CNSA 2.0)',
  },
};

export function analyzeKeySize(keyBits: 128 | 192 | 256): KeySizeAnalysis {
  const data = KEY_DATA[keyBits];
  return {
    keyBits,
    classicalSecurity: keyBits,
    quantumSecurity: keyBits / 2,
    classicalOps: `2^${keyBits}`,
    quantumOps: `2^${keyBits / 2}`,
    ...data,
  };
}

const QUBIT_COSTS: Record<128 | 192 | 256, { logicalQubits: number; circuitDepthExponent: number; note: string }> = {
  128: {
    logicalQubits: 2953,
    circuitDepthExponent: 82,
    note: 'Each Grover iteration requires running the entire AES-128 circuit coherently. Circuit depth makes the attack significantly more expensive than the headline 2^64 figure suggests.',
  },
  192: {
    logicalQubits: 4449,
    circuitDepthExponent: 114,
    note: 'AES-192 requires deeper circuits per Grover iteration. Practical cost is substantially higher than 2^96 oracle calls.',
  },
  256: {
    logicalQubits: 6681,
    circuitDepthExponent: 146,
    note: 'AES-256 Grover attack requires 2^128 iterations each with a deep AES-256 circuit. Total full depth of ~2^146 logical qubit-cycles is far beyond foreseeable quantum capability. (Grassl et al. report full depth 1.57 * 2^145 for AES-256; their total gate count is a separate, larger figure of ~2^151.)',
  },
};

export function aesQuantumCost(keyBits: 128 | 192 | 256): {
  logicalQubits: number;
  circuitDepthExponent: number;
  note: string;
} {
  return QUBIT_COSTS[keyBits];
}

export function analyzeHashFunction(outputBits: number): {
  classicalPreimage: string;
  quantumPreimage: string;
  classicalCollision: string;
  quantumCollision: string;
  recommendation: string;
} {
  if (!Number.isInteger(outputBits) || outputBits <= 0) {
    throw new Error('outputBits must be a positive integer.');
  }

  const halfBits = outputBits / 2;
  const thirdBits = Math.floor(outputBits / 3);

  return {
    classicalPreimage: `2^${outputBits}`,
    quantumPreimage: `2^${halfBits}`,
    classicalCollision: `2^${halfBits}`,
    quantumCollision: `2^${thirdBits}`,
    recommendation:
      halfBits >= 128
        ? halfBits >= 192
          ? 'Very strong post-quantum security'
          : 'Adequate post-quantum security'
        : 'Insufficient post-quantum security — upgrade to a larger output hash',
  };
}
