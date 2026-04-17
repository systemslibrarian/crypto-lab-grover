# crypto-lab-grover

## What It Is

Grover's algorithm (Lov Grover, 1996) is a quantum search algorithm that finds a marked item in an unstructured search space of N items using O(√N) queries — a quadratic speedup over classical brute force. This demo simulates the complete amplitude amplification process with exact mathematical formulas: oracle phase kickback, inversion-about-mean diffusion, and probability oscillation including overshoot past optimal iterations. The security model is symmetric cryptography — Grover is the quantum threat to AES, SHA, and HMAC that Shor's algorithm does not touch. Grover's speedup is provably optimal; no quantum algorithm can search faster than O(√N).

## When to Use It

- **Understanding why AES-256 survives quantum computers while AES-128 does not** — Grover halves effective key length, dropping AES-128 to 2^64 effective operations (potentially feasible) while AES-256 drops only to 2^128 (still strong).
- **Visualizing the oracle-and-diffusion loop** — the amplitude bar chart shows probability concentrating on the target state in real time, making the quadratic speedup intuitive.
- **Teaching the overshoot phenomenon** — the probability curve shows why running more Grover iterations past k* = π/4·√N actually decreases success probability.
- **Comparing Grover and Shor as complementary quantum threats** — the side-by-side comparison table clarifies which algorithms each one breaks and what the fix is.
- **Do not use this for public-key cryptography threats** — Grover does not affect RSA, ECC, or Diffie-Hellman; that is Shor's domain.

## Live Demo

[https://systemslibrarian.github.io/crypto-lab-grover/](https://systemslibrarian.github.io/crypto-lab-grover/)

Adjust the qubit count (n = 2–20) to resize the search space, step through Grover iterations one at a time or auto-run, and watch amplitude concentrate on the target state. The demo also shows AES-128/192/256 quantum impact cards, a hash function security table (MD5 through SHA3-512), and a classical-vs-quantum search race animation.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-grover
cd crypto-lab-grover
npm install
npm run dev
```

## Part of the Crypto-Lab Suite

> One of 60+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
