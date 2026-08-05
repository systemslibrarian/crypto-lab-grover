# crypto-lab-grover

## What It Is

Grover's algorithm (Lov Grover, 1996) is a quantum search algorithm that finds a marked item in an unstructured search space of N items using O(√N) queries — a quadratic speedup over classical brute force. This demo classically simulates the complete amplitude amplification process with exact mathematical formulas: oracle phase kickback, inversion-about-mean diffusion, and probability oscillation including overshoot past optimal iterations. The security model is symmetric cryptography — Grover is the quantum threat to AES, SHA, and HMAC that Shor's algorithm does not touch. Grover's speedup is provably optimal (BBBV lower bound); no quantum algorithm can search faster than O(√N).

## When to Use It

- **Understanding why AES-256 retains strong post-quantum security margins while AES-128 is weakened** — Under idealized Grover assumptions, effective key length is halved: AES-128 drops to ~2^64 effective operations (potentially feasible), while AES-256 drops to ~2^128 (still strong). In practice, circuit depth makes the real cost far higher than these headline figures.
- **Visualizing Grover as a rotation** — Grover's algorithm *is* two reflections per step (oracle + diffusion) that compose into a rotation by 2θ in the plane spanned by |target⟩ and the wrong answers. The demo shows the state vector rotating on the unit circle, so amplitude concentration and overshoot become geometric facts rather than formulas.
- **Seeing the oracle and diffusion separately** — A "Show oracle + diffusion sub-steps" toggle walks one iteration as two distinct reflections: the oracle flips the target amplitude *negative* (visible as a downward bar), then diffusion inverts every amplitude about the mean (the gold mean line on the signed bar chart). The decomposition is exact — it agrees with the closed form sin((2k+1)θ) to floating-point precision.
- **Teaching the overshoot phenomenon** — The probability curve and the rotation view together show why running more Grover iterations past k* = π/4·√N actually decreases success probability: the state vector rotates *past* the target axis.
- **Comparing Grover and Shor as complementary quantum threats** — The side-by-side comparison table clarifies which algorithms each one breaks and what the mitigation is.
- **Do not use this for public-key cryptography threats** — Grover does not affect RSA, ECC, or Diffie-Hellman; that is Shor's domain.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-grover](https://systemslibrarian.github.io/crypto-lab-grover/)**

Adjust the qubit count (n = 2–20) to resize the search space, step through Grover iterations one at a time or auto-run, and watch the state vector rotate toward the target while the signed amplitude bars concentrate. Enable "Show oracle + diffusion sub-steps" to walk each iteration as its two reflections. The demo also shows AES-128/192/256 quantum impact analysis with an interactive key-size selector, a hash function security table (MD5 through SHA3-512), and a classical-vs-quantum search race animation.

You can deep-link a specific state with query parameters — e.g. `?steps=3` jumps to the optimal iteration, and `?sub=1&steps=1` opens at the oracle sub-step.

## What Can Go Wrong

- **Reading the key-halving as literal feasibility** — "AES-128 → 2^64" is an idealized query count; the per-iteration oracle is a full AES circuit and Grover is inherently sequential, so the real cost is far higher and AES-128 is not practically broken by it.
- **Assuming Grover parallelizes the depth away** — it gives at most a quadratic speedup, and splitting it across machines splits the √N benefit; you cannot brute-force the circuit depth down the way classical search parallelizes.
- **Running too many iterations** — past k* = π/4·√N the state rotates past the target and success probability falls (overshoot); more iterations is not better.
- **Applying it to the wrong primitive** — Grover threatens symmetric keys and hash preimages, not RSA/ECC/DH (that is Shor). Conflating the two misstates the risk.
- **Treating O(√N) as beatable** — the BBBV bound proves no quantum search does better; assuming a future faster generic search is unfounded.

## Real-World Usage

- **Post-quantum symmetric sizing** — NIST CNSA 2.0 recommends AES-256 (and larger hash outputs) so the halved effective strength still clears the security bar.
- **Hash security margins** — Grover halves preimage resistance, so SHA-256 still offers ~128-bit preimage security against a quantum attacker; output sizes are chosen with this in mind.
- **Quantum resource estimation** — Grassl et al. and follow-up work estimate the qubits and circuit depth to run Grover on AES, feeding standards decisions.
- **Migration planning** — symmetric primitives mostly need larger parameters rather than replacement, unlike public-key crypto, which Shor forces onto post-quantum schemes entirely.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-grover
cd crypto-lab-grover
npm install
npm run dev
```

### Tests

```bash
npm test        # unit tests for the DOM-free core math (Vitest)
npm run test:a11y   # WCAG A/AA accessibility gate (Playwright + axe-core)
```

The unit suite pins the classical simulation to its reference math: `θ = asin(1/√N)`, the optimal iteration count `k* = ⌊π/(4θ)⌋`, unit-norm amplitudes, the closed form `sin²((2k+1)θ)`, and the overshoot past `k*`. It also verifies the oracle + diffusion **sub-step decomposition agrees with the closed form to floating-point precision** (the oracle flips the target amplitude negative; diffusion is exactly a reflection about the mean and reproduces the state after `k+1` iterations) — the claim the UI narrates, now enforced in code rather than only in prose. The supported qubit range `n = 2..20` is a single shared contract across the README, the UI slider, and input validation.

## Related Demos

- [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/) — the complementary quantum threat: Shor breaks public-key (RSA/ECC) where Grover only dents symmetric.
- [crypto-lab-harvest-vault](https://systemslibrarian.github.io/crypto-lab-harvest-vault/) — harvest-now-decrypt-later and the Q-Day timeline this speedup feeds into.
- [crypto-lab-aes-modes](https://systemslibrarian.github.io/crypto-lab-aes-modes/) — the AES modes whose key sizes Grover pressures.
- [crypto-lab-hash-zoo](https://systemslibrarian.github.io/crypto-lab-hash-zoo/) — the hash functions whose preimage resistance Grover halves.
- [crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/) — quantum key distribution, the quantum-defense side of the story.

## Learning Instrument

Beyond free-play, the demo is built to teach actively:

- **Guided lesson** — a 5-stage path (search setup → oracle + diffusion → rotation model → overshoot → crypto impact) that drives the simulator stage by stage.
- **Prediction mode** — commit a guess (will probability rise, fall, or hold?) before each Step reveals the answer.
- **Reactive misconception panel** — surfaces the right correction at the moment you're likely to form the wrong idea (oracle ≠ "checks all keys", overshoot, k* ≠ certainty, Grover ≠ Shor).
- **Compare the mental models** — toggle the *same* overshoot fact across algebra, geometry, and amplitude views.
- **Measurement simulator** — "Measure ×100" samples the current state so probability ≠ certainty becomes concrete.
- **Math layer** — the live equations (θ, sin²((2k+1)θ), k*) with the current numbers plugged in.
- **Oracle cost budget** — separates the headline 2^(n/2) *iterations* from the cost *per* oracle call (full AES circuit), with logical-qubit and depth figures.
- **Challenge mode** — short questions with immediate, explained feedback.
- **Assumptions & sources** table and a local **glossary** distinguishing nearby terms (amplitude vs probability, preimage vs collision, symmetric vs public-key).

For classroom use, see the [teaching guide](docs/TEACHING.md) — lesson plans (15- and 45-minute), discussion questions, a printable worksheet, and the challenge-mode answer key.

## Sources

1. **Grover, L. K.** (1996). "A fast quantum mechanical algorithm for database search." *Proceedings of the 28th Annual ACM Symposium on Theory of Computing*, pp. 212–219.
2. **Bennett, C. H., Bernstein, E., Brassard, G., & Vazirani, U.** (1997). "Strengths and weaknesses of quantum computing." *SIAM Journal on Computing*, 26(5), pp. 1510–1523. (BBBV lower bound — proves Grover's O(√N) is optimal.)
3. **Grassl, M., Langenberg, B., Roetteler, M., & Steinwandt, R.** (2016). "Applying Grover's algorithm to AES: Quantum resource estimates." *Post-Quantum Cryptography (PQCrypto 2016)*, LNCS 9606, pp. 29–43. (Source for AES circuit depth and qubit cost estimates.)
4. **NIST** (2024). CNSA 2.0 and post-quantum cryptography transition guidance. Recommends AES-256 for post-quantum symmetric security.
5. **Nielsen, M. A. & Chuang, I. L.** (2010). *Quantum Computation and Quantum Information*. Cambridge University Press. (Standard reference for amplitude amplification.)

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
