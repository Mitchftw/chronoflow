import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  model,
  effect,
} from '@angular/core';
import { DialogComponent } from '../common/dialog.component';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import { DatabaseService } from '../../services/database.service';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';

/** "HH:MM[:SS]" → minutes since local midnight (float). */
function toMinutes(time: string): number {
  const [h = 0, m = 0, s = 0] = time.split(':').map(Number);
  return h * 60 + m + (s ? s / 60 : 0);
}

/** minutes since midnight → "HH:MM:00" wall-clock string. */
function fmtTime(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes)) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}:00`;
}

@Component({
  selector: 'app-time-entry-split-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, SearchBarComponent],
  host: { class: 'block' },
  template: `
    <app-dialog
      [(isOpen)]="isOpen"
      title="Split Time Entry"
      confirmLabel="Split"
      [confirmDisabled]="!isValid()"
      (confirm)="onConfirm()"
    >
      <div class="space-y-4">
        <!-- Entry summary -->
        <div class="rounded-xl border border-border/20 bg-muted/10 px-4 py-3">
          <div class="text-sm font-semibold text-foreground/90">{{ issueName() }}</div>
          <div class="mt-0.5 text-xs font-mono text-muted-foreground">
            {{ entry()?.startTime }} – {{ entry()?.endTime ?? 'now' }} · {{ durationLabel() }}
          </div>
        </div>

        <!-- Mode toggle -->
        <div>
          <label class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
            What do you want to do?
          </label>
          <div class="flex gap-1 rounded-xl border border-border/40 bg-muted/20 p-1">
            <button
              class="flex-1 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer"
              [class]="mode() === 'range'
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
              (click)="mode.set('range')"
            >
              Remove / move a block
            </button>
            <button
              class="flex-1 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer"
              [class]="mode() === 'cut'
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
              (click)="mode.set('cut')"
            >
              Split at a point
            </button>
          </div>
        </div>

        @if (mode() === 'range') {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="split-from" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                From <span class="text-primary">*</span>
              </label>
              <input
                id="split-from"
                type="time"
                step="1"
                [value]="fromTime()"
                (input)="fromTime.set($any($event.target).value)"
                class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
              />
            </div>
            <div>
              <label for="split-to" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                To <span class="text-primary">*</span>
              </label>
              <input
                id="split-to"
                type="time"
                step="1"
                [value]="toTime()"
                (input)="toTime.set($any($event.target).value)"
                class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
              />
            </div>
          </div>
          <p class="text-xs text-muted-foreground/60">
            The time between these moments is cut out of the entry — handy for lunch breaks or other pauses.
          </p>
        } @else {
          <div>
            <label for="split-at" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              Split at <span class="text-primary">*</span>
            </label>
            <input
              id="split-at"
              type="time"
              step="1"
              [value]="splitAtTime()"
              (input)="splitAtTime.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>
          <p class="text-xs text-muted-foreground/60">
            The entry is cut at this moment into two separate entries.
          </p>
        }

        <!-- Target issue (optional) -->
        <div>
          <label class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
            {{ targetLabel() }}
          </label>
          <div class="relative z-30">
            @if (selectedIssueId()) {
              <div class="flex items-center justify-between gap-2 rounded-xl border border-border/20 bg-muted/10 px-4 py-2.5">
                <span class="text-sm font-semibold text-foreground/85">{{ selectedIssueLabel() }}</span>
                <button
                  class="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-secondary/70 hover:text-foreground transition-all cursor-pointer"
                  (click)="clearTarget()"
                  title="Clear target issue"
                  aria-label="Clear target issue"
                >
                  <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            } @else {
              <app-search-bar
                [(query)]="selectedIssueQuery"
                [localIssues]="issues()"
                (resultSelected)="handleIssueSelection($event)"
                placeholder="Search or create issue..."
              />
            }
          </div>
          <p class="mt-1.5 text-xs text-muted-foreground/60">{{ targetHint() }}</p>
        </div>

        @if (errorMessage()) {
          <div class="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-xs text-destructive-foreground">
            {{ errorMessage() }}
          </div>
        }
      </div>
    </app-dialog>
  `,
})
export class TimeEntrySplitDialogComponent {
  private readonly db = inject(DatabaseService);

  /** Open state */
  readonly isOpen = model(false);

  /** Entry being split */
  readonly entry = input<TimeEntry | null>(null);

  /** Issues list (for the optional target-issue picker) */
  readonly issues = input<Issue[]>([]);

  /** Emitted after a successful split */
  readonly saved = output<void>();

  readonly mode = signal<'range' | 'cut'>('range');
  readonly fromTime = signal('');
  readonly toTime = signal('');
  readonly splitAtTime = signal('');
  readonly selectedIssueId = signal('');
  readonly selectedIssueQuery = signal('');
  readonly errorMessage = signal('');

  /** The entry's effective end: stored end, or "now" while it is running. */
  readonly effectiveEnd = computed(() => {
    const e = this.entry();
    if (!e) return '';
    if (e.endTime) return e.endTime;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  });

  readonly issueName = computed(() => {
    const e = this.entry();
    if (!e) return '';
    const issue = this.issues().find((i) => i.id === e.issueId);
    if (!issue) return e.issueId.slice(0, 8);
    return issue.jiraIssueKey ? `${issue.jiraIssueKey} ${issue.title}` : issue.title;
  });

  readonly durationLabel = computed(() => {
    const e = this.entry();
    if (!e) return '';
    if (!e.endTime) return 'running';
    const diffMin = Math.round(toMinutes(e.endTime) - toMinutes(e.startTime));
    if (diffMin <= 0) return '< 1m';
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

  readonly selectedIssueLabel = computed(() => {
    const id = this.selectedIssueId();
    if (!id) return '';
    const issue = this.issues().find((i) => i.id === id);
    if (!issue) return id.slice(0, 8);
    return issue.jiraIssueKey ? `${issue.jiraIssueKey} ${issue.title}` : issue.title;
  });

  readonly targetLabel = computed(() =>
    this.mode() === 'range'
      ? 'Move the removed block to another issue (optional)'
      : 'Move the part after the cut to another issue (optional)',
  );

  readonly targetHint = computed(() =>
    this.mode() === 'range'
      ? 'Leave empty to simply remove the block (e.g. a lunch break).'
      : 'Leave empty to keep both parts on the same issue.',
  );

  readonly isValid = computed(() => {
    const e = this.entry();
    if (!e) return false;
    const start = e.startTime;
    const end = this.effectiveEnd();
    if (this.mode() === 'range') {
      const from = this.fromTime();
      const to = this.toTime();
      return !!from && !!to && from > start && from < to && to <= end;
    }
    const at = this.splitAtTime();
    return !!at && at > start && at < end;
  });

  constructor() {
    // (Re)initialize the form whenever the dialog opens.
    effect(() => {
      if (this.isOpen() && this.entry()) this.resetForm();
    });
  }

  private resetForm(): void {
    const e = this.entry();
    if (!e) return;
    const startMin = Math.floor(toMinutes(e.startTime));
    const endMin = Math.floor(toMinutes(this.effectiveEnd()));
    const dur = Math.max(2, endMin - startMin);
    const third = Math.max(1, Math.floor(dur / 3));

    const fromMin = Math.max(startMin + 1, Math.min(startMin + third, endMin - 1));
    const toMin = Math.min(fromMin + third, endMin);

    this.mode.set('range');
    this.fromTime.set(fmtTime(fromMin));
    this.toTime.set(fmtTime(toMin));
    this.splitAtTime.set(fmtTime(startMin + Math.floor(dur / 2)));
    this.selectedIssueId.set('');
    this.selectedIssueQuery.set('');
    this.errorMessage.set('');
  }

  async handleIssueSelection(result: SearchResult): Promise<void> {
    let targetIssueId: string | undefined;

    if (result.type === 'create') {
      const issue = await this.db.createIssue({ title: result.issue.title });
      targetIssueId = issue.id;
      await this.db.reloadIssues();
    } else if (result.type === 'jira') {
      const existing = this.issues().find((i) => i.jiraIssueKey === result.key);
      if (existing) {
        targetIssueId = existing.id;
      } else {
        const issue = await this.db.createIssue({
          title: result.summary,
          jiraIssueKey: result.key,
        });
        targetIssueId = issue.id;
        await this.db.reloadIssues();
      }
    } else if (result.type === 'local') {
      targetIssueId = result.id;
    }

    if (targetIssueId) {
      this.selectedIssueId.set(targetIssueId);
      const issue = this.issues().find((i) => i.id === targetIssueId);
      if (issue) {
        this.selectedIssueQuery.set(
          issue.jiraIssueKey ? `[${issue.jiraIssueKey}] ${issue.title}` : issue.title,
        );
      }
    }
  }

  clearTarget(): void {
    this.selectedIssueId.set('');
    this.selectedIssueQuery.set('');
  }

  async onConfirm(): Promise<void> {
    const e = this.entry();
    if (!e || !this.isValid()) return;

    const target = this.selectedIssueId() || undefined;
    this.errorMessage.set('');
    try {
      if (this.mode() === 'range') {
        await this.db.splitOutTimeEntry(e.id, this.fromTime(), this.toTime(), target);
      } else {
        await this.db.splitTimeEntry(e.id, this.splitAtTime(), target);
      }
      this.saved.emit();
      this.isOpen.set(false);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to split the entry');
    }
  }
}
