import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: '/dashboard',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent,
      ),
    title: 'Dashboard',
  },
  {
    path: 'issues',
    loadComponent: () =>
      import('./pages/issues/issues.component').then(
        (m) => m.IssuesComponent,
      ),
    title: 'Issues',
  },
  {
    path: 'projects',
    loadComponent: () =>
      import('./pages/projects/projects.component').then(
        (m) => m.ProjectsComponent,
      ),
    title: 'Projects',
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then(
        (m) => m.SettingsComponent,
      ),
    title: 'Settings',
  },
  {
    path: 'timesheets',
    loadComponent: () =>
      import('./pages/timesheets/timesheets.component').then(
        (m) => m.TimesheetsComponent,
      ),
    title: 'Timesheets',
  },
  {
    path: 'timer-overlay',
    loadComponent: () =>
      import('./components/timer/timer-window.component').then(
        (m) => m.TimerWindowComponent,
      ),
    title: 'Timer',
  },
  {
    path: '**',
    redirectTo: '/dashboard',
  },
];
