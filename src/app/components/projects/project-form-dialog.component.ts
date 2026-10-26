import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Project } from '../../models/project';
import { COLOR_PRESETS, DEFAULT_COLOR } from '../../utils/colors';

@Component({
  selector: 'app-project-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-md',
    '(click)': 'onBackdropClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <div
      class="relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border/45 bg-card/95 p-6 shadow-2xl transition-all duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-dialog-title"
    >
      <h2
        id="project-dialog-title"
        class="mb-5 border-b border-border/20 pb-2 text-sm font-bold text-muted-foreground"
      >
        {{ project() ? 'Edit Project' : 'New Project' }}
      </h2>

      <!-- Name -->
      <div class="mb-5">
        <label for="project-name" class="mb-2 block text-xs font-bold text-muted-foreground">Name</label>
        <input
          #nameInput
          id="project-name"
          type="text"
          autofocus
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          placeholder="Project name"
          class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
        />
      </div>

      <!-- Description -->
      <div class="mb-5">
        <label for="project-desc" class="mb-2 block text-xs font-bold text-muted-foreground">Description</label>
        <textarea
          id="project-desc"
          [value]="description()"
          (input)="description.set($any($event.target).value)"
          placeholder="Optional description"
          rows="2"
          class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner resize-none"
        ></textarea>
      </div>

      <!-- Color Picker -->
      <div class="mb-7 select-none">
        <label class="mb-2.5 block text-xs font-bold text-muted-foreground">Color</label>
        <div class="flex flex-wrap gap-2.5">
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
              [attr.aria-label]="'Select color ' + c"
              [attr.aria-current]="color() === c ? 'true' : undefined"
            ></button>
          }
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2.5 select-none">
        <button
          type="button"
          class="rounded-xl border border-border/50 bg-secondary/35 px-5 py-2.5 text-xs font-bold text-foreground/90 transition-all duration-200 hover:bg-secondary/75 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          [disabled]="saving()"
          (click)="cancel.emit()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-300 hover:bg-primary/95 disabled:opacity-40 disabled:pointer-events-none shadow-md shadow-primary/20 active:scale-[0.98] cursor-pointer"
          (click)="save()"
          [disabled]="!name().trim() || saving()"
        >
          {{ saving() ? 'Saving…' : (project() ? 'Save' : 'Create') }}
        </button>
      </div>
    </div>
  `,
})
export class ProjectFormDialogComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  project = input<Project | null>(null);

  saveProject = output<{ name: string; description: string; color: string }>();
  cancel = output<void>();

  readonly colors = COLOR_PRESETS;

  name = signal('');
  description = signal('');
  color = signal<string>(DEFAULT_COLOR);

  /** Guards against double-submitted creates/updates. Reset shortly after the
   *  emit because the output has no completion signal; on success the parent
   *  unmounts this dialog, on failure the form unlocks again. */
  readonly saving = signal(false);
  private savingResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.savingResetTimer) clearTimeout(this.savingResetTimer);
    });
  }

  ngOnInit(): void {
    const p = this.project();
    if (p) {
      this.name.set(p.name);
      this.description.set(p.description || '');
      this.color.set(p.color || DEFAULT_COLOR);
    }
  }

  ngAfterViewInit(): void {
    // The form is created on open, so focusing here reliably targets the name.
    this.nameInput()?.nativeElement.focus();
  }

  save(): void {
    if (!this.name().trim() || this.saving()) return;
    this.saving.set(true);
    this.saveProject.emit({
      name: this.name().trim(),
      description: this.description().trim(),
      color: this.color(),
    });

    if (this.savingResetTimer) clearTimeout(this.savingResetTimer);
    this.savingResetTimer = setTimeout(() => {
      this.savingResetTimer = null;
      this.saving.set(false);
    }, 1500);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    if (this.saving()) return;
    this.cancel.emit();
  }

  onEscape(): void {
    if (this.saving()) return;
    this.cancel.emit();
  }
}
