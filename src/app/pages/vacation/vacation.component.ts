import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { JiraService } from '../../services/jira.service';
import { SettingsService } from '../../services/settings.service';
import { IpcService } from '../../services/ipc.service';
import {
  SearchBarComponent,
  type SearchResult,
} from '../../components/common/search-bar.component';
import { formatJiraLocalIso } from '../../utils/datetime';

/** Status of a single workday row in the preview / push pipeline. */
type DayStatus = 'idle' | 'syncing' | 'success' | 'error';

interface VacationDay {
  /** Original calendar date for this row (local midnight). */
  date: Date;
  /** YYYY-MM-DD view of `date` (local-tz-derived). */
  dateISO: string;
  /** Human label e.g. "Mon 28 Jul". */
  label: string;
  /** Hours to push for this day (overridable per row). */
  hours: number;
  /** User toggled this day off — e.g. for a public holiday. */
  skipped: boolean;
  status: DayStatus;
  errorMessage?: string;
  worklogId?: string;
}

@Component({
  selector: 'app-vacation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchBarComponent, RouterLink],
  host: { class: 'block max-w-4xl' },
  template: `
    <header class="mb-7 flex items-center justify-between select-none">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground/95">
          Vacation
        </h1>
        <p class="mt-1.5 text-xs font-medium text-muted-foreground/80">
          Bulk-log weekdays onto your Jira verlof ticket
        </p>
      </div>
    </header>

    <!-- No Jira connection warning -->
    @if (jiraService.connections().length === 0) {
      <div
        class="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3"
      >
        <svg
          class="size-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
        <div class="text-sm">
          <p class="font-bold text-amber-900 dark:text-amber-200">
            No Jira connection configured.
          </p>
          <p class="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
            Add one in
            <a routerLink="/settings" class="font-semibold underline underline-offset-2"
              >Settings &rarr; Jira Integration</a
            >
            to push worklogs.
          </p>
        </div>
      </div>
    }

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5">
      <!-- ═══ LEFT: Form ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-5 shadow-md space-y-5 self-start"
      >
        <h2
          class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20"
        >
          Range
        </h2>

        <!-- Date range -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span
              class="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5"
              >Start</span
            >
            <input
              type="date"
              [value]="startDate()"
              [disabled]="pushing()"
              (input)="startDate.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </label>
          <label class="block">
            <span
              class="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5"
              >End</span
            >
            <input
              type="date"
              [value]="endDate()"
              [disabled]="pushing()"
              (input)="endDate.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </label>
        </div>

        <div class="flex items-center gap-2 text-xs text-muted-foreground/70">
          <svg
            class="size-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Weekends are skipped automatically.
          @if (startInPast()) {
            <span class="text-amber-600 dark:text-amber-400 font-semibold"
              >Start is in the past — Jira may reject backdated worklogs.</span
            >
          }
        </div>

        <h2
          class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20 pt-2"
        >
          Hours &amp; comment
        </h2>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span
              class="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5"
              >Hours / workday</span
            >
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="24"
                step="0.5"
                [value]="hoursPerDay()"
                [disabled]="pushing()"
                (input)="
                  hoursPerDay.set(
                    clampHours($any($event.target).valueAsNumber)
                  )
                "
                class="w-20 rounded-xl border border-border/40 bg-background/50 px-3 py-2.5 text-sm font-bold text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span class="text-xs font-semibold text-muted-foreground/70">h</span>
            </div>
            <p class="text-[10px] text-muted-foreground/55 mt-1">
              Override per row in the preview
            </p>
          </label>

          <label class="block">
            <span
              class="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5"
              >Comment</span
            >
            <input
              type="text"
              [value]="comment()"
              [disabled]="pushing()"
              (input)="comment.set($any($event.target).value)"
              placeholder="Vakantie"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-3 py-2.5 text-sm font-semibold text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </label>
        </div>

        <h2
          class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20 pt-2"
        >
          Verlof ticket
        </h2>

        <!-- Issue picker -->
        <div class="relative z-20">
          <app-search-bar
            [placeholder]="'Search verlof ticket...'"
            [(query)]="issueQuery"
            (resultSelected)="onIssueSelected($event)"
          />
        </div>

        @if (selectedIssue(); as issue) {
          <div
            class="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="size-8 shrink-0 rounded-lg bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-primary-foreground shadow-sm shadow-primary/20"
              >
                <svg
                  class="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold text-foreground truncate"
                    >{{ issue.key }}</span
                  >
                  @if (usingSavedDefault()) {
                    <span
                      class="rounded-md bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary"
                      >Saved default</span
                    >
                  }
                </div>
                <p class="text-xs text-muted-foreground/70 truncate">
                  {{ issue.summary }}
                </p>
              </div>
            </div>
            <button
              class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              (click)="clearIssue()"
              aria-label="Clear selected ticket"
              title="Clear"
            >
              Clear
            </button>
          </div>
        } @else if (defaultKeyMissing()) {
          <p class="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
            Default key
            <span class="font-mono">{{ settings().defaultVacationIssueKey }}</span>
            was not found — please pick another.
          </p>
        }

        <!-- Push button -->
        <div class="pt-2 space-y-2.5">
          <button
            (click)="pushAll()"
            [disabled]="!canPush()"
            class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-md shadow-primary/20 transition-all duration-300 hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            @if (pushing()) {
              <div
                class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                role="status"
              ></div>
              Pushing... ({{ pushedSoFar() }} / {{ pushProgressTotal() }})
            } @else {
              <svg
                class="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Push {{ pushableCount() }} worklog{{ pushableCount() === 1 ? '' : 's' }}
            }
          </button>

          @if (failedCount() > 0 && !pushing()) {
            <button
              (click)="retryFailed()"
              class="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 transition-all duration-300 hover:bg-amber-500/20 cursor-pointer"
            >
              <svg
                class="size-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              Retry {{ failedCount() }} failed
            </button>
          }
        </div>

        <!-- Result summary -->
        @if (lastPushResult(); as result) {
          <div
            [class]="
              result.failed === 0
                ? 'rounded-xl p-3 text-xs font-semibold bg-green-500/10 text-green-700 dark:text-green-300 border border-green-500/25'
                : 'rounded-xl p-3 text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25'
            "
          >
            @if (result.failed === 0) {
              ✓ Pushed <b>{{ result.success }}</b> worklog{{ result.success === 1 ? '' : 's' }}
              to {{ selectedIssue()?.key }}.
            } @else {
              {{ result.success }} of {{ result.success + result.failed }} pushed.
              The {{ result.failed }} that failed stop the loop — hit Retry above once you've
              checked the failure (e.g. expired token, missing permission).
            }
          </div>
        }
      </section>

      <!-- ═══ RIGHT: Preview + summary ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-5 shadow-md space-y-4"
      >
        <div class="flex items-center justify-between gap-3 pb-2 border-b border-border/20">
          <h2
            class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80"
          >
            Preview
          </h2>
          <div class="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/80">
            <span
              class="rounded-md bg-secondary/60 border border-border/30 px-2 py-0.5"
              >{{ workdayCount() }} workday{{ workdayCount() === 1 ? '' : 's' }}</span
            >
            <span class="text-muted-foreground/40">·</span>
            <span
              class="rounded-md bg-secondary/60 border border-border/30 px-2 py-0.5"
              >≈ {{ totalHours() }}h</span
            >
          </div>
        </div>

        @if (workdayCount() === 0) {
          <div
            class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 py-12 text-center"
          >
            <svg
              class="mb-3 size-10 text-muted-foreground/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
              />
            </svg>
            <p class="text-sm font-bold text-foreground/90">
              No workdays in this range
            </p>
            <p class="text-xs text-muted-foreground/60 mt-1 max-w-xs">
              Adjust the dates above so at least one weekday falls inside the
              range.
            </p>
          </div>
        } @else {
          <ul class="space-y-1.5">
            @for (row of dayRows(); track row.dateISO; let i = $index) {
              <li
                class="flex items-center gap-3 rounded-xl border border-border/30 px-3.5 py-2.5 transition-all duration-200"
                [class]="rowClasses(row)"
              >
                <!-- Status icon -->
                <div class="shrink-0 w-7 flex items-center justify-center">
                  @switch (row.status) {
                    @case ('syncing') {
                      <div
                        class="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
                      ></div>
                    }
                    @case ('success') {
                      <svg
                        class="size-4 text-green-600 dark:text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    }
                    @case ('error') {
                      <svg
                        class="size-4 text-amber-600 dark:text-amber-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                        />
                      </svg>
                    }
                    @default {
                      <svg
                        class="size-4 text-muted-foreground/40"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    }
                  }
                </div>

                <!-- Date label -->
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-sm font-bold text-foreground/90"
                    >{{ row.label }}</span
                  >
                  <span class="text-[10px] font-mono text-muted-foreground/55"
                    >{{ row.dateISO }}</span
                  >
                  @if (row.errorMessage) {
                    <p
                      class="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5 truncate"
                      [title]="row.errorMessage"
                    >
                      {{ row.errorMessage }}
                    </p>
                  }
                </div>

                <!-- Hours input -->
                <div class="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    [value]="row.hours"
                    [disabled]="row.status === 'syncing' || row.status === 'success'"
                    (input)="updateRowHours(i, $any($event.target).valueAsNumber)"
                    class="w-16 rounded-lg border border-border/40 bg-background/60 px-2 py-1 text-xs font-bold text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-200 shadow-inner disabled:opacity-50"
                  />
                  <span class="text-[10px] font-semibold text-muted-foreground/60">h</span>
                </div>

                <!-- Skip toggle -->
                <button
                  (click)="toggleSkipDay(i)"
                  [disabled]="pushing() || row.status === 'syncing' || row.status === 'success'"
                  class="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  [title]="row.skipped ? 'Include this day' : 'Skip this day (public holiday etc.)'"
                  [attr.aria-label]="row.skipped ? 'Include this day' : 'Skip this day'"
                >
                  @if (row.skipped) {
                    <svg
                      class="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  } @else {
                    <svg
                      class="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      />
                    </svg>
                  }
                </button>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class VacationComponent {
  protected readonly jiraService = inject(JiraService);
  protected readonly settingsService = inject(SettingsService);
  private readonly ipc = inject(IpcService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly settings = this.settingsService.settings;

  // ── Form state ──

  /** today + 1 day, local-date formatted (YYYY-MM-DD) */
  private readonly defaultStartDate = toISODate(addDays(new Date(), 1));
  /** today + ~2 weeks, inclusive */
  private readonly defaultEndDate = toISODate(addDays(new Date(), 14));

  protected readonly startDate = signal(this.defaultStartDate);
  protected readonly endDate = signal(this.defaultEndDate);
  protected readonly hoursPerDay = signal(8);
  protected readonly comment = signal('Vakantie');

  // ── Selected issue (Jira) ──

  protected readonly selectedIssue = signal<
    { key: string; summary: string } | null
  >(null);
  protected readonly usingSavedDefault = signal(false);
  protected readonly defaultKeyMissing = signal(false);

  /** two-way bound query feeding the search bar */
  protected readonly issueQuery = signal('');

  // ── Push pipeline ──

  protected readonly dayRows = signal<VacationDay[]>([]);
  protected readonly pushing = signal(false);
  protected readonly pushedSoFar = signal(0);
  protected readonly lastPushResult = signal<
    { success: number; failed: number } | null
  >(null);

  /**
   * Monotonic counter incremented at the start of every push. The async loop
   * captures its starting value; if the counter has moved by the time the
   * loop wakes from an IPC await, it means the user clicked Restart — abort
   * cleanly without touching row state.
   *
   * Belt-and-suspenders: the DestroyRef-based `alive` flag also short-
   * circuits the loop on component teardown (e.g. user navigates away during
   * a push) so we never touch signals on a destroyed component.
   */
  private pushRunId = 0;
  private alive = true;

  constructor() {
    // Belt-and-suspenders: short-circuit the push loop on component teardown
    // so we never touch signals on a destroyed view (e.g. user navigates
    // away while a push is in flight).
    this.destroyRef.onDestroy(() => (this.alive = false));

    // Sync hoursPerDay from settings on initial load.
    this.hoursPerDay.set(this.settings().defaultVacationHours || 8);

    // Recompute the preview rows whenever the form state changes.
    effect(
      () => {
        const start = this.startDate();
        const end = this.endDate();
        const hours = this.hoursPerDay();
        if (!start || !end || start > end) {
          this.dayRows.set([]);
          return;
        }
        this.dayRows.set(buildWeekdayRows(start, end, hours));
      },
      { allowSignalWrites: true },
    );

    // When the saved default key is set, try to fetch the matching issue once
    // Jira connections are loaded and the service's search bar is idle.
    effect(
      () => {
        const settingsKey = this.settings().defaultVacationIssueKey;
        if (!settingsKey || this.selectedIssue()) return;
        const conns = this.jiraService.connections();
        if (conns.length === 0) return;

        // Run once; do not block the effect.
        this.resolveDefaultIssue(settingsKey);
      },
      { allowSignalWrites: true },
    );
  }

  // ── Derived state ──

  protected readonly validRange = computed(
    () => !!this.startDate() && !!this.endDate() && this.startDate() <= this.endDate(),
  );

  protected readonly workdayCount = computed(() => {
    return this.dayRows().filter((r) => !r.skipped).length;
  });

  protected readonly totalHours = computed(() => {
    return this.dayRows()
      .filter((r) => !r.skipped)
      .reduce((sum, r) => sum + r.hours, 0);
  });

  /**
   * Workdays still pending a push. Computed once at loop start so the
   * "Pushing... (X / Y)" button label stays stable even if `dayRows()` is
   * mutated by other paths while pushing.
   *
   * `protected` (not `private`) because the template reads `pushProgressTotal()`
   * to render the push button label. Angular's strict template checker
   * rejects `private` members in templates.
   */
  protected pushProgressTotal = signal(0);

  protected readonly pushableCount = computed(() => {
    const rows = this.dayRows().filter((r) => !r.skipped);
    return rows.filter((r) => r.status !== 'success').length;
  });

  protected readonly failedCount = computed(() => {
    return this.dayRows().filter((r) => r.status === 'error').length;
  });

  protected readonly canPush = computed(
    () =>
      !this.pushing() &&
      this.validRange() &&
      !!this.selectedIssue() &&
      this.pushableCount() > 0,
  );

  protected readonly startInPast = computed(() => {
    const today = toISODate(new Date());
    return this.startDate() && this.startDate() < today;
  });


  // ── Helpers ──

  protected clampHours(n: number | null | undefined): number {
    if (n == null || !Number.isFinite(n) || n < 0) return 0;
    return Math.min(24, Math.round(n * 2) / 2);
  }

  /**
   * Single source of truth for the visual state of a preview row. Keeps
   * conditional Tailwind classes out of the template (combining `[class]`,
   * `[class.X]`, and `[class.Y]` on one element trips Angular's strict
   * template parser and surfaced as a confusing "li not terminated" error
   * during the previous build).
   */
  protected rowClasses(row: VacationDay): string {
    if (row.skipped) {
      return 'bg-muted/40 opacity-50 border-border/30';
    }
    if (row.status === 'success') {
      return 'border-green-500/30 bg-green-500/5';
    }
    if (row.status === 'error') {
      return 'border-amber-500/40 bg-amber-500/5';
    }
    return 'border-border/30 bg-muted/10';
  }

  protected onIssueSelected(result: SearchResult): void {
    if (result.type === 'jira') {
      this.selectedIssue.set({ key: result.key, summary: result.summary });
      // Persist as the new remembered default for next time.
      this.settingsService.update({ defaultVacationIssueKey: result.key });
      // Clear any "default missing" warning if it was showing.
      this.defaultKeyMissing.set(false);
      // The "Saved default" badge was for an auto-resolved ticket; a manual
      // pick is by definition the user's choice for this session.
      this.usingSavedDefault.set(false);
    }
  }

  protected clearIssue(): void {
    this.selectedIssue.set(null);
    this.usingSavedDefault.set(false);
    this.issueQuery.set('');
  }

  protected toggleSkipDay(index: number): void {
    this.dayRows.update((rows) => {
      const next = rows.slice();
      const cur = next[index];
      if (!cur) return rows;
      next[index] = { ...cur, skipped: !cur.skipped };
      return next;
    });
  }

  protected updateRowHours(index: number, hours: number): void {
    const clamped = this.clampHours(hours);
    this.dayRows.update((rows) => {
      const next = rows.slice();
      const cur = next[index];
      if (!cur) return rows;
      next[index] = { ...cur, hours: clamped };
      return next;
    });
  }

  /** Push all non-`success` rows sequentially to Jira. */
  protected async pushAll(): Promise<void> {
    if (!this.canPush()) return;
    const issue = this.selectedIssue();
    if (!issue) return;

    const runId = ++this.pushRunId;
    this.pushing.set(true);
    this.pushedSoFar.set(0);
    this.lastPushResult.set(null);

    // Reset every push-eligible row's status before re-running. Already-success
    // rows are left alone (idempotent retry mindset: don't redo work).
    this.resetPushableRowStatuses();

    // Snapshot the rows at push start so a mid-push change of form inputs
    // (start/end/hours) — which rebuilds `dayRows` from scratch — cannot cause
    // us to push a worklog for a different date than the one the user saw.
    const snapshot = this.dayRows().slice();

    // Use the snapshot, not the live dayRows, so the progress denominator
    // stays stable for the entire push even if other paths mutate dayRows.
    this.pushProgressTotal.set(snapshot.filter((r) => !r.skipped).length);

    let success = 0;
    let failed = 0;

    try {
      for (let i = 0; i < snapshot.length; i++) {
        if (!this.alive || runId !== this.pushRunId) break; // aborted

        const row = snapshot[i];
        if (!row || row.skipped || row.status === 'success') continue;

        this.setRowStatus(row.dateISO, 'syncing');

        const started = localDateAt(row.date, 9, 0);
        let res;
        try {
          res = await this.ipc.jiraSyncWorklog({
            issueKey: issue.key,
            timeSpentSeconds: Math.round(row.hours * 3600),
            // Jira Cloud rejects the bare `Z` (UTC) form that `.toISOString()`
            // returns. It requires explicit local timezone offset; the shared
            // helper produces that.
            started: formatJiraLocalIso(started),
            comment: this.comment().trim() || 'Vakantie',
          });
        } catch (err) {
          // IPC can reject under rare conditions (channel torn down, etc.).
          // Mirror JiraService.syncWorklog's contract: surface as a row error
          // and stop the loop, so the row doesn't get stuck in 'syncing'.
          failed++;
          this.pushedSoFar.set(success + failed);
          this.setRowStatus(
            row.dateISO,
            'error',
            err instanceof Error ? err.message : String(err),
          );
          // Stop on first failure — let the user decide what to do.
          break;
        }

        if (!this.alive || runId !== this.pushRunId) {
          // Component was torn down or a new push started in the window
          // between the await resolving and our reach here. Bump the
          // counter so the user-visible progress reflects the row that
          // already finished on Jira's side.
          this.pushedSoFar.set(success + failed);
          break;
        }

        if (res.success) {
          success++;
          // Jira handler returns `{ success: true, worklog: response.data }`
          // where `worklog.id` is the real id (the IpcResponse itself does
          // NOT include a top-level `worklogId`).
          const newWorklogId =
            (res as { worklog?: { id?: string | number } }).worklog?.id != null
              ? String((res as { worklog?: { id?: string | number } }).worklog!.id)
              : (res as { worklogId?: string }).worklogId;
          this.setRowStatus(row.dateISO, 'success', undefined, newWorklogId);
          this.pushedSoFar.set(success + failed);
        } else {
          failed++;
          this.pushedSoFar.set(success + failed);
          this.setRowStatus(
            row.dateISO,
            'error',
            (res as { error?: string }).error || 'Jira rejected the request',
          );
          // Stop on first failure — let the user decide what to do.
          break;
        }
      }
    } finally {
      // Only finalize the visible `pushing` / summary state if we're still
      // the current run AND the component hasn't been torn down. Otherwise
      // we leave the signals alone so we never write to a destroyed view.
      if (this.alive && runId === this.pushRunId) {
        this.pushing.set(false);
        this.lastPushResult.set({ success, failed });
      }
    }
  }

  /** Retry only the rows that haven't succeeded yet (error + pending). */
  protected async retryFailed(): Promise<void> {
    return this.pushAll();
  }

  private resetPushableRowStatuses(): void {
    this.dayRows.update((rows) =>
      rows.map((r) =>
        r.status === 'success'
          ? r
          : { ...r, status: 'idle', errorMessage: undefined, worklogId: undefined },
      ),
    );
  }

  /**
   * Update a single preview row identified by its `dateISO` key. The lookup
   * uses `findIndex` (not array index) because the visible `dayRows` may
   * have been rebuilt by the preview effect mid-push. The early-return on
   * `idx < 0` keeps the call a no-op if the date was removed in a rebuild.
   *
   * Clears the unused field per status (success clears error; error clears
   * worklogId; syncing/idle clears both) so subsequent calls don't leak
   * stale values onto a row.
   */
  private setRowStatus(
    iso: string,
    status: DayStatus,
    errorMessage?: string,
    worklogId?: string,
  ): void {
    this.dayRows.update((rows) => {
      const idx = rows.findIndex((r) => r.dateISO === iso);
      if (idx < 0) return rows;
      const next = rows.slice();
      next[idx] = {
        ...rows[idx],
        status,
        errorMessage: status === 'error' ? errorMessage : undefined,
        worklogId: status === 'success' ? worklogId : undefined,
      };
      return next;
    });
  }

  private async resolveDefaultIssue(key: string): Promise<void> {
    // Avoid stale results: if the user already picked something, bail.
    if (this.selectedIssue()) return;
    try {
      const issues = await this.jiraService.searchIssues(key);
      const match = issues.find((i) => i.key.toUpperCase() === key.toUpperCase());
      if (match && !this.selectedIssue()) {
        this.selectedIssue.set({ key: match.key, summary: match.summary });
        this.usingSavedDefault.set(true);
        this.defaultKeyMissing.set(false);
      } else if (!match) {
        this.defaultKeyMissing.set(true);
      }
    } catch {
      this.defaultKeyMissing.set(true);
    }
  }

  // intentionally empty; placeholder for future bootstrap (e.g. cache lookups)
}

// ── Date utilities ─────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** YYYY-MM-DD string from a local-date Date. */
function toISODate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local-time Date at given hours/minutes on the given calendar date. */
function localDateAt(d: Date, hours: number, minutes: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0);
}

/** Build the Mon–Fri preview rows between ISO `start` and `end` (inclusive). */
function buildWeekdayRows(
  startISO: string,
  endISO: string,
  hours: number,
): VacationDay[] {
  const out: VacationDay[] = [];
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (!start || !end || start.getTime() > end.getTime()) return out;

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabels = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  while (cursor.getTime() <= end.getTime()) {
    const dotw = cursor.getDay();
    // 0 = Sun, 6 = Sat — skip weekends.
    if (dotw !== 0 && dotw !== 6) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      out.push({
        date,
        dateISO: toISODate(date),
        label: `${weekdayLabels[dotw]} ${date.getDate()} ${monthLabels[date.getMonth()]}`,
        hours,
        skipped: false,
        status: 'idle',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, mo, d);
  // Validate that the Date is what we parsed (catches Feb 30 etc).
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}
