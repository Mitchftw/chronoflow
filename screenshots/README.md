# ChronoFlow screenshots

Captured with `node scripts/capture-screenshots.mjs before|after` at 1440×1000 using the same deterministic seed data (3 projects, 6 issues, 10 time entries) and an isolated `IS_TEST` database.

## Before / after

| View | Before | After |
| --- | --- | --- |
| Dashboard (light) | ![before](before/01-dashboard-light.png) | ![after](after/01-dashboard-light.png) |
| Issues | ![before](before/02-issues.png) | ![after](after/02-issues.png) |
| New issue dialog | ![before](before/03-issue-dialog.png) | ![after](after/03-issue-dialog.png) |
| Projects | ![before](before/04-projects.png) | ![after](after/04-projects.png) |
| New project dialog | ![before](before/05-project-dialog.png) | ![after](after/05-project-dialog.png) |
| Timesheets | ![before](before/06-timesheets.png) | ![after](after/06-timesheets.png) |
| Settings (top) | ![before](before/07-settings-top.png) | ![after](after/07-settings-top.png) |
| Settings (bottom) | ![before](before/08-settings-bottom.png) | ![after](after/08-settings-bottom.png) |
| Vacation | ![before](before/09-vacation.png) | ![after](after/09-vacation.png) |
| Backlog | ![before](before/10-backlog.png) | ![after](after/10-backlog.png) |
| Dashboard (dark) | ![before](before/11-dashboard-dark.png) | ![after](after/11-dashboard-dark.png) |
| Dashboard (timer running) | ![before](before/12-dashboard-active.png) | ![after](after/12-dashboard-active.png) |
| Floating timer overlay | ![before](before/13-timer-overlay.png) | ![after](after/13-timer-overlay.png) |

The before set was captured on `main` at `bba5994`. The after set is captured from `fix/bugs-and-visual-polish` with the same seed and window size, so differences are caused by the changes in that branch.
