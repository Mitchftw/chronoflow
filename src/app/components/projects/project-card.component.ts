import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { Project } from '../../models/project';

@Component({
  selector: 'app-project-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-5 shadow-sm transition-all duration-300 hover:bg-card/90 hover:scale-[1.01] hover:shadow-md hover:border-primary/25',
  },
  template: `
    <div class="mb-4 flex items-center gap-3">
      <div
        class="size-3.5 shrink-0 rounded-full shadow-sm"
        [style.background-color]="project().color || '#3b82f6'"
      ></div>
      <div class="flex-1 min-w-0">
        <h3 class="truncate text-sm font-bold text-foreground/95 tracking-tight">{{ project().name }}</h3>
        @if (project().description) {
          <p class="truncate text-xs text-muted-foreground/60 mt-0.5">{{ project().description }}</p>
        }
      </div>
    </div>

    <div class="mb-4 flex items-center gap-2 text-xs text-muted-foreground/75 select-none">
      <span class="inline-flex items-center gap-1 rounded-lg bg-secondary/60 px-2.5 py-1 font-semibold text-foreground/80 border border-border/20">
        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {{ issueCount() }} issues
      </span>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-border/20 pt-3.5 select-none">
      <button
        class="rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-500 transition-all duration-200 hover:bg-red-500/10 active:scale-95 cursor-pointer"
        (click)="deleteProject.emit(project().id)"
      >
        Delete
      </button>
      <button
        class="ml-auto rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary transition-all duration-200 hover:bg-primary/10 active:scale-95 cursor-pointer"
        (click)="editProject.emit(project())"
      >
        Edit
      </button>
    </div>
  `,
})
export class ProjectCardComponent {
  project = input.required<Project>();
  issueCount = input(0);

  editProject = output<Project>();
  deleteProject = output<string>();
}
