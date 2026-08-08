import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing. Almost nothing this lab teaches is on screen at first paint:
 *     the guided lesson body, the prediction prompt and its verdicts, the
 *     measurement grid, the overshoot banner, the challenge feedback and all
 *     three disclosures are empty or closed until something is clicked.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  await expect(page.locator('#n-slider')).toBeVisible();
  await expect(page.locator('#step-btn')).toBeVisible();
  await expect(page.locator('#challenge-list .challenge-card').first()).toBeVisible();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it lays its panels out on two-column grids with bare `1fr`
 * tracks, prints `white-space: nowrap` amplitude tables, and renders one bar per
 * basis state — up to 2^20 of them.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide table inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element, which is
    // exactly what happened here: the 980px comparison table was reported while
    // the real overflow was 15px of something else entirely.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Prefer an unclipped culprit; fall back to the widest clipped one rather
    // than reporting nothing, so the message always names something to look at.
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}





/** Move the n slider and wait for the bar chart to re-render to that width. */
async function setQubits(page: Page, n: number): Promise<void> {
  await page.locator('#n-slider').fill(String(n));
  await expect(page.locator('#n-value')).toHaveText(`N = 2^${n} = ${2 ** n}`);
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Nearly everything this lab teaches is behind an interaction. At first paint
 * the amplitudes are flat, the banner is `display: none`, `#math-layer`,
 * `#misconception`, `#mental-box`, `#measure-dots` and `#measure-stats` are all
 * empty, the prediction prompt and the guided-lesson body are hidden, the three
 * `<details>` are closed, and every challenge card is unanswered. A gate that
 * scans only the untouched page has therefore checked a fraction of the markup
 * this lab actually renders — which is precisely what the previous gate did.
 *
 * So each of these is driven for real, in an order that respects the lab's own
 * prerequisites (a prediction verdict cannot exist before Step opens a guess;
 * the lesson nav does not exist before Start):
 *
 *  - the two `<select>`s at every option, because the practical-threat verdict
 *    flips between `warn` (AES-128/192) and `ok` (AES-256) and those are
 *    separate colour pairings;
 *  - both success/failure branches of the prediction prompt and of a challenge
 *    card, since `.predict-result.right`/`.wrong` and `.fb-right`/`.fb-wrong`
 *    are different palettes and a gate that answers only correctly sees half;
 *  - the optimal banner AND the overshoot banner, the lab's headline claim;
 *  - the decomposed oracle/diffusion sub-steps, which are the only states that
 *    render `#phase-label` and put a negative bar below the zero line;
 *  - all five guided-lesson stages, plus Prev and Exit;
 *  - both skip links in their focused rendering, which is the only rendering
 *    they have — parked off-screen they paint nothing.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint`);

  // Both skip links only exist visually while focused.
  await page.locator('a.cl-skip-link').focus();
  await scan(page, `${theme} / header skip link focused`);
  await page.locator('a.skip-link').focus();
  await scan(page, `${theme} / lab skip link focused`);

  // ── Panel A: the simulator ────────────────────────────────────────────────
  await page.locator('#random-btn').click();
  await scan(page, `${theme} / random target`);

  // One plain iteration: the amplitudes separate and the math layer fills in.
  await page.locator('#step-btn').click();
  await expect(page.locator('#math-layer')).not.toBeEmpty();
  await scan(page, `${theme} / one iteration`);

  // k* for n = 4 is 3, so three steps land exactly on the optimal banner.
  await page.locator('#step-btn').click();
  await page.locator('#step-btn').click();
  await expect(page.locator('#banner.optimal')).toBeVisible();
  await scan(page, `${theme} / optimal k* banner`);

  // Keep going to k = 2·k*, where probability has collapsed again — the
  // overshoot claim this lab exists to make.
  for (let i = 0; i < 3; i++) await page.locator('#step-btn').click();
  await expect(page.locator('#banner.overshoot')).toBeVisible();
  await scan(page, `${theme} / overshoot banner`);

  // Measurement: 100 sampled outcomes plus the hit/miss statistics.
  await page.locator('#measure-btn').click();
  await expect(page.locator('#measure-dots .m-dot')).toHaveCount(100);
  await expect(page.locator('#measure-stats')).not.toBeEmpty();
  await scan(page, `${theme} / measured 100 shots`);

  // The three mental models are three different renderings of #mental-box, and
  // the algebra view additionally highlights #math-layer.
  for (const view of ['algebra', 'amplitudes', 'geometry'] as const) {
    await page.locator(`.mental-btn[data-view="${view}"]`).click();
    await expect(page.locator('#mental-box')).not.toBeEmpty();
    await scan(page, `${theme} / mental model: ${view}`);
  }

  await page.locator('#reset-btn').click();

  // Sub-step decomposition: the only states with a phase label and a negative
  // (below-the-baseline) amplitude bar.
  await page.locator('#decompose-toggle').check();
  await page.locator('#step-btn').click();
  await expect(page.locator('#phase-label')).toBeVisible();
  await scan(page, `${theme} / oracle sub-step`);
  await page.locator('#step-btn').click();
  await scan(page, `${theme} / diffusion sub-step`);
  await page.locator('#decompose-toggle').uncheck();

  // Auto-run, scanned while it is actually running and again once stopped.
  await page.locator('#reset-btn').click();
  await page.locator('#auto-btn').click();
  await expect(page.locator('#auto-btn')).toHaveClass(/active/);
  await scan(page, `${theme} / auto-run active`);
  await page.locator('#auto-btn').click();
  await expect(page.locator('#auto-btn')).not.toHaveClass(/active/);

  // Prediction mode. Step opens the guess; a choice resolves it. Both verdicts
  // are reachable and they are separately coloured, so drive both: from k = 0
  // probability rises, so "Increase" is right and "Decrease" is wrong.
  await page.locator('#reset-btn').click();
  await page.locator('#predict-toggle').check();
  await expect(page.locator('#predict-prompt')).toBeVisible();
  await scan(page, `${theme} / prediction mode armed`);

  await page.locator('#step-btn').click();
  await expect(page.locator('.predict-choice')).toHaveCount(3);
  await scan(page, `${theme} / prediction prompt open`);

  await page.getByRole('button', { name: '↑ Increase' }).click();
  await expect(page.locator('.predict-result.right')).toBeVisible();
  await scan(page, `${theme} / prediction correct`);

  await page.locator('#step-btn').click();
  await page.getByRole('button', { name: '↓ Decrease' }).click();
  await expect(page.locator('.predict-result.wrong')).toBeVisible();
  await scan(page, `${theme} / prediction wrong`);
  await page.locator('#predict-toggle').uncheck();

  // A large search space: 256 bars, 256 labels and a nowrap amplitude dump —
  // the widest thing this lab can be asked to lay out.
  await setQubits(page, 8);
  await page.locator('#step-btn').click();
  await scan(page, `${theme} / n = 8`);
  await setQubits(page, 4);
  await page.locator('#reset-btn').click();

  // ── Guided lesson: all five stages, plus Prev and Exit ────────────────────
  await page.locator('#lesson-start').click();
  await expect(page.locator('#lesson-nav')).toBeVisible();
  await scan(page, `${theme} / lesson stage 1`);
  for (let stage = 2; stage <= 5; stage++) {
    await page.locator('#lesson-next').click();
    await expect(page.locator('#lesson-progress')).toHaveText(`Stage ${stage} of 5`);
    await scan(page, `${theme} / lesson stage ${stage}`);
  }
  await page.locator('#lesson-prev').click();
  await expect(page.locator('#lesson-progress')).toHaveText('Stage 4 of 5');
  await scan(page, `${theme} / lesson stepped back`);
  await page.locator('#lesson-exit').click();
  await expect(page.locator('#lesson-nav')).toBeHidden();

  // ── Panel C / signature feature: every key size ───────────────────────────
  // AES-128 and AES-192 render the `warn` verdict, AES-256 the `ok` one.
  for (const bits of ['128', '192', '256']) {
    await page.locator('#key-selector').selectOption(bits);
    await expect(page.locator('#aes-example')).not.toBeEmpty();
    await scan(page, `${theme} / AES-${bits} signature feature`);

    await page.locator('#budget-selector').selectOption(bits);
    await expect(page.locator('#budget-box .budget-grid')).toBeVisible();
    await scan(page, `${theme} / AES-${bits} oracle cost budget`);
  }

  // ── The three disclosures, each of which hides a whole table ──────────────
  const summaries = page.locator('details > summary');
  const summaryCount = await summaries.count();
  expect(summaryCount, 'the three <details> disclosures must all be present').toBe(3);
  for (let i = 0; i < summaryCount; i++) {
    await summaries.nth(i).click();
    await scan(page, `${theme} / disclosure ${i + 1} open`);
  }

  // ── Challenge mode: both verdict branches ─────────────────────────────────
  // A card locks after its first click, so the two branches need two cards.
  // Card 1's first option ("2") is wrong and card 2's ("Oracle") is right, so
  // clicking the first option of each reaches `.fb-wrong` — with every other
  // option additionally marked `.correct` — and `.fb-right`.
  const cards = page.locator('.challenge-card');
  await expect(cards).toHaveCount(5);

  await cards.nth(0).locator('.challenge-opt').first().click();
  await expect(cards.nth(0).locator('.challenge-feedback .fb-wrong')).toBeVisible();
  await expect(cards.nth(0).locator('.challenge-opt.incorrect')).toHaveCount(1);
  await expect(cards.nth(0).locator('.challenge-opt.correct')).toHaveCount(1);
  await scan(page, `${theme} / challenge answered wrong`);

  await cards.nth(1).locator('.challenge-opt').first().click();
  await expect(cards.nth(1).locator('.challenge-feedback .fb-right')).toBeVisible();
  await scan(page, `${theme} / challenge answered right`);
}
