import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

let nextDialogId = 0;

@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    '(document:keydown.escape)': 'onEscape($event)',
    '(document:focusin)': 'onDocumentFocusIn($event)',
  },
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        (click)="onBackdropClick($event)"
      >
        <!-- Backdrop (visual only, so clicks land on the overlay itself) -->
        <div
          class="pointer-events-none absolute inset-0 bg-black/65 backdrop-blur-md transition-opacity duration-300"
        ></div>

        <!-- Dialog panel -->
        <div
          #panel
          tabindex="-1"
          class="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border/45 bg-card/95 p-7 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-300"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="title() ? titleId : null"
          [attr.aria-label]="title() ? null : 'Dialog'"
          [attr.aria-describedby]="bodyId"
          (keydown)="onPanelKeydown($event)"
        >
          <!-- Header -->
          @if (title()) {
            <div class="mb-5 flex items-center justify-between gap-4">
              <h2 [id]="titleId" class="text-xl font-bold tracking-tight text-foreground/95">{{ title() }}</h2>
              @if (closable()) {
                <button
                  #closeButton
                  type="button"
                  class="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-200 cursor-pointer"
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
          <div [id]="bodyId" class="text-sm text-foreground/90">
            <ng-content />
          </div>

          <!-- Actions -->
          @if (showActions()) {
            <div class="mt-7 flex items-center justify-end gap-3 border-t border-border/30 pt-5">
              @if (cancelLabel()) {
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-xl border border-border/50 bg-secondary/35 px-4.5 py-2.5 text-xs font-bold text-foreground/90 transition-all duration-200 hover:bg-secondary/75 cursor-pointer"
                  (click)="closeDialog()"
                >
                  {{ cancelLabel() }}
                </button>
              }
              @if (confirmLabel()) {
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-300 hover:bg-primary/95 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
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

    <!-- Animation styles. Kept outside the @if so a mounted dialog keeps them
         available, and so the class names stay usable by other overlay components. -->
    <style>
      @keyframes dialogFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes dialogZoomIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .animate-in { animation: dialogFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      .fade-in { animation-name: dialogFadeIn; }
      .zoom-in-95 { animation-name: dialogZoomIn; }
    </style>
  `,
})
export class DialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

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

  protected readonly titleId = `dialog-title-${nextDialogId++}`;
  protected readonly bodyId = `dialog-body-${nextDialogId++}`;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  private previouslyFocused: HTMLElement | null = null;
  private lastExternalFocus: HTMLElement | null = null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private wasOpen = false;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.wasOpen = true;
        const active = document.activeElement;
        const captured = active instanceof HTMLElement && active !== document.body ? active : null;
        // An element with [autofocus] may already have received focus while
        // the dialog was being rendered. In that case fall back to the last
        // element focused while this dialog was closed (the trigger).
        this.previouslyFocused =
          captured && !this.host.nativeElement.contains(captured)
            ? captured
            : this.lastExternalFocus;
        this.scheduleInitialFocus();
      } else if (this.wasOpen) {
        this.wasOpen = false;
        this.clearFocusTimer();
        this.restoreFocus();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.clearFocusTimer();
      if (this.wasOpen) {
        this.wasOpen = false;
        this.restoreFocus();
      }
    });
  }

  closeDialog(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.close.emit();
  }

  /** Handle backdrop click — close if closable. Panel clicks must not close. */
  onBackdropClick(event: MouseEvent): void {
    if (!this.closable()) return;
    if (event.target !== event.currentTarget) return;
    this.closeDialog();
  }

  /** Escape closes only an open, closable dialog; otherwise the key is ignored. */
  onEscape(event: KeyboardEvent): void {
    if (!this.isOpen() || !this.closable()) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeDialog();
  }

  /** Remember where focus was before the dialog opened, so it can be restored. */
  onDocumentFocusIn(event: FocusEvent): void {
    if (this.isOpen()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === document.body) return;
    this.lastExternalFocus = target;
  }

  /** Keep Tab focus inside the dialog panel. */
  onPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const focusable = this.getFocusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!(active instanceof HTMLElement) || active === panel || !panel.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private scheduleInitialFocus(): void {
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (!this.isOpen()) return;

      const panel = this.panel()?.nativeElement;
      if (!panel) return;

      const preferred =
        panel.querySelector<HTMLElement>('[autofocus]') ??
        panel.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
        ) ??
        this.closeButton()?.nativeElement ??
        panel;

      preferred.focus();
    }, 0);
  }

  private restoreFocus(): void {
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (target?.isConnected) {
      target.focus();
    }
  }

  private clearFocusTimer(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private getFocusableElements(panel: HTMLElement): HTMLElement[] {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
      (element) =>
        element.tabIndex >= 0 &&
        element.getClientRects().length > 0 &&
        element.getAttribute('aria-hidden') !== 'true',
    );
  }
}
