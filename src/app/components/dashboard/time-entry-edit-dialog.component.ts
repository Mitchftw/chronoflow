import { Component, ChangeDetectionStrategy, inject, input, output, signal, model, computed, effect } from '@angular/core';
import { DialogComponent } from '../common/dialog.component';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import { DatabaseService } from '../../services/database.service';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';
import { formatTimeHm, parseLocalDate, toLocalDate } from '../../utils/time';

@Component({
  selector: 'app-time-entry-edit-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, SearchBarComponent],
  host: { class: 'block' },
  template: `
    <app-dialog
      [(isOpen)]="isOpen"
      [title]="entry() ? 'Edit Time Entry' : 'New Time Entry'"
      [confirmLabel]="saving() ? 'Saving…' : (entry() ? 'Save Changes' : 'Create Entry')"
      [confirmDisabled]="!isValid() || saving()"
      [cancelLabel]="saving() ? '' : 'Cancel'"
      [closable]="!saving()"
      (confirm)="onConfirm()"
      (close)="onClose()"
    >
      <div class="space-y-4">
        <!-- Issue Selection / Display -->
        <div>
          <label for="entry-issue" class="mb-2 block text-xs font-bold text-muted-foreground">
            Issue <span class="text-primary">*</span>
          </label>
          @if (entry()) {
            <div class="w-full rounded-xl border border-border/20 bg-muted/10 px-4 py-3.5 text-sm font-semibold text-foreground/80 select-none">
              {{ issueName() }}
            </div>
          } @else {
            <div class="relative z-30">
              <app-search-bar
                [(query)]="selectedIssueQuery"
                [localIssues]="issues()"
                (resultSelected)="handleIssueSelection($event)"
                placeholder="Search or create issue..."
              />
            </div>
          }
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <!-- Date -->
          <div>
            <label for="edit-entry-date" class="mb-2 block text-xs font-bold text-muted-foreground">
              Date <span class="text-primary">*</span>
            </label>
            <input
              id="edit-entry-date"
              type="date"
              [value]="entryDate()"
              (input)="entryDate.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>

          <!-- Start Time -->
          <div>
            <label for="edit-start-time" class="mb-2 block text-xs font-bold text-muted-foreground">
              Start Time <span class="text-primary">*</span>
            </label>
            <input
              id="edit-start-time"
              type="time"
              step="60"
              [value]="startTime()"
              (input)="startTime.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>

          <!-- End Time -->
          <div>
            <label for="edit-end-time" class="mb-2 block text-xs font-bold text-muted-foreground">
              End Time
            </label>
            <input
              id="edit-end-time"
              type="time"
              step="60"
              [value]="endTime()"
              (input)="endTime.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>
        </div>

        @if (crossesMidnight()) {
          <p class="text-xs text-muted-foreground">
            The end time is before the start time, so this entry will be treated as crossing midnight.
          </p>
        }

        <!-- Description / Note -->
        <div>
          <label for="edit-entry-note" class="mb-2 block text-xs font-bold text-muted-foreground">
            Description
          </label>
          <textarea
            id="edit-entry-note"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
            placeholder="Add description..."
            rows="3"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
          ></textarea>
        </div>

        @if (errorMessage()) {
          <div
            class="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-xs font-medium text-destructive"
            role="alert"
          >
            {{ errorMessage() }}
          </div>
        }
      </div>
    </app-dialog>
  `,
})
export class TimeEntryEditDialogComponent {
  private readonly db = inject(DatabaseService);

  /** Open state */
  readonly isOpen = model(false);

  /** Entry being edited (null = creating new manual entry) */
  readonly entry = input<TimeEntry | null>(null);

  /** Date for new manual entry */
  readonly date = input<string>('');

  /** Optional values to pre-fill when creating a new entry (e.g. from a timeline gap). */
  readonly prefill = input<{ startTime?: string; endTime?: string; issueId?: string } | null>(null);

  /** Issues list */
  readonly issues = input<Issue[]>([]);

  /** Emitted when entry is updated/created */
  readonly saved = output<TimeEntry>();

  /** Emitted when dialog is dismissed */
  readonly dismissed = output<void>();

  /** Form fields */
  readonly entryDate = signal('');
  readonly startTime = signal('');
  readonly endTime = signal('');
  readonly note = signal('');
  readonly selectedIssueId = signal('');
  readonly selectedIssueQuery = signal('');

  /** Save state + readable failure message. */
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  /** Strip seconds from a "HH:MM[:SS]" time so manual editing stays at minute precision. */
  private toHm(time: string | null | undefined): string {
    return formatTimeHm(time);
  }

  /** Display Name for associated issue (in edit mode) */
  readonly issueName = computed(() => {
    const activeEntry = this.entry();
    if (!activeEntry) return '';
    const issue = this.issues().find((i) => i.id === activeEntry.issueId);
    if (!issue) return activeEntry.issueId.slice(0, 8);
    return issue.jiraIssueKey ? `${issue.jiraIssueKey} ${issue.title}` : issue.title;
  });

  /** Form validity */
  readonly isValid = computed(() => {
    const dateVal = (this.entryDate() ?? '').trim();
    const start = (this.startTime() ?? '').trim();
    const end = (this.endTime() ?? '').trim();
    const hasIssue = this.entry() ? true : !!this.selectedIssueId();
    if (!dateVal || !start || !hasIssue) return false;
    if (!parseLocalDate(dateVal)) return false;
    if (!this.isValidTime(start)) return false;
    if (end && !this.isValidTime(end)) return false;
    return true;
  });

  /** An end before the start is a legitimate overnight entry. */
  readonly crossesMidnight = computed(() => {
    const start = (this.startTime() ?? '').trim();
    const end = (this.endTime() ?? '').trim();
    return (
      this.isValidTime(start) &&
      this.isValidTime(end) &&
      end < start
    );
  });

  constructor() {
    // Populate form fields when entry changes (edit mode)
    effect(() => {
      const activeEntry = this.entry();
      if (activeEntry) {
        this.entryDate.set(activeEntry.date || this.date() || toLocalDate());
        this.startTime.set(this.toHm(activeEntry.startTime));
        this.endTime.set(this.toHm(activeEntry.endTime));
        this.note.set(activeEntry.note ?? '');
        if (this.isOpen()) this.errorMessage.set('');
      }
    });

    // Reset/populate default form fields when opening for create mode
    effect(() => {
      if (this.isOpen() && !this.entry()) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const prefill = this.prefill();
        const defaultStart = this.toHm(prefill?.startTime) || `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const defaultDate = this.date() || toLocalDate(now);
        this.entryDate.set(defaultDate);
        this.startTime.set(defaultStart);
        this.endTime.set(this.toHm(prefill?.endTime));
        this.note.set('');
        this.selectedIssueId.set(prefill?.issueId ?? '');
        this.selectedIssueQuery.set('');
        this.errorMessage.set('');
        if (prefill?.issueId) {
          const issue = this.issues().find((i) => i.id === prefill.issueId);
          if (issue) {
            this.selectedIssueQuery.set(
              issue.jiraIssueKey ? `[${issue.jiraIssueKey}] ${issue.title}` : issue.title,
            );
          }
        }
      }
    });
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
        this.selectedIssueQuery.set(issue.jiraIssueKey ? `[${issue.jiraIssueKey}] ${issue.title}` : issue.title);
      }
    }
  }

  async onConfirm(): Promise<void> {
    if (!this.isValid() || this.saving()) return;

    const activeEntry = this.entry();
    const targetDate = (this.entryDate() ?? '').trim() || this.date() || toLocalDate();
    const start = (this.startTime() ?? '').trim();
    const end = (this.endTime() ?? '').trim() || null;
    const currentNote = (this.note() ?? '').trim();

    this.saving.set(true);
    this.errorMessage.set('');

    try {
      if (activeEntry) {
        // Edit mode
        const updated = await this.db.updateTimeEntry(activeEntry.id, {
          date: targetDate,
          startTime: start,
          endTime: end,
          note: currentNote,
          isDirty: true,
        });
        if (!updated) throw new Error('The entry could not be saved.');
        this.saved.emit(updated);
      } else {
        // Create mode
        const issueId = this.selectedIssueId();
        if (!issueId) throw new Error('Select an issue before saving.');

        const newEntry = await this.db.createTimeEntry({
          issueId,
          date: targetDate,
          startTime: start,
          endTime: end,
          note: currentNote,
          isDirty: true,
        });
        if (!newEntry) throw new Error('The entry could not be created.');
        this.saved.emit(newEntry);
      }

      // Only dismiss after a successful save; failures stay on screen with
      // their message so the user can correct the input.
      this.isOpen.set(false);
    } catch (err) {
      console.error('Failed to save time entry:', err);
      this.errorMessage.set(this.describeError(err, 'Failed to save the time entry.'));
    } finally {
      this.saving.set(false);
    }
  }

  onClose(): void {
    this.dismissed.emit();
  }

  /** `HH:MM` validation; the time inputs submit minute precision only. */
  private isValidTime(value: string): boolean {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
    if (!match) return false;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === 'string' && err) return err;
    return fallback;
  }
}
