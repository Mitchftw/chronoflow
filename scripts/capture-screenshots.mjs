import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const outDir = path.resolve('screenshots', phase);
fs.mkdirSync(outDir, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const daysAgo = (n) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - n);
  return localDate(d);
};

const projects = [
  { id: 'p-chronoflow', name: 'ChronoFlow', description: 'Desktop time tracker', color: '#6366f1', createdAt: 1 },
  { id: 'p-mobile', name: 'Mobile App', description: 'React Native companion', color: '#14b8a6', createdAt: 2 },
  { id: 'p-internal', name: 'Internal Tools', description: 'Automation and dashboards', color: '#f97316', createdAt: 3 },
];

const issues = [
  { id: 'i-fix-login', title: 'Fix login flow and session refresh', description: 'Login token refresh fails after 15 minutes.', projectId: 'p-chronoflow', status: 'in_progress', jiraIssueKey: 'CF-142', jiraConnectionId: null, estimate: 180, timeSpent: 5400, isRunning: false, startTime: null, createdAt: Date.now() - 1000, date: today.toISOString().slice(0, 10), color: '#6366f1' },
  { id: 'i-timesheet', title: 'Add timesheet export to CSV', description: 'Export filtered entries.', projectId: 'p-chronoflow', status: 'todo', jiraIssueKey: 'CF-151', jiraConnectionId: null, estimate: 120, timeSpent: 2400, isRunning: false, startTime: null, createdAt: Date.now() - 2000, date: today.toISOString().slice(0, 10), color: '#22c55e' },
  { id: 'i-notch', title: 'Polish notch timer animation', description: 'Make the notch feel native.', projectId: 'p-chronoflow', status: 'done', jiraIssueKey: 'CF-133', jiraConnectionId: null, estimate: 240, timeSpent: 14400, isRunning: false, startTime: null, createdAt: Date.now() - 3000, date: today.toISOString().slice(0, 10), color: '#a855f7' },
  { id: 'i-onboarding', title: 'Design onboarding screens', description: 'First-run experience for new users.', projectId: 'p-mobile', status: 'in_progress', jiraIssueKey: null, jiraConnectionId: null, estimate: 360, timeSpent: 7200, isRunning: false, startTime: null, createdAt: Date.now() - 4000, date: today.toISOString().slice(0, 10), color: '#14b8a6' },
  { id: 'i-sync', title: 'Offline sync queue', description: 'Queue worklogs while offline.', projectId: 'p-mobile', status: 'todo', jiraIssueKey: null, jiraConnectionId: null, estimate: 480, timeSpent: 0, isRunning: false, startTime: null, createdAt: Date.now() - 5000, date: today.toISOString().slice(0, 10), color: '#f97316' },
  { id: 'i-backup', title: 'Weekly database backups', description: 'Rotate local backups.', projectId: 'p-internal', status: 'done', jiraIssueKey: null, jiraConnectionId: null, estimate: 60, timeSpent: 3600, isRunning: false, startTime: null, createdAt: Date.now() - 6000, date: today.toISOString().slice(0, 10), color: '#eab308' },
];

const entries = [
  { issueId: 'i-fix-login', date: daysAgo(0), startTime: '09:05:00', endTime: '10:20:00', note: 'Debugged token refresh and added regression test.' },
  { issueId: 'i-timesheet', date: daysAgo(0), startTime: '10:35:00', endTime: '12:00:00', note: 'CSV export and column selection.' },
  { issueId: 'i-onboarding', date: daysAgo(0), startTime: '13:10:00', endTime: '15:05:00', note: 'First-run walkthrough prototype.' },
  { issueId: 'i-notch', date: daysAgo(0), startTime: '15:20:00', endTime: '16:40:00', note: 'Matched the notch easing to the taskbar.' },
  { issueId: 'i-fix-login', date: daysAgo(1), startTime: '08:50:00', endTime: '12:15:00', note: 'Session refresh investigation.' },
  { issueId: 'i-sync', date: daysAgo(1), startTime: '13:00:00', endTime: '17:10:00', note: 'Drafted offline queue states.' },
  { issueId: 'i-onboarding', date: daysAgo(2), startTime: '09:00:00', endTime: '12:30:00', note: 'Wireframes and copy.' },
  { issueId: 'i-backup', date: daysAgo(2), startTime: '14:00:00', endTime: '15:00:00', note: 'Backup rotation and restore test.' },
  { issueId: 'i-timesheet', date: daysAgo(3), startTime: '09:30:00', endTime: '11:45:00', note: 'Timesheet filter research.' },
  { issueId: 'i-notch', date: daysAgo(4), startTime: '13:30:00', endTime: '16:00:00', note: 'Notch polish pass.' },
];

const app = await electron.launch({
  // Launch through the package so app.getVersion() reflects ChronoFlow
  // (0.1.22) instead of Electron's own version in the About section.
  args: ['.'],
  env: { ...process.env, NODE_ENV: 'production', IS_TEST: 'true' },
});
const pageErrors = [];
const page = await app.firstWindow();
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.waitForSelector('app-root', { timeout: 30000 });
await page.waitForTimeout(1200);

await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.unmaximize();
  win.setSize(1440, 1000);
  win.center();
});

await page.evaluate(async ({ projects, issues, entries, settings }) => {
  const api = window.electronAPI;
  await api.store.set('app', settings);
  await api.store.set('projects', projects);
  await api.store.set('issues', issues);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    await api.timer.createEntry({
      id: `entry-${i + 1}`,
      issueId: e.issueId,
      startTime: e.startTime,
      endTime: e.endTime,
      date: e.date,
      note: e.note,
      jiraWorklogId: null,
      isDirty: false,
    });
  }
}, {
  projects,
  issues,
  entries,
  settings: {
    themePreference: 'light',
    autoStartTimer: true,
    roundTo15Min: false,
    idleThresholdMinutes: 5,
    timerMode: 'draggable',
    autoUpdate: true,
    autoHideNotch: false,
    notchDisplayId: null,
    defaultVacationHours: 8,
    dailyGoalHours: 8,
    defaultVacationIssueKey: null,
    droplets: { media: false, agents: false },
  },
});

await page.reload();
await page.waitForSelector('app-root h1', { timeout: 30000 });
await page.waitForTimeout(1200);

const shot = async (name, target = page) => {
  // Move the pointer away so hover tooltips/highlights do not leak into shots.
  await target.mouse.move(2, 2);
  await target.waitForTimeout(150);
  const file = path.join(outDir, name);
  await target.screenshot({ path: file });
  console.log('saved', path.relative(process.cwd(), file));
};

const nav = async (label) => {
  await page.locator('app-side-nav').getByText(label, { exact: true }).click();
  await page.waitForTimeout(700);
};

await shot('01-dashboard-light.png');

await nav('Issues');
await shot('02-issues.png');
await page.getByRole('button', { name: /New Issue/i }).click();
await page.waitForTimeout(500);
await shot('03-issue-dialog.png');
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);

await nav('Projects');
await shot('04-projects.png');
await page.getByRole('button', { name: /New Project/i }).click();
await page.waitForTimeout(400);
await shot('05-project-dialog.png');
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);

await nav('Timesheets');
await shot('06-timesheets.png');

await nav('Settings');
await shot('07-settings-top.png');
await page.locator('main').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
await page.waitForTimeout(400);
await shot('08-settings-bottom.png');

await nav('Vacation');
await shot('09-vacation.png');

await nav('Backlog');
await page.waitForTimeout(800);
await shot('10-backlog.png');

await nav('Settings');
await page.locator('main').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
await page.getByRole('button', { name: 'Dark', exact: true }).click();
await page.waitForTimeout(500);
await nav('Dashboard');
await shot('11-dashboard-dark.png');

await nav('Settings');
await page.getByRole('button', { name: 'Light', exact: true }).click();
await page.waitForTimeout(500);
await nav('Dashboard');
await page.waitForTimeout(400);

// Start a timer via the search bar on the dashboard.
const search = page.locator('app-active-timer-card app-search-bar input').first();
await search.fill('Fix login flow');
await page.waitForTimeout(600);
const localResult = page
  .locator('app-active-timer-card app-search-bar button', {
    hasText: 'Fix login flow and session refresh',
  })
  .first();
await localResult.click();
await page.waitForTimeout(1200);
await shot('12-dashboard-active.png');

// Separately open the floating timer window.
const secondWindow = app.waitForEvent('window');
await page.locator("app-title-bar button[aria-label='Minimize']").click();
const timerPage = await secondWindow;
timerPage.on('pageerror', (error) => pageErrors.push(error.message));
await timerPage.waitForSelector('app-timer-window', { timeout: 15000 }).catch(() => {});
await timerPage.waitForTimeout(1200);
await shot('13-timer-overlay.png', timerPage);

await app.close();
if (pageErrors.length > 0) {
  throw new Error(`Page errors during capture:\n${pageErrors.join('\n')}`);
}
console.log(`Done: ${phase} screenshots -> ${outDir}`);
