# Teaching guide — Grover's algorithm & symmetric crypto

A classroom companion to the [interactive demo](https://systemslibrarian.github.io/crypto-lab-grover/).
The app is the instrument; this is the lesson plan, worksheet, and answer key.

## Audience & prerequisites

- **Audience:** undergraduate CS/security students, bootcamp learners, or
  self-teachers with curiosity about quantum computing's impact on cryptography.
- **Prerequisites:** comfort with exponents and basic probability. No quantum
  mechanics or linear algebra required — the demo builds the 2-D rotation
  picture from scratch. A little trigonometry (sine, squaring) helps for the
  math layer but isn't essential.

## Learning objectives

By the end, a learner should be able to explain, without hand-waving:

1. What problem Grover solves — unstructured search for a marked item.
2. Why the speedup is **quadratic** (≈√N queries), not exponential.
3. What the **oracle** does — phase-flips the marked state; it does not "read" the answer.
4. What **diffusion** does — reflects amplitudes about the mean.
5. Why oracle + diffusion is a **rotation** by 2θ in a 2-D subspace.
6. Why there's an **optimal stopping point** (k*) and why overshoot lowers success.
7. Why measuring gives a **probability**, not a certainty.
8. Why **AES-128** is weakened (≈2⁶⁴ idealized) but not instantly broken.
9. Why **AES-256** remains a strong post-quantum symmetric choice.
10. Why **Grover and Shor** are different threats with different mitigations.

## 15-minute lesson (live demo)

| Time | Activity | Demo control |
|------|----------|--------------|
| 0–2 min | Frame the problem: one correct key among N. Ask: "classically, how many tries on average?" (≈N/2.) | n-slider at 4 |
| 2–5 min | Run **Guided Lesson** stages 1–2. Pause on the oracle: the target bar goes *negative*. Stress: nothing is read out yet. | Guided Lesson → Next |
| 5–8 min | Stage 3 (rotation) + stage 4 (overshoot). Ask the overshoot prediction *before* clicking. | Lesson + Prediction mode |
| 8–11 min | "Measure ×100." Empirical vs theoretical. Why k* isn't certainty. | Measure ×100 |
| 11–14 min | Stage 5: map the math to AES. Open **The Real Cost of One Oracle Call**; contrast iterations vs cost-per-call. | Budget panel, key-size selector |
| 14–15 min | Close on Grover ≠ Shor: quadratic dent vs exponential break. | Grover vs Shor table |

## 45-minute lesson (hands-on)

1. **(10 min) Free play.** Learners vary n (4 → 8 → 12), find k* by eye on the
   probability curve, and confirm it scales like √N, not N.
2. **(10 min) Decomposition.** Turn on sub-steps. Identify which step flips the
   sign (oracle) and which lifts the amplitude (diffusion). Tie to the rotation
   view: two reflections = one rotation by 2θ.
3. **(10 min) Prediction drills.** Prediction mode on. Predict the direction of
   probability change at k = 0, near k*, and past k*. Discuss misses.
4. **(10 min) Crypto transfer.** Compare AES-128/192/256 in the budget panel.
   Separate "number of iterations" from "cost per iteration." Discuss why the
   2^(n/2) headline understates real cost.
5. **(5 min) Challenge mode** as an exit ticket.

## Discussion questions

- If Grover only needs ≈√N queries, why isn't AES-128 considered broken today?
- Why does running *more* Grover iterations eventually hurt? What's the geometric reason?
- The oracle "recognizes" the right key. Doesn't that mean we already know it? (Resolve the apparent paradox.)
- Why does doubling the key length restore the original security margin?
- Why doesn't Shor threaten AES, and why doesn't Grover threaten RSA the way Shor does?

## Common misconceptions (and corrections)

The app surfaces these reactively; here they are for the instructor:

- *"Quantum search tries all keys at once and reads the winner."* → Amplitudes
  interfere; measurement is probabilistic. No parallel read-out.
- *"More iterations are always better."* → Overshoot: the state rotates past the
  target axis and probability falls.
- *"Grover breaks AES like Shor breaks RSA."* → Grover is a quadratic speedup; Shor is exponential.
- *"2^(n/2) is the full attack cost."* → Each query is an expensive reversible AES
  circuit; circuit depth and error correction dominate.
- *"Grover gives a 2^(n/2) collision attack too."* → Collision search (BHT, ≈2^(n/3))
  is a different algorithm with different — and memory-bound — bounds.

## Challenge-mode answer key

1. **k\* for n = 5 (N = 32): ≈ 4.** k* = ⌊π/(4θ)⌋, θ = asin(1/√32) ≈ 10.2°, so ⌊4.44⌋ = 4. Scales like √N ≈ 5.7, not N.
2. **Which step flips the target negative? Oracle.** It reflects across the non-target axis (phase flip). Diffusion then reflects about the mean.
3. **Idealized Grover cost for AES-256: ≈ 2¹²⁸.** Grover halves effective key length (2²⁵⁶ → 2¹²⁸) — still far beyond reach.
4. **Is Shor a threat to AES? No.** Shor targets public-key (RSA/ECC/DH). AES is symmetric; only Grover applies, quadratically.
5. **Do more iterations always help? No.** Past k*, probability decreases (overshoot).

## Worksheet (printable prompts)

> Use the demo at the URL above. Set n = 4 unless told otherwise.

1. With n = 4, N = ____. Classically, expected number of tries to find the key = ____.
2. Read k* off the probability curve: k* = ____. Roughly, k* ≈ (π/4)·√N = ____.
3. Turn on sub-steps. After the **oracle**, the target amplitude is (positive / negative). After **diffusion**, it is (larger / smaller) than before.
4. Predict before stepping from k = 0 to k = 1: probability will (rise / fall / stay). Then check. Were you right? ____
5. Predict from k = k* to k = k*+1: probability will (rise / fall / stay). Why? ____
6. Press "Measure ×100" at k*. Empirical success = ____%. Theoretical = ____%. Why do they differ? ____
7. In the budget panel, AES-128: Grover iterations ≈ 2^____; total circuit depth ≈ 2^____. Which is bigger, and what does the gap represent? ____
8. One sentence: why is AES-256 a fine post-quantum choice but RSA-2048 is not?

*Answer key for the worksheet mirrors the demo's live readouts; numbers 1–2 are N = 16, ≈8, k* = 3, (π/4)·4 ≈ 3.1.*

## Model boundaries (say this out loud)

The demo is exact **classical** math for an **idealized** Grover. It does **not**
model decoherence, physical qubits, gate synthesis, error-correction overhead, or
wall-clock attack time, and there is no real AES circuit inside the oracle. The
cost figures are lower-bound–style estimates (Grassl et al. 2016), not attack
forecasts. See "About This Demo" and "Assumptions & Sources" in the app.
