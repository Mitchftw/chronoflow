import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import type { Project } from '../../models/project';

const COLOR_PRESETS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#ef4444', // red
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ec4899', // pink
];

@Component({
  selector: 'app-project-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fixed inset-0 z-50 flex items-center justify-center bg-background/30 backdrop-blur-md',
    '(click)': 'onBackdropClick($event)',
  },
  template: `
    <div
      class="w-full max-w-md rounded-2xl border border-border/45 bg-card/95 backdrop-blur-xl p-6 shadow-2xl transition-all duration-300 relative"
      role="dialog"
      [attr.aria-label]="project() ? 'Edit Project' : 'New Project'"
    >
      <h2 class="mb-5 text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20">
        {{ project() ? 'Edit Project' : 'New Project' }}
      </h2>

      <!-- Name -->
      <div class="mb-5">
        <label for="project-name" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Name</label>
        <input
          id="project-name"
          type="text"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          placeholder="Project name"
          class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
        />
      </div>

      <!-- Description -->
      <div class="mb-5">
        <label for="project-desc" class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Description</label>
        <textarea
          id="project-desc"
          [value]="description()"
          (input)="description.set($any($event.target).value)"
          placeholder="Optional description"
          rows="2"
          class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
        ></textarea>
      </div>

      <!-- Color Picker -->
      <div class="mb-7 select-none">
        <label class="mb-2.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Color</label>
        <div class="flex flex-wrap gap-2.5">
          @for (c of colors; track c) {
            <button
              class="size-7.5 rounded-full transition-all hover:scale-110 shadow-sm border border-border/30 hover:border-foreground/20 cursor-pointer"
              [style.background-color]="c"
              [class.ring-2]="color() === c"
              [class.ring-offset-2]="color() === c"
              [class.ring-primary]="color() === c"
              [class.ring-offset-background]="color() === c"
              [class.scale-110]="color() === c"
              (click)="color.set(c)"
              [attr.aria-label]="'Select color ' + c"
              [attr.aria-current]="color() === c ? 'true' : undefined"
            ></button>
          }
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2.5 select-none">
        <button
          class="rounded-xl border border-border/50 bg-secondary/35 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground/90 transition-all duration-200 hover:bg-secondary/75 disabled:opacity-40 cursor-pointer"
          (click)="cancel.emit()"
        >
          Cancel
        </button>
        <button
          class="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 disabled:opacity-40 disabled:pointer-events-none shadow-md shadow-primary/20 active:scale-[0.98] cursor-pointer"
          (click)="save()"
          [disabled]="!name().trim()"
        >
          {{ project() ? 'Save' : 'Create' }}
        </button>
      </div>
    </div>
  `,
})
export class ProjectFormDialogComponent {
  project = input<Project | null>(null);

  saveProject = output<{ name: string; description: string; color: string }>();
  cancel = output<void>();

  readonly colors = COLOR_PRESETS;

  name = signal('');
  description = signal('');
  color = signal('#3b82f6');

  constructor() {
    // Initialize from input if editing
    // Using a simple approach - just watch for project changes
  }

  ngOnInit(): void {
    const p = this.project();
    if (p) {
      this.name.set(p.name);
      this.description.set(p.description || '');
      this.color.set(p.color || '#3b82f6');
    }
  }

  save(): void {
    if (!this.name().trim()) return;
    this.saveProject.emit({
      name: this.name().trim(),
      description: this.description().trim(),
      color: this.color(),
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('bg-black/50')) {
      this.cancel.emit();
    }
  }
}
