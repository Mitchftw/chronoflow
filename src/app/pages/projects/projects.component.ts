import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { ProjectCardComponent } from '../../components/projects/project-card.component';
import { ProjectFormDialogComponent } from '../../components/projects/project-form-dialog.component';
import type { Project } from '../../models/project';

@Component({
  selector: 'app-projects',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectCardComponent, ProjectFormDialogComponent],
  host: { class: 'block' },
  template: `
    <header class="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground/95">Projects</h1>
        <p class="mt-1.5 text-xs font-medium text-muted-foreground/80">
          Manage your projects and track issues
        </p>
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer self-start sm:self-auto"
        (click)="openCreateDialog()"
      >
        <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New Project
      </button>
    </header>

    @if (db.loading() && db.projects().length === 0) {
      <div class="flex items-center justify-center py-16 select-none">
        <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" role="status">
          <span class="sr-only">Loading...</span>
        </div>
      </div>
    } @else if (db.projects().length === 0) {
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/45 py-16 text-center bg-card/25 backdrop-blur-sm select-none">
        <svg class="mb-4 size-12 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p class="text-sm font-bold text-foreground/90">No projects yet</p>
        <button
          class="mt-3 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors cursor-pointer"
          (click)="openCreateDialog()"
        >
          Create your first project
        </button>
      </div>
    } @else {
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (project of db.projects(); track project.id) {
          <app-project-card
            [project]="project"
            [issueCount]="db.getIssuesForProject(project.id).length"
            (editProject)="openEditDialog($event)"
            (deleteProject)="confirmDelete($event)"
          />
        }
      </div>
    }

    <!-- Create/Edit Dialog -->
    @if (showDialog()) {
      <app-project-form-dialog
        [project]="editingProject()"
        (saveProject)="handleSave($event)"
        (cancel)="closeDialog()"
      />
    }

    <!-- Delete Confirmation -->
    @if (showDeleteConfirm()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-background/30 backdrop-blur-md"
        (click)="showDeleteConfirm.set(false)"
      >
        <div
          class="w-full max-w-sm rounded-2xl border border-border/45 bg-card/95 backdrop-blur-xl p-6 shadow-2xl transition-all duration-300 relative"
          role="alertdialog"
          (click)="$event.stopPropagation()"
        >
          <h3 class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20">Delete Project?</h3>
          <p class="mt-3 text-xs text-muted-foreground/60 leading-relaxed">
            This action cannot be undone. All associated issues will remain but become unlinked.
          </p>
          <div class="mt-6 flex justify-end gap-2.5 select-none">
            <button
              class="rounded-xl border border-border/50 bg-secondary/35 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground/90 transition-all duration-200 hover:bg-secondary/75 cursor-pointer"
              (click)="showDeleteConfirm.set(false)"
            >
              Cancel
            </button>
            <button
              class="rounded-xl bg-red-500 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-all duration-300 hover:bg-red-600 shadow-md shadow-red-500/20 active:scale-[0.98] cursor-pointer"
              (click)="executeDelete()"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ProjectsComponent {
  protected db = inject(DatabaseService);

  showDialog = signal(false);
  showDeleteConfirm = signal(false);
  editingProject = signal<Project | null>(null);
  pendingDeleteId = signal<string | null>(null);

  constructor() {
    this.db.reloadProjects();
  }

  openCreateDialog(): void {
    this.editingProject.set(null);
    this.showDialog.set(true);
  }

  openEditDialog(project: Project): void {
    this.editingProject.set(project);
    this.showDialog.set(true);
  }

  closeDialog(): void {
    this.showDialog.set(false);
    this.editingProject.set(null);
  }

  async handleSave(data: { name: string; description: string; color: string }): Promise<void> {
    const existing = this.editingProject();
    try {
      if (existing) {
        await this.db.updateProject(existing.id, data);
      } else {
        await this.db.createProject(data);
      }
      this.closeDialog();
    } catch (err) {
      console.error('Failed to save project', err);
    }
  }

  confirmDelete(id: string): void {
    this.pendingDeleteId.set(id);
    this.showDeleteConfirm.set(true);
  }

  async executeDelete(): Promise<void> {
    const id = this.pendingDeleteId();
    if (!id) return;
    try {
      await this.db.deleteProject(id);
    } catch (err) {
      console.error('Failed to delete project', err);
    } finally {
      this.showDeleteConfirm.set(false);
      this.pendingDeleteId.set(null);
    }
  }
}
