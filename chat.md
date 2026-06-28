# Gold-standard teaching recommendations for crypto-lab-grover

## Evidence from the current demo

The repo already has strong raw material:

- [README.md](README.md#L3) frames Grover as amplitude amplification, not just a headline speedup.
- [README.md](README.md#L7) identifies the main security lesson: AES-128 is weakened under idealized Grover assumptions while AES-256 keeps a strong margin.
- [src/main.ts](src/main.ts#L786) opens with a useful "What This Demonstrates" narrative.
- [src/main.ts](src/main.ts#L811) already lets learners split a Grover iteration into oracle and diffusion sub-steps.
- [src/main.ts](src/main.ts#L820) and [src/main.ts](src/main.ts#L821) make the key geometric idea visible with the rotation canvas.
- [src/main.ts](src/main.ts#L885) correctly emphasizes that circuit depth matters more than qubit count for AES cost realism.
- [src/main.ts](src/main.ts#L942) and [src/main.ts](src/main.ts#L964) connect the algorithm lesson to practical cryptographic intuition.

That means the next leap is not more content for its own sake. The gold-standard move is to turn the demo from a rich visualization into a guided learning instrument with prediction, feedback, misconception correction, source traceability, and assessment.

## North star

A learner should leave able to explain, without hand-waving:

01. What problem Grover solves: unstructured search with a marked item.
02. Why the speedup is quadratic, not exponential: about sqrt(N) oracle queries.
03. What the oracle does: phase-flips the marked state rather than "checking every key in parallel" in a magical sense.
04. What diffusion does: reflects amplitudes about the mean.
05. Why oracle plus diffusion is a rotation in a 2D subspace.
06. Why there is an optimal stopping point and why overshoot lowers success probability.
07. Why measuring gives probability, not certainty.
08. Why AES-128 is weakened but not instantly broken.
09. Why AES-256 remains a strong symmetric post-quantum choice.
10. Why Grover and Shor are different threats requiring different mitigations.

## Highest-impact improvements

01. Add a guided lesson mode

Create a structured path with five short stages:

1. Search setup: N states, one hidden target, classical expected search cost.
2. First Grover step: oracle phase flip, then diffusion reflection.
3. Rotation model: show theta, 2*theta per iteration, and k*.
4. Overshoot: ask the learner to predict what happens if they keep stepping.
5. Crypto impact: map the same math onto AES and hash preimage search.

Keep the existing free-play simulator, but add a "Lesson" toggle or stepper so the first-time path is not just exploratory. The current demo has all the parts; it needs a canonical route through them.

02. Add prediction checkpoints before reveal

Gold-standard interactive teaching makes the learner commit before the animation answers. Add small prompts such as:

- "Before clicking Step: will target probability increase, decrease, or stay about the same?"
- "After the oracle: which amplitude should be negative?"
- "After diffusion: should the mean line move up or down?"
- "At k*: should another iteration help or hurt?"
- "For AES-256: what is the idealized Grover cost? 2^64, 2^96, or 2^128?"

Then reveal the answer using the existing animation state. This single change would make the demo teach much more actively.

03. Add a misconception panel that reacts to state

The most important misconceptions to confront directly:

- "Quantum search tries all keys and then reads the answer." Correction: amplitudes interfere, and measurement is probabilistic.
- "More Grover iterations are always better." Correction: overshoot rotates past the target axis.
- "Grover breaks AES the way Shor breaks RSA." Correction: Grover gives only a quadratic speedup.
- "2^(n/2) is the full attack cost." Correction: each oracle call requires a reversible circuit, error correction, and coherent AES evaluation.
- "Grover also gives a 2^(n/2) collision attack." Correction: hash collision quantum attacks have different bounds than preimage search; keep BHT distinct.

These corrections should appear at the exact moment a learner is likely to form the wrong idea, not only in a static text block.

04. Add a measurement simulator

Right now the probability curve communicates success probability well, but a learner can still miss that measurement is sampled. Add a "Measure 100 times" button at the current k and show a small histogram:

- target outcomes
- non-target outcomes
- empirical success rate
- theoretical success probability

This would make "probability amplitude" concrete. It also reinforces why k* is useful but not magic certainty.

05. Add equation overlays tied to the visuals

The visualizations are strong. The math should be discoverable in place:

- theta = asin(1 / sqrt(N))
- target amplitude after k iterations = sin((2k + 1)theta)
- success probability = sin^2((2k + 1)theta)
- k* approx floor(pi / (4theta))
- Grover query count approx O(sqrt(N))

Show these in a collapsible "Math layer" beside the rotation and probability plots. Highlight the symbol currently being visualized. For example, when the vector angle changes, highlight `(2k + 1)theta`; when the probability dot moves, highlight `sin^2(...)`.

06. Make the oracle cost visible as a budget, not just a note

The AES section already says circuit depth matters. Make that interactive:

- key size selector: AES-128, AES-192, AES-256
- idealized Grover oracle calls
- logical qubits from the cited estimates
- circuit depth exponent
- estimated logical qubit-cycles
- a clear label: "lower-bound style estimate, not a practical wall-clock prediction"

The key teaching improvement is separating "number of Grover iterations" from "cost per iteration." That distinction is the difference between pop-science Grover and serious crypto engineering.

07. Add a source-traceable assumptions table

The README has sources, but the app should expose the assumptions behind each headline number. Add a compact table:

- Claim: Grover query complexity is O(sqrt(N)); source: Grover 1996 / BBBV 1997.
- Claim: optimality lower bound; source: BBBV 1997.
- Claim: AES logical qubit and depth estimates; source: Grassl et al. 2016.
- Claim: AES-256 post-quantum recommendation; source: NIST/CNSA guidance.
- Claim: Shor breaks RSA/ECC; source: standard quantum algorithms references.

This makes the demo citable and classroom-ready.

08. Add a "compare the mental models" section

Use three compact views of the same fact:

- Algebra: sin^2((2k + 1)theta)
- Geometry: rotation toward the target axis
- Amplitudes: oracle flip plus diffusion about the mean

Let the learner toggle among them and ask: "Which view explains overshoot best?" This will help different learners form the same concept from different routes.

09. Add challenge mode

After the lesson, provide short tasks:

- Given n = 5, predict the approximate optimal k before running.
- Turn on sub-steps and identify the oracle phase flip.
- Find the first k where probability starts decreasing.
- Decide whether AES-128, AES-192, or AES-256 is acceptable for a high-assurance post-quantum setting.
- Explain why Shor is irrelevant to AES but relevant to RSA/ECC.

Make answers immediate and explanatory. This gives the demo assessment value, not just demonstration value.

10. Add a glossary that distinguishes nearby terms

Suggested terms:

- amplitude
- probability
- phase
- oracle
- diffusion operator
- marked item
- query complexity
- circuit depth
- logical qubit
- error correction
- preimage resistance
- collision resistance
- symmetric cryptography
- public-key cryptography

The glossary should be terse and local to the demo. Avoid turning it into a textbook.

## Accuracy upgrades

01. Be precise about AES-128 language

Use wording like: "AES-128 has about 64 bits of idealized Grover query security, but practical resource estimates are far higher because each query is an expensive reversible AES circuit." Avoid implying AES-128 is practically broken today.

02. Separate preimage and collision lessons

The hash table includes quantum preimage and quantum collision columns. Make clear that Grover is the preimage story, while collision search uses different quantum algorithms and bounds. This prevents learners from overgeneralizing the key-halving rule.

03. Clarify single-target versus multi-target search

The current simulator uses one marked target. Add a note or advanced control for M marked items, where the speed becomes roughly sqrt(N/M). This is especially useful for crypto contexts where multiple keys or outputs can satisfy a condition.

04. Explain why k* is approximate

For small N, the optimal integer iteration count is a rounded/floored value because the rotation rarely lands exactly on the target axis. This is a good chance to teach discretization rather than hiding it.

05. Say what the simulator intentionally omits

The app already says it is not modeling noise or hardware. Expand that into a concise "Model boundary" block:

- no decoherence
- no physical qubits
- no gate synthesis
- no error correction overhead simulation
- no wall-clock attack forecast
- no real AES implementation inside a quantum oracle

This makes the simulation more trustworthy, not less.

## UX and accessibility upgrades

01. Provide non-canvas data equivalents

The rotation and probability canvases are central. Add nearby textual readouts or tables for:

- current angle
- theta
- current k
- k*
- target amplitude
- target probability
- whether probability is rising or falling

Some of this exists in live regions and amplitude values; make it consistently visible and screen-reader reachable.

02. Add a replayable explanation transcript

For classroom use, add a compact transcript of the current lesson step. It should update as learners step through oracle, diffusion, and overshoot.

03. Improve mobile teaching flow

On small screens, the rotation view and amplitude bars stack. Make sure the lesson stepper keeps the relevant explanation adjacent to the active visualization, otherwise learners may see the effect without the reason.

04. Add keyboard-accessible controls for the full lesson

The app already has keyboard shortcuts for step, auto-run, and reset. Extend that care to lesson navigation, challenge answers, and measurement simulation.

## Documentation upgrades

01. Add a teacher guide

Create a teacher guide with:

- target audience
- prerequisites
- 15-minute lesson plan
- 45-minute lesson plan
- discussion questions
- common misconceptions
- answer key for challenge mode

02. Add a learner worksheet

Create a learner worksheet with prediction prompts, small calculations, and reflection questions. This makes the demo usable outside the browser session.

03. Add a math appendix

Create a math appendix with the derivation of the 2D rotation model. Keep the app lightweight, but give advanced learners a precise path.

04. Add a crypto appendix

Create a crypto appendix separating:

- AES key search
- hash preimage search
- hash collision search
- HMAC considerations
- Shor versus Grover
- practical resource caveats

## Engineering quality upgrades that support teaching trust

01. Add tests for mathematical invariants

Examples:

- amplitudes remain normalized
- sub-step diffusion equals the next full iteration
- probability curve peak matches k*
- overshoot decreases probability after k* for representative N
- input validation rejects invalid n, targetIndex, and iteration values

02. Add visual regression snapshots for key states

Capture a few deterministic states:

- n = 4, k = 0
- n = 4, oracle sub-step
- n = 4, diffusion sub-step
- n = 4, k = k*
- n = 4, overshoot

This protects the teaching visuals from accidental regressions.

03. Add deterministic demo seeds

Random target selection is useful, but teaching benefits from reproducibility. Support query parameters like:

- `?n=4&target=7&steps=0`
- `?n=4&target=7&sub=1&steps=1`

The README already mentions deep links for steps and sub-steps; adding n and target would make shared lessons precise.

## Suggested implementation order

01. Quick win: add the learner objectives and misconception corrections.
02. Quick win: add n and target query parameters for deterministic lessons.
03. Medium: add prediction checkpoints around the existing Step flow.
04. Medium: add the measurement simulator and histogram.
05. Medium: add the math layer tied to the existing visuals.
06. Medium: add source-traceable assumptions in the AES/hash section.
07. Larger: add challenge mode with immediate feedback.
08. Larger: add teacher guide, worksheet, and appendices.
09. Larger: add unit and visual regression tests.

## What not to add

- Do not add fake quantum hardware animations that imply physical accuracy.
- Do not imply Grover makes AES-128 currently broken in practice.
- Do not blur Grover and Shor into one generic "quantum breaks crypto" story.
- Do not hide oracle cost behind the simple 2^(n/2) headline.
- Do not add more panels unless they participate in the learning path.

## Bottom line

This demo can become the gold standard by making the learner predict, observe, explain, and then transfer the idea to cryptography. The existing visual core is already strong. The highest-value upgrades are guided sequencing, misconception checks, measurement sampling, source-traceable assumptions, and focused assessment.