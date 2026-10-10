import { describe, expect, it } from 'vitest';
import { analyzeKeySize, aesQuantumCost } from './aes-impact';

describe('AES guidance is distinct from idealized query strength', () => {
  for (const bits of [128, 192, 256] as const) {
    it(`permits current AES-${bits} use under NIST guidance while retaining the idealized arithmetic`, () => {
      const analysis = analyzeKeySize(bits);
      expect(analysis.nistStatus).toMatch(/current applications.*continue.*128.*192.*256/i);
      expect(analysis.nistStatus).not.toMatch(/not recommended|upgrade.*recommended|CNSA/i);
      expect(analysis.classicalSecurity).toBe(bits);
      expect(analysis.quantumSecurity).toBe(bits / 2);
      expect(analysis.quantumOps).toBe(`2^${bits / 2}`);
      expect(aesQuantumCost(bits).circuitDepthExponent).toBeGreaterThan(bits / 2);
      expect(analysis.recommendation).toMatch(/lab.*(choice|margin)/i);
    });
  }
});
