import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-idle-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (visible()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="pointer-events-none absolute inset-0 bg-black/65 backdrop-blur-md"></div>

        <!-- Prompt card -->
        <div
          class="app-card relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto bg-card/95 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-prompt-title"
          aria-describedby="idle-prompt-description"
        >
          <!-- Icon -->
          <div class="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <svg class="size-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>

          <!-- Title -->
          <h2 id="idle-prompt-title" class="mb-2 text-center text-lg font-semibold text-foreground">
            Away From Keyboard
          </h2>

          <!-- Body -->
          <p id="idle-prompt-description" class="mb-6 text-center text-sm text-muted-foreground">
            You were away for
            <strong class="text-foreground">{{ formattedAwayTime() }}</strong>.
            What would you like to do with this time?
          </p>

          <!-- Actions -->
          <div class="flex flex-col gap-2">
            <button
              #firstAction
              type="button"
              class="btn btn-primary w-full"
              (click)="keep.emit()"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Keep this time
            </button>

            <button
              type="button"
              class="btn btn-secondary w-full"
              (click)="discard.emit()"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Discard this time
            </button>

            <button
              type="button"
              class="btn btn-secondary w-full"
              (click)="assign.emit()"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Assign to another issue
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Animations -->
    <style>
      @keyframes idlePromptFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes idlePromptZoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      .animate-in { animation: idlePromptFadeIn 0.2s ease-out; }
      .fade-in { animation-name: idlePromptFadeIn; }
      .zoom-in-95 { animation-name: idlePromptZoomIn; }
    </style>
  `,
})
export class IdlePromptComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly firstAction = viewChild<ElementRef<HTMLButtonElement>>('firstAction');
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the prompt is visible */
  readonly visible = input(false);

  /** Total idle seconds detected */
  readonly idleSeconds = input(0);

  /** Formatted away time for display */
  readonly formattedAwayTime = computed(() => {
    const totalSeconds = this.idleSeconds();
    if (totalSeconds < 60) return `${totalSeconds} seconds`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) {
      const secs = totalSeconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
  });

  /** Keep the idle time in the current timer entry */
  readonly keep = output<void>();

  /** Discard the idle time from the current timer entry */
  readonly discard = output<void>();

  /** Assign the idle time to another issue */
  readonly assign = output<void>();

  constructor() {
    // The prompt requires an explicit decision, so move keyboard focus onto
    // the primary action as soon as it appears.
    effect(() => {
      if (!this.visible()) return;
      if (this.focusTimer) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        this.focusTimer = null;
        if (this.visible()) this.firstAction()?.nativeElement.focus();
      }, 0);
    });

    this.destroyRef.onDestroy(() => {
      if (this.focusTimer) clearTimeout(this.focusTimer);
    });
  }
}
