import { Injectable, signal } from '@angular/core';
import { startOfDay } from 'date-fns';

/**
 * Session-scoped UI state for the dashboard. The selected calendar day is
 * kept here (rather than as a local signal on the dashboard component) so it
 * survives navigating away from the `/dashboard` route and back. Otherwise
 * every re-entry remounts the component and snaps the date back to today —
 * which makes it hard to add an entry to yesterday after e.g. visiting the
 * Issues page first.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  /** The calendar day the dashboard is currently showing. */
  readonly selectedDate = signal(startOfDay(new Date()));
}