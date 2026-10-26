import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  model,
  computed,
  effect,
  ElementRef,
  viewChild,
} from '@angular/core';
import { DialogComponent } from './dialog.component';
import { DatabaseService } from '../../services/database.service';
import type { Issue } from '../../models/issue';
import type { Project } from '../../models/project';
import { COLOR_PRESETS } from '../../utils/colors';

@Component({
  selector: 'app-issue-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent],
  host: { class: 'block' },
  template: `
    <app-dialog
      [(isOpen)]="isOpen"
      [title]="editingIssue() ? 'Edit Issue' : 'New Issue'"
      [confirmLabel]="confirmLabel()"
      [confirmDisabled]="!isValid() || isSaving()"
      [closable]="!isSaving()"
      (confirm)="onConfirm()"
      (close)="onClose()"
    >
      <div class="space-y-4">
        <!-- Save error -->
        @if (saveError()) {
          <div
            class="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive"
            role="alert"
          >
            <svg class="mt-0.5 size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span class="break-words">{{ saveError() }}</span>
          </div>
        }

        <!-- Title -->
        <div>
          <label for="issue-title" class="mb-2 block text-xs font-bold text-muted-foreground">
            Title <span class="text-primary">*</span>
          </label>
          <input
            #titleInput
            id="issue-title"
            type="text"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
            placeholder="What needs to be tracked?"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            autofocus
          />
        </div>

        <!-- Description -->
        <div>
          <label for="issue-desc" class="mb-2 block text-xs font-bold text-muted-foreground">
            Description
          </label>
          <textarea
            id="issue-desc"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
            placeholder="Add context or notes..."
            rows="3"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Project -->
          <div>
            <label for="issue-project" class="mb-2 block text-xs font-bold text-muted-foreground">
              Project
            </label>
            <select
              id="issue-project"
              [value]="projectId()"
              (change)="projectId.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner cursor-pointer"
            >
              <option value="">No Project</option>
              @for (project of projects(); track project.id) {
                <option [value]="project.id">{{ project.name }}</option>
              }
            </select>
          </div>

          <!-- Status -->
          <div>
            <label for="issue-status" class="mb-2 block text-xs font-bold text-muted-foreground">
              Status
            </label>
            <select
              id="issue-status"
              [value]="status()"
              (change)="status.set($any($event.target).value)"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner cursor-pointer"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Jira Issue Key -->
          <div>
            <label for="issue-jira-key" class="mb-2 block text-xs font-bold text-muted-foreground">
              Jira Issue Key
            </label>
            <input
              id="issue-jira-key"
              type="text"
              [value]="jiraIssueKey()"
              (input)="jiraIssueKey.set($any($event.target).value)"
              placeholder="e.g., PROJ-123"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>

          <!-- Estimate -->
          <div>
            <label for="issue-estimate" class="mb-2 block text-xs font-bold text-muted-foreground">
              Estimate (minutes)
            </label>
            <input
              id="issue-estimate"
              type="number"
              [value]="estimate()"
              (input)="onEstimateInput($event)"
              min="0"
              step="1"
              placeholder="0"
              [attr.aria-invalid]="estimateError() ? 'true' : null"
              [attr.aria-describedby]="estimateError() ? 'issue-estimate-error' : null"
              [class.border-destructive]="!!estimateError()"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
            @if (estimateError()) {
              <p id="issue-estimate-error" class="mt-1.5 text-[10px] font-semibold text-destructive">
                {{ estimateError() }}
              </p>
            }
          </div>
        </div>

        <!-- Accent Colour -->
        <div class="select-none">
          <label class="mb-2.5 block text-xs font-bold text-muted-foreground">
            Accent Colour
          </label>
          <div class="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              class="flex items-center justify-center size-7.5 rounded-full border border-border/40 transition-all hover:scale-110 cursor-pointer"
              style="background: conic-gradient(from 180deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)"
              [class.ring-2]="!color()"
              [class.ring-offset-2]="!color()"
              [class.ring-primary]="!color()"
              [class.ring-offset-background]="!color()"
              (click)="color.set('')"
              aria-label="Automatic colour"
              title="Automatic (derived from the issue)"
            ></button>
            @for (c of colors; track c) {
              <button
                type="button"
                class="size-7.5 rounded-full transition-all hover:scale-110 shadow-sm border border-border/30 hover:border-foreground/20 cursor-pointer"
                [style.background-color]="c"
                [class.ring-2]="color() === c"
                [class.ring-offset-2]="color() === c"
                [class.ring-primary]="color() === c"
                [class.ring-offset-background]="color() === c"
                [class.scale-110]="color() === c"
                (click)="color.set(c)"
                [attr.aria-label]="'Select colour ' + c"
                [attr.aria-current]="color() === c ? 'true' : undefined"
              ></button>
            }
          </div>
        </div>
      </div>
    </app-dialog>
  `,
})
export class IssueFormDialogComponent {
  private readonly db = inject(DatabaseService);

  /** Open state */
  readonly isOpen = model(false);

  /** Projects list */
  readonly projects = input<Project[]>([]);

  /** Issue being edited (null = creating new) */
  readonly editingIssue = input<Issue | null>(null);

  /** Emitted when issue is created/updated */
  readonly saved = output<Issue>();

  /** Emitted when dialog is dismissed */
  readonly dismissed = output<void>();

  /** Colour presets for the accent picker */
  readonly colors = COLOR_PRESETS;

  /** Form fields */
  readonly title = signal('');
  readonly description = signal('');
  readonly projectId = signal('');
  readonly jiraIssueKey = signal('');
  readonly estimate = signal(0);
  readonly status = signal<'todo' | 'in_progress' | 'done'>('todo');
  /** Empty string means "automatic" (derived from the issue id). */
  readonly color = signal('');

  /** Save state */
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly estimateError = signal<string | null>(null);

  /** Title field, focused when the dialog opens (the `autofocus` attribute
   *  only works for the initial page load, not for a dialog rendered later). */
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  /** Form validity */
  readonly isValid = computed(
    () =>
      this.title().trim().length > 0 &&
      !this.estimateError() &&
      Number.isFinite(this.estimate()) &&
      this.estimate() >= 0,
  );

  readonly confirmLabel = computed(() =>
    this.isSaving()
      ? 'Saving…'
      : this.editingIssue()
        ? 'Save Changes'
        : 'Create Issue',
  );

  constructor() {
    // Populate form when editing an issue
    effect(() => {
      const issue = this.editingIssue();
      if (issue) {
        this.title.set(issue.title ?? '');
        this.description.set(issue.description ?? '');
        this.projectId.set(issue.projectId ?? '');
        this.jiraIssueKey.set(issue.jiraIssueKey ?? '');
        this.estimate.set(
          Number.isFinite(issue.estimate) ? Math.max(0, Math.floor(issue.estimate)) : 0,
        );
        this.status.set(issue.status ?? 'todo');
        this.color.set(issue.color ?? '');
        this.estimateError.set(null);
        this.saveError.set(null);
      }
    });

    // Reset form when opening for create
    effect(() => {
      if (this.isOpen() && !this.editingIssue()) {
        this.resetForm();
      }
    });

    // Focus the title whenever the dialog (re)opens.
    effect(() => {
      const input = this.titleInput();
      if (this.isOpen() && input) {
        input.nativeElement.focus();
      }
    });
  }

  private resetForm(): void {
    this.title.set('');
    this.description.set('');
    this.projectId.set('');
    this.jiraIssueKey.set('');
    this.estimate.set(0);
    this.status.set('todo');
    this.color.set('');
    this.estimateError.set(null);
    this.saveError.set(null);
  }

  onEstimateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    if (!raw) {
      this.estimate.set(0);
      this.estimateError.set(null);
      return;
    }

    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      this.estimate.set(0);
      this.estimateError.set('Enter a valid number of minutes.');
      return;
    }
    if (value < 0) {
      this.estimate.set(0);
      this.estimateError.set('Estimate cannot be negative.');
      return;
    }

    this.estimate.set(Math.floor(value));
    this.estimateError.set(null);
  }

  async onConfirm(): Promise<void> {
    if (!this.isValid() || this.isSaving()) return;

    this.isSaving.set(true);
    this.saveError.set(null);

    const existing = this.editingIssue();
    const estimate = Number.isFinite(this.estimate())
      ? Math.max(0, Math.floor(this.estimate()))
      : 0;
    const description = this.description().trim();
    const projectId = this.projectId();
    const jiraIssueKey = this.jiraIssueKey().trim() || null;

    try {
      if (existing) {
        // Empty strings / null must be sent explicitly so the database
        // actually clears those fields (undefined means "leave unchanged").
        const updated = await this.db.updateIssue(existing.id, {
          title: this.title().trim(),
          description,
          projectId,
          jiraIssueKey,
          estimate,
          status: this.status(),
          color: this.color() || null,
        });
        if (!updated) {
          this.saveError.set('The issue could not be saved. It may have been deleted.');
          return;
        }
        this.saved.emit(updated);
      } else {
        // Create new — emit the canonical issue returned by the service, since
        // it generates the real id/createdAt.
        const created = await this.db.createIssue({
          title: this.title().trim(),
          description,
          projectId,
          status: this.status(),
          jiraIssueKey,
          estimate,
          color: this.color() || null,
        });
        if (!created) {
          this.saveError.set('The issue could not be created. Please try again.');
          return;
        }
        this.saved.emit(created);
      }

      this.isOpen.set(false);
    } catch (err) {
      console.error('Failed to save issue', err);
      this.saveError.set(this.toErrorMessage(err));
    } finally {
      this.isSaving.set(false);
    }
  }

  onClose(): void {
    this.dismissed.emit();
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message.trim()) return err.message;
    if (typeof err === 'string' && err.trim()) return err;
    return 'Could not save the issue. Please try again.';
  }
}
