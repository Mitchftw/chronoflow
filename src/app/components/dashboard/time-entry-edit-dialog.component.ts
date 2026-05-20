import { Component, ChangeDetectionStrategy, inject, input, output, signal, model, computed, effect } from '@angular/core';
import { DialogComponent } from '../common/dialog.component';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import { DatabaseService } from '../../services/database.service';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-time-entry-edit-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, SearchBarComponent],
  host: { class: 'block' },
  template: `
    <app-dialog
      [(isOpen)]="isOpen"
      [title]="entry() ? 'Edit Time Entry' : 'New Time Entry'"
      [confirmLabel]="entry() ? 'Save Changes' : 'Create Entry'"
      [confirmDisabled]="!isValid()"
      (confirm)="onConfirm()"
      (close)="onClose()"
    >
      <div class="space-y-4">
        <!-- Issue Selection / Display -->
        <div>
          <label for="entry-issue" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
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

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Start Time -->
          <div>
            <label for="edit-start-time" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              Start Time <span class="text-primary">*</span>
            </label>
            <input
              id="edit-start-time"
              type="time"
              step="1"
              [value]="startTime()"
              (input)="startTime.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>

          <!-- End Time -->
          <div>
            <label for="edit-end-time" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              End Time
            </label>
            <input
              id="edit-end-time"
              type="time"
              step="1"
              [value]="endTime()"
              (input)="endTime.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>
        </div>

        <!-- Description / Note -->
        <div>
          <label for="edit-entry-note" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
            Description
          </label>
          <textarea
            id="edit-entry-note"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
            placeholder="Add description..."
            rows="3"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
          ></textarea>
        </div>
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

  /** Issues list */
  readonly issues = input<Issue[]>([]);

  /** Emitted when entry is updated/created */
  readonly saved = output<TimeEntry>();

  /** Emitted when dialog is dismissed */
  readonly dismissed = output<void>();

  /** Form fields */
  readonly startTime = signal('');
  readonly endTime = signal('');
  readonly note = signal('');
  readonly selectedIssueId = signal('');
  readonly selectedIssueQuery = signal('');

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
    const start = this.startTime().trim();
    const end = this.endTime().trim();
    const hasIssue = this.entry() ? true : !!this.selectedIssueId();
    if (!start || !hasIssue) return false;
    // If end time is set, it must be chronologically after start time
    if (end && end <= start) return false;
    return true;
  });

  constructor() {
    // Populate form fields when entry changes (edit mode)
    effect(() => {
      const activeEntry = this.entry();
      if (activeEntry) {
        this.startTime.set(activeEntry.startTime);
        this.endTime.set(activeEntry.endTime ?? '');
        this.note.set(activeEntry.note);
      }
    });

    // Reset/populate default form fields when opening for create mode
    effect(() => {
      if (this.isOpen() && !this.entry()) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const defaultStart = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        this.startTime.set(defaultStart);
        this.endTime.set('');
        this.note.set('');
        this.selectedIssueId.set('');
        this.selectedIssueQuery.set('');
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
    if (!this.isValid()) return;

    const activeEntry = this.entry();
    const start = this.startTime().trim();
    const end = this.endTime().trim() || null;
    const currentNote = this.note().trim();

    if (activeEntry) {
      // Edit mode
      const updated = await this.db.updateTimeEntry(activeEntry.id, {
        startTime: start,
        endTime: end,
        note: currentNote,
        isDirty: true,
      });
      if (updated) {
        this.saved.emit(updated);
      }
    } else {
      // Create mode
      const issueId = this.selectedIssueId();
      if (!issueId) return;

      const newEntry = await this.db.createTimeEntry({
        issueId,
        startTime: start,
        endTime: end,
        date: this.date() || new Date().toISOString().slice(0, 10),
        note: currentNote,
        isDirty: true,
      });
      if (newEntry) {
        this.saved.emit(newEntry);
      }
    }

    this.isOpen.set(false);
  }

  onClose(): void {
    this.dismissed.emit();
  }
}
