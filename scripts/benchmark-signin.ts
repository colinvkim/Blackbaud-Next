import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'puppeteer-core';
import { AUTH_CONTEXT_PREFIX, parseAuthContext } from '../src/blackbaud/auth.ts';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from './browser-development.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, candidate: { type: 'string', default: 'chrome' },
  runs: { type: 'string', default: '5' }, profile: { type: 'boolean', default: false },
  output: { type: 'string', default: '.local/dev-browser/signin-benchmark/results.json' },
} });
if (!values.baseline) throw new Error('Pass --baseline with a saved unpacked extension directory.');
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 5 || runs > 30) throw new Error('--runs must be between 5 and 30.');
const output = resolve(root, values.output);
await mkdir(dirname(output), { recursive: true });

interface Scenario {
  name: string;
  provider: 'google' | 'blackbaud';
  preference: string;
  parserDelay: number;
}
interface Variant {
  name: 'baseline' | 'candidate';
  path: string;
  browser: Browser;
  popup: Page;
}
interface Sample {
  scenario: string;
  variant: Variant['name'];
  navigationToClickMs: number;
  readyToClickMs: number;
  accountMountedMs: number;
  nativeReadyMs: number;
  clicks: number;
  earlyClicks: number;
}
const scenarios: Scenario[] = [
  { name: 'google-domain-ready', provider: 'google', preference: 'students.polytechnic.org', parserDelay: 0 },
  { name: 'google-domain-deferred', provider: 'google', preference: 'students.polytechnic.org', parserDelay: 600 },
  { name: 'google-exact-deferred', provider: 'google', preference: 'student@students.polytechnic.org', parserDelay: 600 },
  { name: 'blackbaud-deferred', provider: 'blackbaud', preference: 'student@students.polytechnic.org', parserDelay: 600 },
];

function fixture(provider: Scenario['provider']): string {
  const button = provider === 'google'
    ? '<button data-email="student@students.polytechnic.org">School account</button><button data-email="personal@example.org">Personal account</button>'
    : '<button id="google-continue-button">Continue with Google</button>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic sign-in</title>
    <script defer src="/benchmark-native.js"></script></head><body>${button}
    <script>
      const root = document.documentElement;
      root.dataset.accountMounted = String(performance.now());
      root.dataset.clicks = '0'; root.dataset.earlyClicks = '0';
      document.addEventListener('click', () => {
        if (!root.dataset.nativeReady) root.dataset.earlyClicks = String(Number(root.dataset.earlyClicks) + 1);
      }, true);
      document.addEventListener('DOMContentLoaded', () => {
        root.dataset.nativeReady = String(performance.now());
        performance.mark('native-ready');
        document.querySelector('button').addEventListener('click', () => {
          root.dataset.clicks = String(Number(root.dataset.clicks) + 1);
          root.dataset.clickedAt = String(performance.now());
          performance.mark('native-signin-click');
        });
      });
    </script></body></html>`;
}

async function sample(variant: Variant, scenario: Scenario, tracePath?: string): Promise<Sample> {
  // Clear synthetic metadata in both storage versions; each variant uses a
  // disposable profile. The real school content script prepares the next flow.
  await variant.popup.evaluate(`(async () => {
    for (const area of [chrome.storage.local, chrome.storage.session]) {
      await area.remove(Object.keys(await area.get(null)).filter(key => key.startsWith(${JSON.stringify(AUTH_CONTEXT_PREFIX)})));
    }
    await chrome.storage.sync.set(${JSON.stringify({ enabled: true, automaticLogin: true, optimizeLoginPage: true, loadingOverlay: false, accountPreference: scenario.preference })});
  })()`);
  const page = await variant.browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.setDefaultTimeout(5_000);
  const url = scenario.provider === 'google'
    ? 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback'
    : 'https://app.blackbaud.com/signin/?redirectUrl=https%3A%2F%2Fpolytechnic.myschoolapp.com%2Fapp%2Fstudent%3Fsvcid%3Dedu';
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void (async () => {
      if (request.url().startsWith('chrome-extension:')) { await request.continue(); return; }
      const path = new URL(request.url()).pathname;
      if (path === '/benchmark-native.js') {
        await delay(scenario.parserDelay);
        await request.respond({ status: 200, contentType: 'text/javascript', body: '' });
      } else if (request.isNavigationRequest()) {
        const html = new URL(request.url()).hostname === 'polytechnic.myschoolapp.com'
          ? '<!doctype html><title>Synthetic school sign-in</title><input id="nextBtn" type="button" value="Next">'
          : fixture(scenario.provider);
        await request.respond({ status: 200, contentType: 'text/html', body: html });
      } else if (path === '/favicon.ico') {
        await request.respond({ status: 204 });
      } else {
        errors.push(`Unexpected request: ${request.url()}`);
        await request.respond({ status: 404 });
      }
    })().catch((error: unknown) => errors.push(String(error)));
  });
  let tracing = false;
  try {
    await page.bringToFront();
    await page.goto('https://polytechnic.myschoolapp.com/app?svcid=edu#login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bn-login-option button');
    if (tracePath) {
      await page.tracing.start({ path: tracePath, categories: ['devtools.timeline', 'blink.user_timing'] });
      tracing = true;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Number(document.documentElement.dataset.clicks) > 0, { polling: 10 });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const timing = await page.evaluate(() => {
      const data = document.documentElement.dataset;
      return {
        navigationToClickMs: Number(data.clickedAt),
        readyToClickMs: Number(data.clickedAt) - Number(data.nativeReady),
        accountMountedMs: Number(data.accountMounted), nativeReadyMs: Number(data.nativeReady),
        clicks: Number(data.clicks), earlyClicks: Number(data.earlyClicks), visibility: document.visibilityState,
      };
    });
    assert.equal(timing.clicks, 1);
    assert.equal(timing.earlyClicks, 0);
    assert.equal(timing.visibility, 'visible');
    assert.ok(Number.isFinite(timing.navigationToClickMs) && timing.readyToClickMs >= 0);
    assert.deepEqual(errors, []);
    const stored: unknown = await variant.popup.evaluate(`Promise.all([
      chrome.storage.local.get(null), chrome.storage.session.get(null)
    ]).then(areas => Object.entries(Object.assign({}, ...areas))
      .filter(([key]) => key.startsWith(${JSON.stringify(AUTH_CONTEXT_PREFIX)})).map(([, value]) => value))`);
    assert.ok(Array.isArray(stored));
    const contexts = stored.map((value: unknown) => parseAuthContext(value)).filter((context) => context !== null);
    assert.equal(contexts.length, 1);
    const context = contexts[0];
    assert.ok(context);
    assert.equal(scenario.provider === 'google' ? context.googleAttempts : context.blackbaudAttempts, 1);
    const { visibility: _visibility, ...result } = timing;
    return { scenario: scenario.name, variant: variant.name, ...result };
  } finally {
    if (tracing) await page.tracing.stop();
    await page.close();
  }
}

function distribution(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, min: sorted[0]!, max: sorted.at(-1)! };
}

const state = await mkdtemp(resolve(tmpdir(), 'blackbaud-signin-benchmark-'));
const variants: Variant[] = [];
const samples: Sample[] = [];
const host = { node: process.version, cores: availableParallelism(), loadBefore: loadavg() };
try {
  const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
  for (const [name, path] of [['baseline', values.baseline], ['candidate', values.candidate]] as const) {
    const browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], resolve(state, name)), executable);
    const popup = await browser.newPage();
    variants.push({ name, path: resolve(root, path), browser, popup });
    const id = await browser.installExtension(resolve(root, path));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
  }
  const diagnostic = scenarios.find((scenario) => scenario.name === 'google-domain-deferred')!;
  for (const variant of variants) {
    await sample(variant, diagnostic, values.profile ? resolve(dirname(output), `${variant.name}-trace.json`) : undefined);
  }
  for (const scenario of scenarios) {
    for (let run = 0; run < runs; run++) {
      for (const variant of variants) samples.push(await sample(variant, scenario));
    }
  }
  const summary = scenarios.flatMap((scenario) => variants.map((variant) => {
    const selected = samples.filter((entry) => entry.scenario === scenario.name && entry.variant === variant.name);
    return {
      scenario: scenario.name, variant: variant.name, runs: selected.length,
      navigationToClickMs: distribution(selected.map((entry) => entry.navigationToClickMs)),
      readyToClickMs: distribution(selected.map((entry) => entry.readyToClickMs)),
    };
  }));
  const bundles = await Promise.all(variants.map(async (variant) => ({
    variant: variant.name, path: variant.path,
    browserVersion: await variant.browser.version(),
    authHash: createHash('sha256').update(await readFile(resolve(variant.path, 'dist/auth.js'))).digest('hex'),
    manifest: JSON.parse(await readFile(resolve(variant.path, 'manifest.json'), 'utf8')),
  })));
  const result = {
    claim: 'Compare extension startup overhead on synthetic provider pages; this does not measure complete live SSO.',
    conditions: { providerNetwork: 'intercepted; no live requests', storage: 'real Chrome APIs', preparation: 'same-tab synthetic school login prepares the flow through the content script before provider timing; worker warm', warmup: 'one excluded run per variant', order: 'baseline, candidate, repeated', scenarios },
    host: { ...host, loadAfter: loadavg() }, failures: 0, successfulNativeClicks: samples.length,
    summary, samples, bundles,
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output, failures: 0, successfulNativeClicks: samples.length, summary }, null, 2));
} finally {
  for (const variant of variants) await variant.browser.close();
  await rm(state, { recursive: true, force: true });
}
