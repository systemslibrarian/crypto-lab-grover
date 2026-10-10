// Keep policy scope separate from the idealized n/2 query exponent below.
export const AES_GUIDANCE = {
  nist: 'NIST’s PQC FAQ permits current applications to continue AES with 128, 192 or 256-bit keys; idealized query counts are not practical attack costs.',
  nsa: 'NSA’s CNSA profile selects AES-256 for national security systems within its scope; this is separate from NIST’s general guidance.',
  lab: 'Lab design choice: AES-256 provides extra margin when requirements and compatibility permit, not a blanket NIST migration mandate.',
} as const;

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
    recommendation: 'Lab design choice: consider AES-256 for extra margin. The ~2^64 figure counts idealized Grover oracle calls; running a coherent AES circuit for each call makes practical cost much higher. It is not evidence that AES-128 is broken.',
    nistStatus: AES_GUIDANCE.nist,
  },
  192: {
    optimalGroverIters: '≈2^96',
    practicalThreat: 'weakened',
    recommendation: 'Lab design choice: AES-256 offers extra margin; ~2^96 idealized oracle calls do not establish a practical attack on AES-192.',
    nistStatus: AES_GUIDANCE.nist,
  },
  256: {
    optimalGroverIters: '≈2^128',
    practicalThreat: 'strong',
    recommendation: 'Lab margin choice: AES-256 retains ~2^128 idealized query resistance, with substantially greater practical circuit cost.',
    nistStatus: AES_GUIDANCE.nist,
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
