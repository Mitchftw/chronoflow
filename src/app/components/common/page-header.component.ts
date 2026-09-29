import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * Consistent page title block used across every route. Optional action
 * buttons are projected on the right (kept on the same row on wide screens).
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
  template: `
    <header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="mt-1.5 text-xs font-medium text-muted-foreground">{{ subtitle() }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:justify-end">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
