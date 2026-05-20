import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-time-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-bold text-foreground tracking-tight select-none">Today's Time Entries</h2>
      <button
        class="inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-secondary/35 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-foreground/90 transition-all duration-200 hover:bg-secondary/75 cursor-pointer"
        (click)="addManualEntry.emit()"
      >
        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Entry
      </button>
    </div>

    @if (entries().length === 0) {
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/20 py-12 w-full max-w-md mx-auto select-none">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted/30 mb-4 text-muted-foreground/60">
          <svg class="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-sm font-semibold text-foreground/80">No time entries today</p>
        <p class="mt-1 text-xs text-muted-foreground/60 text-center px-6 mb-4">Start a timer or add an entry manually</p>
        <button
          class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 cursor-pointer"
          (click)="addManualEntry.emit()"
        >
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Manual Entry
        </button>
      </div>
    } @else {
      <div class="overflow-hidden rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b border-border/40 bg-muted/40 text-muted-foreground">
                <th class="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Issue</th>
                <th class="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Start</th>
                <th class="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">End</th>
                <th class="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Duration</th>
                <th class="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Note</th>
                <th class="px-5 py-3.5 text-right text-[11px] font-bold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/30">
              @for (entry of entries(); track entry.id) {
                <tr class="transition-colors hover:bg-secondary/45 text-foreground/90">
                  <td class="px-5 py-4 text-sm font-semibold text-foreground/95">
                    {{ getIssueName(entry.issueId) }}
                  </td>
                  <td class="px-5 py-4 text-sm font-mono text-muted-foreground">{{ entry.startTime }}</td>
                  <td class="px-5 py-4 text-sm font-mono text-muted-foreground">{{ entry.endTime ?? '—' }}</td>
                  <td class="px-5 py-4 text-sm font-mono font-bold text-primary">
                    {{ formatDuration(entry) }}
                  </td>
                  <td class="max-w-48 truncate px-5 py-4 text-sm text-muted-foreground">
                    {{ entry.note || '—' }}
                  </td>
                  <td class="px-5 py-4 text-right flex justify-end gap-1">
                    <button
                      class="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/20 hover:text-primary transition-all duration-200 cursor-pointer"
                      (click)="editEntry.emit(entry)"
                      title="Edit entry"
                      aria-label="Edit entry"
                    >
                      <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      class="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/20 hover:text-red-500 transition-all duration-200 cursor-pointer"
                      (click)="deleteEntry.emit(entry.id)"
                      title="Delete entry"
                      aria-label="Delete entry"
                    >
                      <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class TimeEntryListComponent {
  entries = input.required<TimeEntry[]>();
  issues = input<Issue[]>([]);

  deleteEntry = output<string>();
  editEntry = output<TimeEntry>();
  addManualEntry = output<void>();

  getIssueName(issueId: string): string {
    const issue = this.issues().find((i) => i.id === issueId);
    if (!issue) return issueId.slice(0, 8);
    return issue.jiraIssueKey ? `${issue.jiraIssueKey} ${issue.title}` : issue.title;
  }

  formatDuration(entry: TimeEntry): string {
    if (!entry.endTime) return '—';
    const [startH, startM] = entry.startTime.split(':').map(Number);
    const [endH, endM] = entry.endTime.split(':').map(Number);
    const diffMin = endH * 60 + endM - (startH * 60 + startM);
    if (diffMin <= 0) return '< 1m';
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
}
