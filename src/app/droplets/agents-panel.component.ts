import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { AgentsService, type UsageRing } from './agents.service';
import { AgentLogoComponent } from './agent-logo.component';

/** Expanded page of the Agents droplet: plan limits per agent plus live sessions. */
@Component({
  selector: 'app-agents-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgentLogoComponent],
  host: { class: 'block no-drag' },
  template: `
    <div class="flex flex-col gap-2.5">
      <!-- Usage limits -->
      <div class="grid grid-cols-2 gap-2">
        @for (a of cards(); track a.kind) {
          <div class="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2">
            <div class="mb-1.5 flex items-center gap-1.5">
              <app-agent-logo [agent]="a.kind" class="size-3.5" />
              <span class="text-[11px] font-bold text-zinc-100">{{ a.name }}</span>
              @if (a.working) {
                <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              }
            </div>
            @if (a.rings.length) {
              <div class="flex flex-col gap-1.5">
                @for (r of a.rings; track r.label) {
                  <div>
                    <div class="flex items-baseline justify-between text-[9px] leading-none">
                      <span class="font-bold text-zinc-300">{{ r.label }}</span>
                      <span class="tabular-nums text-zinc-500">
                        <span class="font-bold" [class]="text(r.percent)">{{ round(r.percent) }}%</span>
                        · {{ r.resetsInMs === null ? 'reset' : duration(r.resetsInMs) }}
                      </span>
                    </div>
                    <div class="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        class="h-full rounded-full transition-[width] duration-500"
                        [class]="bar(r.percent)"
                        [style.width.%]="r.percent"
                      ></div>
                    </div>
                  </div>
                }
              </div>
            } @else if (a.kind === 'claude') {
              <p class="text-[9px] leading-snug text-zinc-500">
                Limits appear once a <span class="font-semibold text-zinc-400">terminal</span> Claude Code session replies (Pro/Max login).
              </p>
              <button
                class="mt-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 hover:bg-white/10 cursor-pointer"
                (click)="copySetup()"
                title="Only needed if the hook isn't in ~/.claude/settings.json yet"
              >{{ copied() ? 'Copied' : 'Copy hook setup' }}</button>
            } @else {
              <p class="text-[9px] leading-snug text-zinc-500">{{ a.empty }}</p>
            }
          </div>
        }
      </div>

      <!-- Live sessions -->
      @if (agents.sessions().length) {
        <div class="flex flex-col gap-1">
          @for (s of agents.sessions(); track s.id) {
            <div class="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
              <app-agent-logo [agent]="s.agent" class="size-3.5" />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 truncate text-[10px] font-bold leading-tight text-zinc-100">
                  {{ s.project }}
                  @if (s.working) {
                    <span class="size-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse"></span>
                  }
                </p>
                <p class="truncate text-[9px] leading-tight text-zinc-500">
                  <span [class]="s.working ? 'font-semibold text-emerald-300' : ''">{{ s.activity }}</span>
                  @if (s.detail) { <span class="text-zinc-400"> · {{ s.detail }}</span> }
                </p>
              </div>
              <div class="shrink-0 font-mono text-[10px] font-bold tabular-nums">
                <span class="text-emerald-400">+{{ s.added }}</span>
                <span class="ml-1 text-red-400">−{{ s.removed }}</span>
              </div>
            </div>
          }
        </div>
      } @else {
        <p class="px-1 text-[9px] text-zinc-500">No live session. Start Claude Code or Codex and it shows up here.</p>
      }
    </div>
  `,
})
export class AgentsPanelComponent {
  protected agents = inject(AgentsService);
  protected copied = signal(false);

  protected cards = computed(() => {
    const sessions = this.agents.sessions();
    return [
      {
        kind: 'claude' as const,
        name: 'Claude',
        rings: this.agents.claudeRings() as UsageRing[],
        working: sessions.some((s) => s.agent === 'claude' && s.working),
        empty: '',
      },
      {
        kind: 'codex' as const,
        name: 'Codex',
        rings: this.agents.codexRings() as UsageRing[],
        working: this.agents.codexWorking(),
        empty: this.agents.codexAvailable() ? 'No usage yet. Run a prompt.' : 'Codex not found.',
      },
    ];
  });

  /** Copies the settings.json snippet that registers the statusline bridge. */
  async copySetup(): Promise<void> {
    const command = `node "${this.agents.claudeScriptPath()}"`;
    const snippet = JSON.stringify({ statusLine: { type: 'command', command } }, null, 2);
    try {
      await navigator.clipboard.writeText(snippet);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // clipboard unavailable — nothing sensible to fall back to in a 38px notch
    }
  }

  round(n: number): number {
    return Math.round(n);
  }

  bar(percent: number): string {
    if (percent >= 85) return 'bg-red-400';
    if (percent >= 60) return 'bg-amber-400';
    return 'bg-emerald-400';
  }

  text(percent: number): string {
    if (percent >= 85) return 'text-red-400';
    if (percent >= 60) return 'text-amber-400';
    return 'text-emerald-400';
  }

  duration(ms: number): string {
    const mins = Math.max(1, Math.round(ms / 60_000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
