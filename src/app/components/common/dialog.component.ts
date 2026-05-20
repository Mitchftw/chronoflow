import { Component, ChangeDetectionStrategy, input, output, model, HostBinding } from '@angular/core';

@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
  },
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        (click)="onBackdropClick($event)"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/65 backdrop-blur-md transition-opacity duration-300"
        ></div>

        <!-- Dialog panel -->
        <div
          class="relative z-10 w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-border/45 bg-card/95 backdrop-blur-xl p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-300"
          role="dialog"
          [attr.aria-modal]="true"
          [attr.aria-label]="title()"
        >
          <!-- Header -->
          @if (title()) {
            <div class="mb-5 flex items-center justify-between">
              <h2 class="text-xl font-bold tracking-tight text-foreground/95">{{ title() }}</h2>
              @if (closable()) {
                <button
                  class="flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 hover:bg-secondary/80 hover:text-foreground transition-all duration-200 cursor-pointer"
                  (click)="closeDialog()"
                  aria-label="Close dialog"
                >
                  <svg class="size-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              }
            </div>
          }

          <!-- Body -->
          <div class="text-sm text-foreground/90">
            <ng-content />
          </div>

          <!-- Actions -->
          @if (showActions()) {
            <div class="mt-7 flex items-center justify-end gap-3 border-t border-border/30 pt-5">
              @if (cancelLabel()) {
                <button
                  class="inline-flex items-center justify-center rounded-xl border border-border/50 bg-secondary/35 px-4.5 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground/90 transition-all duration-200 hover:bg-secondary/75 cursor-pointer"
                  (click)="closeDialog()"
                >
                  {{ cancelLabel() }}
                </button>
              }
              @if (confirmLabel()) {
                <button
                  class="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                  [disabled]="confirmDisabled()"
                  (click)="confirm.emit()"
                >
                  {{ confirmLabel() }}
                </button>
              }
            </div>
          }
        </div>
      </div>
    }

    <!-- Animation styles (injected once) -->
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes zoomIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .animate-in { animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      .fade-in { animation-name: fadeIn; }
      .zoom-in-95 { animation-name: zoomIn; }
    </style>
  `,
})
export class DialogComponent {
  /** Whether the dialog is visible */
  readonly isOpen = model(false);

  /** Dialog title */
  readonly title = input<string>('');

  /** Label for the cancel button (hidden if empty) */
  readonly cancelLabel = input<string>('Cancel');

  /** Label for the confirm button (hidden if empty) */
  readonly confirmLabel = input<string>('');

  /** Whether the confirm button is disabled */
  readonly confirmDisabled = input(false);

  /** Whether to show the default action buttons area */
  readonly showActions = input(true);

  /** Whether the dialog can be closed via X button or backdrop click */
  readonly closable = input(true);

  /** Emits when the user confirms */
  readonly confirm = output<void>();

  /** Emits when the user closes/cancels */
  readonly close = output<void>();

  closeDialog(): void {
    this.isOpen.set(false);
    this.close.emit();
  }

  /** Handle backdrop click — close if closable */
  onBackdropClick(event: MouseEvent): void {
    if (this.closable() && (event.target as HTMLElement).classList.contains('fixed')) {
      this.closeDialog();
    }
  }
}
