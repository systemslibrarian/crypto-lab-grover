# crypto-lab-grover

## What It Is

Browser-based simulation of Grover's quantum search algorithm (Lov Grover,
1996) and its concrete impact on AES, SHA-256, and symmetric cryptography.
Grover is the quantum threat to everything Shor does not break.

While Shor's algorithm completely breaks RSA, ECC, and Diffie-Hellman,
Grover's algorithm only halves the effective security of symmetric
encryption. AES-128 drops from 2^128 to 2^64 effective operations —
potentially feasible for large quantum computers. AES-256 drops from 2^256
to 2^128 — still strong. The fix is exactly doubling your key length.

Simulates the complete Grover amplitude evolution with exact mathematical
formulas: oracle phase kickback, inversion-about-mean diffusion, probability
oscillation including overshoot past optimal iterations. Interactive bar
chart shows amplitude concentrating on the target in real time. No backends.
No simulated shortcuts — the amplitude math is exact.

## When to Use It

- Understanding WHY AES-256 survives quantum computers while AES-128 does not
- Seeing the oracle-and-diffusion loop that makes quantum search quadratically
  faster than classical brute force
- Teaching the overshoot phenomenon — why more Grover iterations past k*
  actually decreases success probability
- Understanding why Grover's fix (double key length) is simpler than Shor's
  fix (replace the entire algorithm)
- Comparing Grover and Shor as complementary quantum threats

## Live Demo

https://systemslibrarian.github.io/crypto-lab-grover/

## What Can Go Wrong

- **Overshoot:** Running past k* = π/4·√N iterations decreases success
  probability. The algorithm is self-defeating if iterated too far.
  The demo shows this explicitly on the probability arc.
- **Circuit depth vs qubit count:** The headline "2^64 queries" for AES-128
  understates the practical cost. Each query requires running the full AES
  circuit coherently. NIST estimates the actual cost at 2^82 logical
  qubit-cycles — significantly harder than 2^64 implies.
- **Hash collisions:** Grover finds preimages in O(2^(n/2)). The
  Brassard-Høyer-Tapp (BHT) algorithm finds collisions in O(2^(n/3)),
  which is worse for hash security than preimage search. SHA-256 collision
  resistance drops from 2^128 (classical) to 2^85 (quantum BHT).
- **Provable optimality:** Grover is asymptotically optimal — no quantum
  algorithm can search N items faster than O(√N). This bound is proven,
  not conjectured. There is no "Grover-killer" algorithm waiting to emerge.

## Real-World Usage

NIST's post-quantum standards recommend AES-256 for symmetric encryption
in the post-quantum era. CNSA 2.0 (NSA's Commercial National Security
Algorithm Suite) mandates AES-256 for national security systems.
SHA-384 and SHA-512 are recommended for hash functions.

The migration for symmetric cryptography is straightforward — it is a
configuration change, not an algorithm replacement. Organizations still
using AES-128 or SHA-256 for long-term sensitive data should plan
migration to AES-256 and SHA-512 respectively.
