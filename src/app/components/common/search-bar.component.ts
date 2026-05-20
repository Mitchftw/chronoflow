import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  DestroyRef,
  model,
  effect,
} from '@angular/core';
import { JiraService } from '../../services/jira.service';
import { IpcService } from '../../services/ipc.service';
import type { Issue } from '../../models/issue';

/** Jira issue type returned from search */
interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  estimateMinutes?: number;
}

export type SearchResult =
  | {
      type: 'local';
      issue: Issue;
      key: string;
      summary: string;
      id: string;
    }
  | {
      type: 'jira';
      issue: JiraIssue;
      key: string;
      summary: string;
      id?: string;
    }
  | {
      type: 'create';
      issue: { title: string };
      key: string;
      summary: string;
      id?: string;
    };

@Component({
  selector: 'app-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative z-10 select-none w-full h-full' },
  template: `
    <div class="relative w-full h-full flex items-center">
      <!-- Search icon -->
      <div 
        class="pointer-events-none absolute inset-y-0 left-0 flex items-center"
        [class]="variant() === 'default' ? 'pl-3.5 text-muted-foreground/60' : 'pl-2.5 text-zinc-100/80'"
      >
        <svg 
          [class]="variant() === 'default' ? 'size-4.5' : 'size-3.5'" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor" 
          stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <!-- Input -->
      @if (variant() === 'notch') {
        <input
          type="text"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="focused.set(true)"
          (blur)="onBlur()"
          (keydown.escape)="focused.set(false)"
          [placeholder]="placeholder()"
          class="w-full bg-transparent border-none h-[36px] pl-7 pr-7 text-[11px] text-foreground placeholder:text-zinc-100/60 focus:outline-none"
        />
      } @else if (variant() === 'draggable') {
        <input
          type="text"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="focused.set(true)"
          (blur)="onBlur()"
          (keydown.escape)="focused.set(false)"
          [placeholder]="placeholder()"
          class="w-full rounded-xl border border-border/40 bg-zinc-900/60 py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-1.5 focus:ring-primary/40 focus:border-transparent transition-all duration-300"
        />
      } @else {
        <input
          type="text"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="focused.set(true)"
          (blur)="onBlur()"
          (keydown.escape)="focused.set(false)"
          [placeholder]="placeholder()"
          class="w-full rounded-xl border border-border/40 bg-card/65 backdrop-blur-md py-3 pl-11 pr-11 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-sm"
        />
      }

      <!-- Clear button -->
      @if (query()) {
        <button
          class="absolute inset-y-0 right-0 flex items-center text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
          [class]="variant() === 'default' ? 'pr-3.5' : 'pr-2.5'"
          (click)="clear()"
          aria-label="Clear search"
        >
          <svg [class]="variant() === 'default' ? 'size-4' : 'size-3.5'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      }

      <!-- Spinner when searching Jira -->
      @if (searchingJira()) {
        <div 
          class="absolute inset-y-0 right-0 flex items-center"
          [class]="variant() === 'default' ? 'pr-3.5' : 'pr-2.5'"
        >
          <div 
            class="animate-spin rounded-full border-2 border-primary border-t-transparent" 
            [class]="variant() === 'default' ? 'size-4' : 'size-3.5'"
            role="status"
          >
            <span class="sr-only">Searching Jira...</span>
          </div>
        </div>
      }
    </div>

    <!-- Results dropdown -->
    @if (showDropdown()) {
      <div
        class="z-40 overflow-y-auto duration-200"
        [class]="variant() === 'notch' 
          ? 'fixed inset-x-0 top-[42px] max-h-[300px] rounded-b-2xl bg-zinc-900/98 backdrop-blur-xl border-t border-white/10 animate-in fade-in slide-in-from-top-1 px-3 py-2 shadow-2xl shadow-black/50' 
          : variant() === 'draggable'
          ? 'absolute left-0 right-0 top-full mt-2 max-h-60 rounded-xl border border-border/40 bg-zinc-950 shadow-xl animate-in fade-in slide-in-from-top-2 p-1.5'
          : 'absolute left-0 right-0 top-full mt-2 max-h-80 rounded-2xl border border-border/40 bg-card/90 backdrop-blur-lg shadow-2xl animate-in fade-in slide-in-from-top-2 p-1.5'"
      >
        @if (results().length === 0 && !searchingJira()) {
          <div class="px-4 py-8 text-center text-xs font-semibold text-muted-foreground/60 italic">
            @if (query().length >= 2) {
              No results found for "{{ query() }}"
            } @else {
              Type at least 2 characters to search...
            }
          </div>
        } @else {
          @for (group of groupedResults(); track group.label) {
            <!-- Section header -->
            <div 
              class="flex items-center gap-2 font-bold uppercase tracking-widest mt-2 first:mt-0 mb-1 select-none"
              [class]="variant() === 'default' ? 'px-3 py-2 text-[10px] text-muted-foreground/60' : 'px-2 py-1.5 text-[9px] text-zinc-400'"
            >
              <div class="h-px flex-1 bg-white/5"></div>
              {{ group.label }}
              <span class="text-[9px]" [class]="variant() === 'default' ? 'text-muted-foreground/45' : 'text-zinc-500'">({{ group.items.length }})</span>
              <div class="h-px flex-1 bg-white/5"></div>
            </div>

            <!-- Results -->
            <div class="space-y-0.5">
              @for (result of group.items; track result.key) {
                <button
                  class="flex w-full items-center rounded-xl text-left transition-all duration-200 hover:bg-white/5 hover:translate-x-0.5 cursor-pointer"
                  [class]="variant() === 'default' ? 'px-3.5 py-2.5 gap-3 text-sm' : 'px-3 py-2 gap-2.5 text-xs'"
                  (mousedown)="$event.preventDefault(); selectResult(result)"
                >
                  <!-- Type icon -->
                  @if (result.type === 'jira') {
                    <svg 
                      [class]="variant() === 'default' ? 'size-4.5' : 'size-3.5'" 
                      class="shrink-0 text-primary" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor" 
                      stroke-width="2.5"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  } @else {
                    <svg 
                      [class]="(variant() === 'default' ? 'size-4.5 ' : 'size-3.5 ') + (variant() === 'default' ? 'text-muted-foreground/60' : 'text-zinc-100/70')"
                      class="shrink-0" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor" 
                      stroke-width="2.5"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  }

                  <!-- Content -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span 
                        class="font-semibold"
                        [class]="variant() === 'default' ? 'text-xs text-foreground/95' : 'text-[11px] text-white'"
                      >{{ result.key }}</span>
                      @if (result.type === 'jira') {
                        <span class="rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">Jira</span>
                      }
                    </div>
                    <p 
                      class="truncate mt-0.5"
                      [class]="variant() === 'default' ? 'text-xs text-muted-foreground/80' : 'text-[10px] text-zinc-300'"
                    >{{ result.summary }}</p>
                  </div>
                </button>
              }
            </div>
          }
        }
      </div>
    }
  `,
})
export class SearchBarComponent {
  private readonly jiraService = inject(JiraService);
  private readonly ipc = inject(IpcService);
  private readonly destroyRef = inject(DestroyRef);

  /** Design variant */
  readonly variant = input<'default' | 'notch' | 'draggable'>('default');

  /** Placeholder text for the input */
  readonly placeholder = input<string>('Search issues...');

  /** Local issues to search through */
  readonly localIssues = input<Issue[]>([]);

  /** Emitted when a result is selected (clicked) */
  readonly resultSelected = output<SearchResult>();

  /** Emitted when the dropdown visibility changes */
  readonly dropdownVisible = output<boolean>();

  /** Query text */
  readonly query = model('');

  /** Focus state */
  readonly focused = signal(false);

  /** Searching Jira flag */
  readonly searchingJira = signal(false);

  /** Local results (filtered from input) */
  readonly localResults = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.localIssues();
    return this.localIssues().filter(
      (i) =>
        i.title?.toLowerCase().includes(q) ||
        i.jiraIssueKey?.toLowerCase().includes(q),
    );
  });

  /** Jira results */
  readonly jiraResults = signal<JiraIssue[]>([]);

  /** Whether to show the dropdown */
  readonly showDropdown = computed(
    () => this.focused(),
  );

  /** Combined and grouped results */
  readonly results = computed<SearchResult[]>(() => {
    const q = this.query().trim();
    const list: SearchResult[] = [];

    if (q.length >= 2) {
      list.push({
        type: 'create' as any,
        issue: { title: q } as any,
        key: 'NEW',
        summary: `Create & start local task "${q}"`,
      });
    }

    const local: SearchResult[] = this.localResults().map((i) => ({
      type: 'local' as const,
      issue: i,
      key: i.jiraIssueKey ?? i.id,
      summary: i.title,
      id: i.id,
    }));
    const jira: SearchResult[] = this.jiraResults().map((j) => ({
      type: 'jira' as const,
      issue: j,
      key: j.key,
      summary: j.summary,
    }));
    return [...list, ...local, ...jira];
  });

  /** Grouped results for sectioned display */
  readonly groupedResults = computed(() => {
    const groups: Array<{ label: string; items: SearchResult[] }> = [];

    const create = this.results().filter((r) => r.type === ('create' as any));
    if (create.length > 0) {
      groups.push({ label: 'Actions', items: create });
    }

    const local = this.results().filter((r) => r.type === 'local');
    if (local.length > 0) {
      groups.push({ label: 'Local Issues', items: local });
    }

    const jira = this.results().filter((r) => r.type === 'jira');
    if (jira.length > 0) {
      groups.push({ label: 'Jira Issues', items: jira });
    }

    return groups;
  });

  constructor() {
    effect(() => {
      this.dropdownVisible.emit(this.showDropdown());
    });
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);

    // Debounce Jira search
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (value.trim().length >= 2) {
      this.searchingJira.set(true);
      this.debounceTimer = setTimeout(() => this.searchJira(value.trim()), 300);
    } else {
      this.jiraResults.set([]);
      this.searchingJira.set(false);
    }
  }

  onBlur(): void {
    // Delay blur to allow click on dropdown items
    setTimeout(() => this.focused.set(false), 200);
  }

  clear(): void {
    this.query.set('');
    this.jiraResults.set([]);
    this.searchingJira.set(false);
  }

  selectResult(result: SearchResult): void {
    this.resultSelected.emit(result);
    this.focused.set(false);
  }

  private async searchJira(query: string): Promise<void> {
    try {
      // If it looks like a Jira key (e.g. SF-123), make sure it's uppercase
      const normalizedQuery = /^[a-zA-Z]+-\d+$/.test(query) ? query.toUpperCase() : query;
      const issues = await this.jiraService.searchIssues(normalizedQuery);
      this.jiraResults.set(issues);
    } catch (err) {
      console.error('Jira search failed:', err);
      this.jiraResults.set([]);
    } finally {
      this.searchingJira.set(false);
    }
  }
}
