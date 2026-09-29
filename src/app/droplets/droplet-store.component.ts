import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { DropletRegistryService, type DropletDef } from './droplet-registry.service';

/** Droplet marketplace: browse the available droplets and install/remove them. */
@Component({
  selector: 'app-droplet-store',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      @for (d of registry.all; track d.id) {
        <div
          class="group flex cursor-pointer flex-col gap-3 rounded-xl border border-border/40 bg-background/40 p-4 transition-all duration-300 hover:border-primary/40 hover:bg-background/60"
          role="button"
          tabindex="0"
          (click)="selected.set(d)"
          (keydown.enter)="selected.set(d)"
        >
          <div class="flex items-start gap-3">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-black text-primary">
              {{ d.name.charAt(0) }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-bold text-foreground/95">{{ d.name }}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{{ d.tagline }}</p>
            </div>
          </div>
          <div class="mt-auto flex items-center justify-between gap-2">
            <span class="rounded-md border border-border/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{{ d.category }}</span>
            @if (d.builtin) {
              <span class="text-[11px] font-bold text-muted-foreground">Built in</span>
            } @else {
              <button
                class="rounded-lg px-3 py-1 text-xs font-bold transition-all duration-300 cursor-pointer"
                [class]="registry.isEnabled(d.id)
                  ? 'border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  : 'bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:brightness-110'"
                (click)="$event.stopPropagation(); registry.toggle(d.id)"
              >{{ registry.isEnabled(d.id) ? 'Installed' : 'Install' }}</button>
            }
          </div>
        </div>
      }
    </div>

    @if (selected(); as d) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        (click)="selected.set(null)"
        (keydown.escape)="selected.set(null)"
      >
        <div
          class="w-full max-w-lg rounded-2xl border border-border/40 bg-card p-6 shadow-2xl"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="d.name"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start gap-4">
            <span class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-xl font-black text-primary">
              {{ d.name.charAt(0) }}
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-bold text-foreground">{{ d.name }}</h3>
              <p class="text-xs text-muted-foreground">{{ d.tagline }}</p>
              <div class="mt-2 flex gap-2">
                <span class="rounded-md border border-border/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{{ d.category }}</span>
                <span class="rounded-md border border-border/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">Free</span>
              </div>
            </div>
            <button
              class="rounded-lg p-1 text-muted-foreground hover:bg-secondary/40 hover:text-foreground cursor-pointer"
              aria-label="Close"
              (click)="selected.set(null)"
            >✕</button>
          </div>

          <p class="mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">What it does</p>
          <p class="mt-1 text-sm text-foreground/90">{{ d.description }}</p>

          <p class="mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Features</p>
          <ul class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            @for (f of d.features; track f) {
              <li class="flex gap-2 rounded-lg bg-background/50 px-3 py-2 text-xs text-foreground/90">
                <span class="text-primary">✓</span>{{ f }}
              </li>
            }
          </ul>

          <div class="mt-6 flex items-center justify-between gap-3 rounded-xl bg-background/50 p-3">
            <p class="text-xs text-muted-foreground">
              @if (d.builtin) { Always on — the timer is the core of ChronoFlow. }
              @else if (registry.isEnabled(d.id)) { Installed. It shows up in the notch. }
              @else { Install it and it appears in the notch. }
            </p>
            @if (!d.builtin) {
              <button
                class="shrink-0 rounded-lg px-4 py-1.5 text-xs font-bold transition-all duration-300 cursor-pointer"
                [class]="registry.isEnabled(d.id)
                  ? 'border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  : 'bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:brightness-110'"
                (click)="registry.toggle(d.id)"
              >{{ registry.isEnabled(d.id) ? 'Remove' : 'Install' }}</button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class DropletStoreComponent {
  protected registry = inject(DropletRegistryService);
  protected selected = signal<DropletDef | null>(null);
}
