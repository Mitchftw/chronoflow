import { Component, ChangeDetectionStrategy, inject, input, output, signal, model, computed, effect } from '@angular/core';
import { DialogComponent } from './dialog.component';
import { DatabaseService } from '../../services/database.service';
import type { Issue } from '../../models/issue';
import type { Project } from '../../models/project';
import { COLOR_PRESETS, colorFromId } from '../../utils/colors';

@Component({
  selector: 'app-issue-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent],
  host: { class: 'block' },
  template: `
    <app-dialog
      [(isOpen)]="isOpen"
      [title]="editingIssue() ? 'Edit Issue' : 'New Issue'"
      [confirmLabel]="editingIssue() ? 'Save Changes' : 'Create Issue'"
      [confirmDisabled]="!isValid()"
      (confirm)="onConfirm()"
      (close)="onClose()"
    >
      <div class="space-y-4">
        <!-- Title -->
        <div>
          <label for="issue-title" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
            Title <span class="text-primary">*</span>
          </label>
          <input
            id="issue-title"
            type="text"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
            placeholder="What needs to be tracked?"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            autofocus
          />
        </div>

        <!-- Description -->
        <div>
          <label for="issue-desc" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
            Description
          </label>
          <textarea
            id="issue-desc"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
            placeholder="Add context or notes..."
            rows="3"
            class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Project -->
          <div>
            <label for="issue-project" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
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
            <label for="issue-status" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
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
            <label for="issue-jira-key" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              Jira Issue Key
            </label>
            <input
              id="issue-jira-key"
              type="text"
              [value]="jiraIssueKey()"
              (input)="jiraIssueKey.set($any($event.target).value)"
              placeholder="e.g., PROJ-123"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>

          <!-- Estimate -->
          <div>
            <label for="issue-estimate" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              Estimate (minutes)
            </label>
            <input
              id="issue-estimate"
              type="number"
              [value]="estimate()"
              (input)="estimate.set($any($event.target).valueAsNumber ?? 0)"
              min="0"
              placeholder="0"
              class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
            />
          </div>
        </div>

        <!-- Accent Colour -->
        <div class="select-none">
          <label class="mb-2.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
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

  /** Form validity */
  readonly isValid = computed(() => this.title().trim().length > 0);

  constructor() {
    // Populate form when editing an issue
    effect(() => {
      const issue = this.editingIssue();
      if (issue) {
        this.title.set(issue.title);
        this.description.set(issue.description ?? '');
        this.projectId.set(issue.projectId ?? '');
        this.jiraIssueKey.set(issue.jiraIssueKey ?? '');
        this.estimate.set(issue.estimate);
        this.status.set(issue.status);
        this.color.set(issue.color ?? '');
      }
    });

    // Reset form when opening for create
    effect(() => {
      if (this.isOpen() && !this.editingIssue()) {
        this.resetForm();
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
  }

  async onConfirm(): Promise<void> {
    if (!this.isValid()) return;

    const existing = this.editingIssue();

    if (existing) {
      // Update existing
      const updated = await this.db.updateIssue(existing.id, {
        title: this.title().trim(),
        description: this.description().trim() || undefined,
        projectId: this.projectId() || undefined,
        jiraIssueKey: this.jiraIssueKey().trim() || undefined,
        estimate: this.estimate(),
        status: this.status(),
        color: this.color() || null,
      });
      if (updated) {
        this.saved.emit(updated);
      }
    } else {
      // Create new — emit the canonical issue returned by the service, since
      // it generates the real id/createdAt.
      const created = await this.db.createIssue({
        title: this.title().trim(),
        description: this.description().trim(),
        projectId: this.projectId() || '',
        status: this.status(),
        jiraIssueKey: this.jiraIssueKey().trim() || null,
        estimate: this.estimate(),
        color: this.color() || null,
      });
      this.saved.emit(created);
    }

    this.isOpen.set(false);
  }

  onClose(): void {
    this.dismissed.emit();
  }
}
