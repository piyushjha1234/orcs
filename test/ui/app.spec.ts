// Browser checks for orcs ui: accessibility (axe, WCAG 2.2 AA), reflow, keyboard paths, live updates and the copy rules.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startApp, type App } from './fixtures.ts';

let app: App;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Each route with an element that proves the page has loaded.
const ROUTES: [string, string][] = [
  ['/', 'run-list'],
  ['/new', 'new-run-form'],
  ['/runs/orcs-1', 'task-board'],
  ['/runs/orcs-1/questions', 'question-card'],
  ['/runs/orcs-2', 'task-board'],
  ['/runs/orcs-2/bugs', 'bug-list'],
  ['/runs/orcs-2/bugs/bug-1', 'bug-detail'],
  ['/runs/orcs-2/report', 'report-view table'],
  ['/runs/orcs-2/plan', 'plan-view table'],
  ['/runs/orcs-3', 'task-board'],
  ['/runs/orcs-9', 'h1'],
];

async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${app.url}/?token=${app.token}`);
  await page.close();
}

async function open(page: Page, path: string, ready: string): Promise<void> {
  if (path === '/new') {
    await page.addInitScript(() => sessionStorage.setItem('orcs.pending-folder', '/tmp/picked-project'));
  }
  await page.goto(`${app.url}${path}`);
  await expect(page.locator(ready).first()).toBeVisible();
}

function violations(results: { id: string; help: string; nodes: { target: unknown[] }[] }[]): string[] {
  return results.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
}

// ---- Axe on every route, at every width, in both themes ------------------

for (const width of [375, 768, 1024, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${width}px ${scheme}`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: scheme });

      test('every route has no WCAG 2.2 AA violations', async ({ page, context }) => {
        await signIn(context);
        for (const [path, ready] of ROUTES) {
          await open(page, path, ready);
          const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
          expect(violations(results.violations), path).toEqual([]);
        }
      });
    });
  }
}

test.describe('forced colors', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'light', forcedColors: 'active' });

  test('every route stays readable in forced colors', async ({ page, context }) => {
    await signIn(context);
    for (const [path, ready] of ROUTES) {
      await open(page, path, ready);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(violations(results.violations), path).toEqual([]);
    }
  });
});

// ---- Reflow at 320 CSS pixels -------------------------------------------

test.describe('320px reflow', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('no route scrolls sideways', async ({ page, context }) => {
    await signIn(context);
    for (const [path, ready] of ROUTES) {
      await open(page, path, ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});

// ---- Copy rules: no filler words, no exclamation marks ------------------

test('visible copy avoids filler words and exclamation marks', async ({ page, context }) => {
  await signIn(context);
  const banned = /seamless|effortless|powerful|unlock|elevate|streamline|supercharge|journey|AI-powered|magic|welcome|oops|let's get started/i;
  for (const [path, ready] of ROUTES) {
    await open(page, path, ready);
    const text = await page.locator('main').innerText();
    expect(text.match(banned), path).toBeNull();
    expect(text.includes('!'), path).toBe(false);
  }
});

// ---- Keyboard paths ------------------------------------------------------

test.describe('keyboard', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('shortcuts open help, start a new run and go back to runs', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/', 'run-list');
    await page.keyboard.press('?');
    await expect(page.locator('#help-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-dialog')).toBeHidden();
    await page.route('**/api/pick-folder', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path: '/tmp/picked-project' }),
    }));
    await page.keyboard.press('n');
    const folder = page.getByRole('dialog', { name: 'Choose a folder' });
    await expect(folder).toBeVisible();
    await folder.getByRole('button', { name: 'Open', exact: true }).click();
    await folder.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(`${app.url}/new`);
    await expect(page.locator('h1')).toBeFocused();
    await expect(page.getByText('Project folder')).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('r');
    await expect(page).toHaveURL(`${app.url}/`);
  });

  test('answer a question with the number keys and Enter', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/runs/orcs-1/questions', 'question-card');
    const cards = page.locator('question-card');
    await expect(cards).toHaveCount(2);
    await cards.first().getByRole('radio').first().focus();
    await page.keyboard.press('2');
    await expect(cards.first().getByRole('radio', { name: /Change something/ })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Answer sent.');
    await expect(cards).toHaveCount(1);
    await expect(page.locator('#q-done')).toContainText('Change something');
  });

  test('open a bug from the list with Enter and focus its heading', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/runs/orcs-2/bugs', 'bug-list');
    const link = page.getByRole('link', { name: /bug-1/ });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${app.url}/runs/orcs-2/bugs/bug-1`);
    await expect(page.locator('bug-detail h2').first()).toBeFocused();
  });

  test('resume a stopped run from its page', async ({ page, context }) => {
    await signIn(context);
    let resumed = false;
    await page.route('**/api/runs/orcs-3/resume', (route) => {
      resumed = true;
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ started: 'orcs-3' }) });
    });
    await open(page, '/runs/orcs-3', 'task-board');
    await expect(page.getByRole('navigation', { name: 'Run sections' }).getByRole('link').first()).toHaveText(/Plan/);
    await page.getByRole('button', { name: 'Resume run' }).click();
    await expect(page.locator('#status')).toHaveText('Resuming the run.');
    expect(resumed).toBe(true);
  });

  test('stop asks first, and cancel sends nothing', async ({ page, context }) => {
    await signIn(context);
    let stopped = 0;
    await page.route('**/api/runs/orcs-4/stop', (route) => {
      stopped += 1;
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ stopping: 'orcs-4' }) });
    });
    await open(page, '/runs/orcs-4', 'task-board');
    await page.getByRole('button', { name: 'Stop run' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop this run?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(stopped).toBe(0);
    await page.getByRole('button', { name: 'Stop run' }).click();
    await page.getByRole('dialog', { name: 'Stop this run?' }).getByRole('button', { name: 'Stop run' }).click();
    await expect(page.locator('#status')).toHaveText('Stopping the run.');
    expect(stopped).toBe(1);
  });
});

// ---- New run form ----------------------------------------------------------

test.describe('new run', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('explains each problem and moves focus to the summary', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/new', 'new-run-form');
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page.locator('#nr-summary')).toBeFocused();
    await expect(page.locator('#nr-name-error')).toHaveText('Give the project a name.');
    await expect(page.locator('#nr-req-error')).toHaveText('Describe what the project should do.');
  });

  test('shows a server error on the field it belongs to', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/new', 'new-run-form');
    await page.getByLabel('Project name').fill('notes app');
    await page.getByLabel('What should it do?').fill('A notes app for private notes.');
    await page.route('**/api/runs', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'That name is already used by another run.', field: 'name' }) });
    });
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page.locator('#nr-name-error')).toHaveText('That name is already used by another run.');
    await expect(page.locator('#nr-summary')).toBeFocused();
    await page.unroute('**/api/runs');
  });

  test('starts a run and opens its page', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/new', 'new-run-form');
    await page.getByLabel('Project name').fill('notes app');
    await page.getByLabel('What should it do?').fill('A notes app for private notes.');
    await page.route('**/api/runs', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      expect(route.request().postDataJSON()).toMatchObject({ dir: '/tmp/picked-project' });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'orcs-2' }) });
    });
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page).toHaveURL(`${app.url}/runs/orcs-2`);
    await expect(page.locator('run-header h1')).toHaveText('notes app');
    await page.unroute('**/api/runs');
  });

  test('searches skills, adds one and removes it; global skills default to No', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/skills**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ skills: [{ source: 'anthropics/skills', installs: '12K installs' }] }) }),
    );
    await open(page, '/new', 'new-run-form');
    await expect(page.getByRole('radio', { name: 'No' })).toBeChecked();
    await page.getByLabel('Search skills').fill('pdf');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('#nr-skill-status')).toHaveText('1 skill found for “pdf”.');
    await page.getByRole('button', { name: 'Add anthropics/skills' }).click();
    await expect(page.locator('#nr-added')).toContainText('anthropics/skills');
    await page.getByRole('button', { name: 'Remove anthropics/skills' }).click();
    await expect(page.locator('#nr-added')).toContainText('None added yet.');
    const skills = page.getByRole('button', { name: 'Skills warning', exact: true });
    await skills.focus();
    await expect(page.locator('#nr-skills-warn-tip')).toBeVisible();
    await expect(page.locator('#nr-skills-warn-tip')).toContainText('Skills can run code');
    const global = page.getByRole('button', { name: 'Global skills warning' });
    await global.focus();
    await expect(page.locator('#nr-global-warn-tip')).toBeVisible();
    await expect(page.locator('#nr-global-warn-tip')).toContainText('2k tokens');
    await page.unroute('**/api/skills**');
  });

  test('new run asks for a folder before the form', async ({ page, context }) => {
    await signIn(context);
    await page.route('**/api/pick-folder', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path: '/tmp/picked-project' }),
    }));
    await open(page, '/', 'run-list');
    await page.getByRole('button', { name: 'New run' }).click();
    const folder = page.getByRole('dialog', { name: 'Choose a folder' });
    await expect(folder).toBeVisible();
    await folder.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(folder.locator('#folder-path')).toHaveText('/tmp/picked-project');
    await folder.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(`${app.url}/new`);
    await expect(page.getByText('Project folder')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  });
});

// ---- Live updates -----------------------------------------------------------

test.describe('live updates', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('new activity appears on the open progress page', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/runs/orcs-4', 'task-board');
    app.store.event('orcs-4', 'stage', 'Tester is running the acceptance checks.');
    await expect(page.locator('event-feed')).toContainText('Tester is running the acceptance checks.', { timeout: 10_000 });
  });

  test('a new question is announced and shown', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/runs/orcs-4/questions', 'h2');
    app.store.ask('orcs-4', { from: 'developers', text: 'Which font should the sign-in page use?', options: ['System font', 'Serif'], recommended: 1 });
    await expect(page.locator('#status')).toHaveText('1 new question needs you.', { timeout: 10_000 });
    await expect(page.locator('question-card')).toContainText('Which font should the sign-in page use?');
  });
});

// ---- Settings ---------------------------------------------------------------

test.describe('runs list', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('a finished run checks Finish, and a running run can be deleted', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/runs/orcs-2', 'run-header');
    await expect(page.locator('.step').last()).toHaveClass(/step-past/);
    let deleted = 0;
    await page.route('**/api/runs/orcs-4', (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deleted += 1;
      return route.fulfill({ status: 204, body: '' });
    });
    await open(page, '/', 'run-list');
    await expect(page.getByRole('button', { name: 'Delete orcs-2' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete orcs-4' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete orcs-4?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(deleted).toBe(0);
    await page.getByRole('button', { name: 'Delete orcs-4' }).click();
    await page.getByRole('dialog', { name: 'Delete orcs-4?' }).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => deleted).toBe(1);
  });
});

test.describe('settings', () => {
  test.use({ viewport: { width: 1024, height: 800 }, colorScheme: 'light' });

  test('a chosen theme is applied and kept after reload', async ({ page, context }) => {
    await signIn(context);
    await open(page, '/', 'run-list');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Dark' }).check();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
