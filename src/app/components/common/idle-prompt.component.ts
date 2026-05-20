import { Component, ChangeDetectionStrategy, input, output, signal, computed, effect } from '@angular/core';

@Component({
  selector: 'app-idle-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (visible()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

        <!-- Prompt card -->
        <div
          class="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-prompt-title"
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
          <p class="mb-6 text-center text-sm text-muted-foreground">
            You were away for
            <strong class="text-foreground">{{ formattedAwayTime() }}</strong>.
            What would you like to do with this time?
          </p>

          <!-- Actions -->
          <div class="flex flex-col gap-2">
            <button
              class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              (click)="keep.emit()"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Keep — Include this time
            </button>

            <button
              class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              (click)="discard.emit()"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Discard — Exclude this time
            </button>

            <button
              class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
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

      <!-- Animations -->
      <style>
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-in { animation: fadeIn 0.2s ease-out; }
        .fade-in { animation-name: fadeIn; }
        .zoom-in-95 { animation-name: zoomIn; }
      </style>
    }
  `,
})
export class IdlePromptComponent {
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
}
