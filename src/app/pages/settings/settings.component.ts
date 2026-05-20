import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
} from "@angular/core";
import {
  SettingsService,
  type TimerMode,
} from "../../services/settings.service";
import { JiraService } from "../../services/jira.service";
import { UpdateService } from "../../services/update.service";
import { IdleDetectionService } from "../../services/idle-detection.service";
import type { JiraConnection } from "../../../types";

@Component({
  selector: "app-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block max-w-2xl" },
  template: `
    <header class="mb-8 select-none">
      <h1 class="text-2xl font-bold tracking-tight text-foreground/95">
        Settings
      </h1>
      <p class="mt-1.5 text-xs font-medium text-muted-foreground/80">
        Configure your application preferences
      </p>
    </header>

    <div class="space-y-6">
      <!-- ═══ Appearance ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-6 shadow-md transition-all duration-300"
      >
        <h2
          class="mb-5 text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20"
        >
          Appearance
        </h2>

        <div class="space-y-5">
          <!-- Theme toggle -->
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <p class="text-sm font-semibold text-foreground/95">Theme</p>
              <p class="text-xs text-muted-foreground/60 mt-0.5">
                Current selection: {{ settings().themePreference }}
              </p>
            </div>
            <div
              class="flex items-center gap-1 rounded-xl border border-border/40 bg-background/50 p-1 self-start sm:self-auto select-none"
            >
              @for (opt of themeOptions; track opt.value) {
                <button
                  class="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer"
                  [class]="
                    settings().themePreference === opt.value
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'text-muted-foreground/80 hover:text-foreground hover:bg-secondary/40'
                  "
                  (click)="setTheme(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          <!-- Timer mode -->
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <p class="text-sm font-semibold text-foreground/95">Timer Mode</p>
              <p class="text-xs text-muted-foreground/60 mt-0.5">
                Choose the display style of the active timer
              </p>
            </div>
            <div
              class="flex items-center gap-1 rounded-xl border border-border/40 bg-background/50 p-1 self-start sm:self-auto select-none"
            >
              @for (mode of timerModeOptions; track mode.value) {
                <button
                  class="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer"
                  [class]="
                    settings().timerMode === mode.value
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'text-muted-foreground/80 hover:text-foreground hover:bg-secondary/40'
                  "
                  (click)="setTimerMode(mode.value)"
                >
                  {{ mode.label }}
                </button>
              }
            </div>
          </div>

          <!-- Round to 15m -->
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <p class="text-sm font-semibold text-foreground/95">
                Round to 15 minutes
              </p>
              <p class="text-xs text-muted-foreground/60 mt-0.5">
                Round time entries up to the nearest 15-minute interval
              </p>
            </div>
            <button
              role="switch"
              [attr.aria-checked]="settings().roundTo15Min"
              (click)="toggleRounding()"
              class="relative inline-flex h-6.5 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              [class]="settings().roundTo15Min ? 'bg-primary' : 'bg-border/60'"
            >
              <span
                class="pointer-events-none inline-block size-5.5 rounded-full bg-white shadow-md ring-0 transition-transform duration-300"
                [class]="
                  settings().roundTo15Min ? 'translate-x-4.5' : 'translate-x-0'
                "
              ></span>
            </button>
          </div>
        </div>
      </section>

      <!-- ═══ Idle Detection ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-6 shadow-md transition-all duration-300"
      >
        <h2
          class="mb-5 text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20"
        >
          Idle Detection
        </h2>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-foreground/95">
              Idle Threshold
            </p>
            <span
              class="rounded-lg bg-secondary/80 px-2 py-0.5 text-xs font-bold text-foreground border border-border/20"
            >
              {{ settings().idleThresholdMinutes }} min
              @if (settings().idleThresholdMinutes === 0) {
                (disabled)
              }
            </span>
          </div>
          <div class="space-y-1.5">
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              [value]="settings().idleThresholdMinutes"
              (input)="setIdleThreshold($any($event.target).valueAsNumber ?? 0)"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-secondary/80 accent-primary"
            />
            <div
              class="flex justify-between text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider"
            >
              <span>Off</span>
              <span>30 min</span>
            </div>
          </div>
          <p class="text-xs text-muted-foreground/60 leading-relaxed mt-2.5">
            After this period of inactivity, you'll be prompted to keep or
            discard the idle time.
          </p>
        </div>
      </section>

      <!-- ═══ Jira Integration ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-6 shadow-md transition-all duration-300"
      >
        <div
          class="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div>
            <h2
              class="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-1 border-b border-border/20 sm:border-none sm:pb-0"
            >
              Jira Integration
            </h2>
            <p class="text-xs text-muted-foreground/60 mt-0.5">
              Manage connections to Atlassian Jira Cloud
            </p>
          </div>
          <button
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer self-start sm:self-auto"
            (click)="toggleConnectionForm()"
          >
            @if (showConnectionForm()) {
              Cancel
            } @else {
              <svg
                class="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Connect Jira
            }
          </button>
        </div>

        <!-- Connection form -->
        @if (showConnectionForm()) {
          <div
            class="mb-5 rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4 shadow-inner"
          >
            <h3 class="text-sm font-bold text-foreground/95">
              {{ editingConnectionId() ? "Edit Connection" : "New Connection" }}
            </h3>

            <!-- Auth Type Select -->
            <div>
              <label
                class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                >Authentication Method</label
              >
              <div
                class="grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 border border-border/20 p-1 select-none"
              >
                <button
                  type="button"
                  class="rounded-lg py-2 text-xs font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer"
                  [class]="
                    formAuthType() === 'api-key'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground/80 hover:text-foreground'
                  "
                  (click)="formAuthType.set('api-key')"
                >
                  API Key
                </button>
                <button
                  type="button"
                  class="rounded-lg py-2 text-xs font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer"
                  [class]="
                    formAuthType() === 'oauth'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground/80 hover:text-foreground'
                  "
                  (click)="formAuthType.set('oauth')"
                >
                  OAuth 2.0 (PKCE)
                </button>
              </div>
            </div>

            <!-- Common Fields -->
            <div>
              <label
                class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                >Connection Name</label
              >
              <input
                type="text"
                [value]="formName()"
                (input)="formName.set($any($event.target).value)"
                placeholder="My Company Jira"
                class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
              />
            </div>

            <!-- API Key Fields -->
            @if (formAuthType() === "api-key") {
              <div>
                <label
                  class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                  >Domain *</label
                >
                <input
                  type="text"
                  [value]="formDomain()"
                  (input)="formDomain.set($any($event.target).value)"
                  placeholder="your-domain.atlassian.net"
                  class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
                />
              </div>

              <div>
                <label
                  class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                  >Email</label
                >
                <input
                  type="email"
                  [value]="formEmail()"
                  (input)="formEmail.set($any($event.target).value)"
                  placeholder="you@example.com"
                  class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
                />
              </div>

              <div>
                <label
                  class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                  >API Token</label
                >
                <input
                  type="password"
                  [value]="formApiToken()"
                  (input)="formApiToken.set($any($event.target).value)"
                  placeholder="Your Jira API token"
                  class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner"
                />
                <p
                  class="mt-1.5 text-[10px] font-semibold text-muted-foreground/50"
                >
                  Generate from
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary hover:underline"
                  >
                    Atlassian API Tokens
                  </a>
                </p>
              </div>
            } @else {
              <!-- OAuth Fields -->
              <div class="space-y-4">
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 disabled:opacity-40 shadow-md shadow-primary/10 active:scale-[0.98] cursor-pointer"
                    [disabled]="testingConnection()"
                    (click)="startJiraOAuth()"
                  >
                    @if (testingConnection() && oauthResources().length === 0) {
                      <div
                        class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                        role="status"
                      ></div>
                    }
                    Authorize with Jira
                  </button>
                  @if (oauthAccessToken()) {
                    <span
                      class="text-xs text-green-600 font-bold flex items-center gap-1"
                    >
                      <svg
                        class="size-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Authorized
                    </span>
                  }
                </div>

                @if (oauthResources().length > 0) {
                  <div>
                    <label
                      class="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground/80"
                      >Select Jira Site *</label
                    >
                    <select
                      [value]="selectedOauthResourceId()"
                      (change)="
                        onOauthResourceChange($any($event.target).value)
                      "
                      class="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-inner cursor-pointer"
                    >
                      <option value="" disabled>-- Select a site --</option>
                      @for (res of oauthResources(); track res.id) {
                        <option [value]="res.id">
                          {{ res.name }} ({{ res.url }})
                        </option>
                      }
                    </select>
                  </div>
                }
              </div>
            }

            <div class="flex items-center gap-2">
              <label
                class="flex items-center gap-2.5 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  [checked]="formIsDefault()"
                  (change)="formIsDefault.set(!formIsDefault())"
                  class="size-4 rounded-md border-border/50 bg-background/50 text-primary focus:ring-primary cursor-pointer"
                />
                <span class="text-xs font-bold text-foreground/80"
                  >Set as default connection</span
                >
              </label>
            </div>

            <div class="flex items-center gap-2.5 pt-2">
              <button
                class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 disabled:opacity-40 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                [disabled]="!isFormValid() || savingConnection()"
                (click)="saveConnection()"
              >
                @if (savingConnection()) {
                  <div
                    class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                    role="status"
                  ></div>
                }
                {{ editingConnectionId() ? "Update" : "Save Connection" }}
              </button>

              @if (formAuthType() === "api-key" && formDomain().trim()) {
                <button
                  class="inline-flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-secondary/35 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground/90 transition-all duration-200 hover:bg-secondary/75 disabled:opacity-40 cursor-pointer"
                  [disabled]="testingConnection()"
                  (click)="testConnection()"
                >
                  @if (testingConnection()) {
                    <div
                      class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                      role="status"
                    ></div>
                  }
                  Test Connection
                </button>
              }
            </div>

            @if (connectionTestResult()) {
              <div
                [class]="
                  connectionTestResult()?.success
                    ? 'rounded-xl p-3.5 text-xs font-semibold bg-green-500/10 text-green-600 border border-green-500/25'
                    : 'rounded-xl p-3.5 text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/25'
                "
              >
                {{
                  connectionTestResult()?.message ??
                    connectionTestResult()?.error
                }}
              </div>
            }
          </div>
        }

        <!-- Connections list -->
        @if (connections().length === 0) {
          <div
            class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 py-10 text-center select-none"
          >
            <svg
              class="mb-3 size-10 text-muted-foreground/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <p class="text-sm font-bold text-foreground/90">
              No Jira connections yet
            </p>
            <p
              class="text-xs text-muted-foreground/60 mt-1 px-6 max-w-sm leading-relaxed"
            >
              Add a connection above to sync your issues and time tracking
              worklogs
            </p>
          </div>
        } @else {
          <div class="space-y-2.5">
            @for (conn of connections(); track conn.id) {
              <div
                class="flex items-center gap-3 rounded-2xl border border-border/30 bg-muted/10 px-4.5 py-4 transition-all duration-300 hover:bg-muted/20"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span
                      class="text-sm font-bold text-foreground/95 truncate"
                      >{{ conn.name || conn.domain }}</span
                    >
                    @if (conn.isDefault) {
                      <span
                        class="rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/20"
                        >Default</span
                      >
                    }
                  </div>
                  <p class="text-xs text-muted-foreground/60 truncate mt-1">
                    @if (conn.authType === "oauth") {
                      OAuth 2.0 · Site ID: {{ conn.domain }}
                    } @else {
                      API Key · {{ conn.domain }}
                    }
                  </p>
                </div>
                <div class="flex items-center gap-1.5 select-none z-10">
                  <button
                    class="flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-90 cursor-pointer"
                    title="Edit"
                    (click)="editConnection(conn)"
                  >
                    <svg
                      class="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    class="flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 transition-all duration-200 hover:bg-red-500/20 hover:text-red-500 active:scale-90 cursor-pointer"
                    title="Delete"
                    (click)="deleteConnection(conn.id)"
                  >
                    <svg
                      class="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </section>

      <!-- ═══ Updates ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-6 shadow-md transition-all duration-300"
      >
        <h2
          class="mb-5 text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20"
        >
          Updates
        </h2>

        <div class="space-y-4">
          <!-- Auto-update toggle -->
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-foreground/95">
                Auto-check for updates
              </p>
              <p class="text-xs text-muted-foreground/60 mt-0.5">
                Automatically check for new versions on startup
              </p>
            </div>
            <button
              role="switch"
              [attr.aria-checked]="settings().autoUpdate"
              (click)="toggleAutoUpdate()"
              class="relative inline-flex h-6.5 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              [class]="settings().autoUpdate ? 'bg-primary' : 'bg-border/60'"
            >
              <span
                class="pointer-events-none inline-block size-5.5 rounded-full bg-white shadow-md ring-0 transition-transform duration-300"
                [class]="
                  settings().autoUpdate ? 'translate-x-4.5' : 'translate-x-0'
                "
              ></span>
            </button>
          </div>

          <!-- Update status -->
          @if (updateService.updateAvailable(); as update) {
            <div class="rounded-xl bg-primary/10 p-4 border border-primary/20">
              <p class="text-sm font-bold text-foreground/95">
                Update available: v{{ update.version }}
              </p>
              @if (update.releaseNotes) {
                <p
                  class="mt-1 text-xs text-muted-foreground/60 leading-relaxed"
                >
                  {{ update.releaseNotes }}
                </p>
              }
            </div>
          }

          @if (updateService.updateDownloaded(); as update) {
            <div
              class="rounded-xl bg-green-500/10 p-4 border border-green-500/20"
            >
              <p class="text-sm font-bold text-green-700 dark:text-green-300">
                Update v{{ update.version }} downloaded
              </p>
              <button
                class="mt-2.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:text-primary/80 cursor-pointer"
                (click)="updateService.quitAndInstall()"
              >
                Restart & Install
              </button>
            </div>
          }
        </div>
      </section>

      <!-- ═══ About ═══ -->
      <section
        class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md p-6 shadow-md transition-all duration-300"
      >
        <h2
          class="mb-5 text-sm font-bold uppercase tracking-widest text-muted-foreground/80 pb-2 border-b border-border/20"
        >
          About
        </h2>

        <div class="space-y-3.5 text-sm select-none">
          <div
            class="flex items-center justify-between border-b border-border/20 pb-2"
          >
            <span class="text-xs font-semibold text-muted-foreground/80"
              >Version</span
            >
            <span class="text-xs font-bold text-foreground/95">0.1.0</span>
          </div>
          <div
            class="flex items-center justify-between border-b border-border/20 pb-2"
          >
            <span class="text-xs font-semibold text-muted-foreground/80"
              >Runtime</span
            >
            <span class="text-xs font-bold text-foreground/95">
              {{ ipcAvailable() ? "Electron" : "Browser" }}
            </span>
          </div>
          @if (jiraService.isConnected()) {
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-muted-foreground/80"
                >Jira Connections</span
              >
              <span class="text-xs font-bold text-foreground/95">{{
                connections().length
              }}</span>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class SettingsComponent {
  readonly settingsService = inject(SettingsService);
  readonly jiraService = inject(JiraService);
  readonly updateService = inject(UpdateService);

  readonly settings = this.settingsService.settings;
  readonly connections = this.jiraService.connections;

  readonly ipcAvailable = computed(() => !!(window as any).electronAPI);

  readonly themeOptions = [
    { value: "light" as const, label: "Light" },
    { value: "dark" as const, label: "Dark" },
    { value: "system" as const, label: "System" },
  ];

  readonly timerModeOptions = [
    { value: "draggable" as const, label: "Draggable" },
    { value: "notch" as const, label: "Notch" },
  ];

  // ── Connection Form State ──

  showConnectionForm = signal(false);
  editingConnectionId = signal<string | null>(null);
  formAuthType = signal<"api-key" | "oauth">("api-key");
  formName = signal("");
  formDomain = signal("");
  formEmail = signal("");
  formApiToken = signal("");
  formIsDefault = signal(false);
  savingConnection = signal(false);
  testingConnection = signal(false);
  connectionTestResult = signal<{
    success: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  // OAuth Site State
  oauthResources = signal<any[]>([]);
  selectedOauthResourceId = signal<string>("");
  oauthAccessToken = signal("");
  oauthRefreshToken = signal("");
  oauthExpiresAt = signal<number | null>(null);

  // ── Theme ──

  setTheme(value: "light" | "dark" | "system"): void {
    this.settingsService.update({ themePreference: value });
  }

  setTimerMode(value: TimerMode): void {
    this.settingsService.update({ timerMode: value });
  }

  setIdleThreshold(minutes: number): void {
    this.settingsService.update({ idleThresholdMinutes: minutes });
  }

  toggleRounding(): void {
    this.settingsService.update({ roundTo15Min: !this.settings().roundTo15Min });
  }

  toggleAutoUpdate(): void {
    this.settingsService.update({ autoUpdate: !this.settings().autoUpdate });
  }

  // ── Connection Form Control ──

  toggleConnectionForm(): void {
    if (this.showConnectionForm()) {
      this.resetConnectionForm();
    } else {
      this.showConnectionForm.set(true);
    }
  }

  isFormValid(): boolean {
    if (this.formAuthType() === "api-key") {
      return !!this.formDomain().trim();
    } else {
      // For OAuth, must have verified resources and selected site ID
      return !!this.oauthAccessToken() && !!this.selectedOauthResourceId();
    }
  }

  // ── Jira Connections ──

  async startJiraOAuth(): Promise<void> {
    const { clientId } = await this.jiraService.getConfig();
    const redirectUri = "chronoflow://oauth-callback";

    this.testingConnection.set(true);
    this.connectionTestResult.set(null);
    this.oauthResources.set([]);
    this.selectedOauthResourceId.set("");

    try {
      // 1. Start OAuth Flow
      const oauthResult = await this.jiraService.startOAuthFlow(
        clientId,
        redirectUri,
      );

      // 2. Exchange Code
      const tokenResult = await this.jiraService.exchangeCode(
        oauthResult.code,
        oauthResult.redirectUri,
        oauthResult.codeVerifier,
        clientId,
        undefined,
      );

      if (!tokenResult.success || !tokenResult.data) {
        throw new Error(
          tokenResult.error || "Failed to exchange authorization code",
        );
      }

      const tokenData = tokenResult.data;
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresAt = Date.now() + tokenData.expires_in * 1000;

      // 3. Retrieve Sites
      const resourceResult =
        await this.jiraService.getAccessibleResources(accessToken);
      if (
        !resourceResult.success ||
        !resourceResult.resources ||
        resourceResult.resources.length === 0
      ) {
        throw new Error(
          resourceResult.error ||
            "No accessible Jira resources found for this account.",
        );
      }

      this.oauthAccessToken.set(accessToken);
      this.oauthRefreshToken.set(refreshToken);
      this.oauthExpiresAt.set(expiresAt);
      this.oauthResources.set(resourceResult.resources);

      // Auto-select first site
      if (resourceResult.resources.length === 1) {
        this.onOauthResourceChange(resourceResult.resources[0].id);
      }

      this.connectionTestResult.set({
        success: true,
        message: "Successfully authorized! Select your site and click Save.",
      });
    } catch (err: any) {
      console.error(err);
      this.connectionTestResult.set({
        success: false,
        error: err.message || "OAuth flow failed or timed out",
      });
    } finally {
      this.testingConnection.set(false);
    }
  }

  onOauthResourceChange(resourceId: string): void {
    const resource = this.oauthResources().find((r) => r.id === resourceId);
    if (resource) {
      this.selectedOauthResourceId.set(resourceId);
      this.formDomain.set(resource.id);
      this.formName.set(resource.name);
    }
  }

  async saveConnection(): Promise<void> {
    const authType = this.formAuthType();
    const domain = this.formDomain().trim();
    if (!domain) return;

    this.savingConnection.set(true);
    try {
      const editId = this.editingConnectionId();
      if (editId) {
        await this.jiraService.updateConnection(editId, {
          name: this.formName().trim() || undefined,
          domain,
          authType,
          email:
            authType === "api-key"
              ? this.formEmail().trim() || undefined
              : undefined,
          apiToken:
            authType === "api-key"
              ? this.formApiToken().trim() || undefined
              : undefined,
          accessToken:
            authType === "oauth"
              ? this.oauthAccessToken() || undefined
              : undefined,
          refreshToken:
            authType === "oauth"
              ? this.oauthRefreshToken() || undefined
              : undefined,
          expiresAt: authType === "oauth" ? this.oauthExpiresAt() : null,
          cloudId: authType === "oauth" ? domain : undefined,
          isDefault: this.formIsDefault(),
        });
      } else {
        await this.jiraService.createConnection({
          name: this.formName().trim() || undefined,
          domain,
          authType,
          email:
            authType === "api-key"
              ? this.formEmail().trim() || undefined
              : undefined,
          apiToken:
            authType === "api-key"
              ? this.formApiToken().trim() || undefined
              : undefined,
          accessToken:
            authType === "oauth"
              ? this.oauthAccessToken() || undefined
              : undefined,
          refreshToken:
            authType === "oauth"
              ? this.oauthRefreshToken() || undefined
              : undefined,
          expiresAt: authType === "oauth" ? this.oauthExpiresAt() : null,
          cloudId: authType === "oauth" ? domain : undefined,
          isDefault: this.formIsDefault(),
        });
      }

      this.resetConnectionForm();
      await this.jiraService.loadConnections();
    } catch (err) {
      console.error("Failed to save connection", err);
    } finally {
      this.savingConnection.set(false);
    }
  }

  async testConnection(): Promise<void> {
    const authType = this.formAuthType();
    const domain = this.formDomain().trim();
    const email = this.formEmail().trim();
    const apiToken = this.formApiToken().trim();
    const accessToken = this.oauthAccessToken();
    const connectionId = this.editingConnectionId() ?? undefined;

    if (!domain) return;

    this.testingConnection.set(true);
    this.connectionTestResult.set(null);

    try {
      const result = await this.jiraService.testConnection({
        connectionId,
        authType,
        domain,
        email,
        apiToken,
        accessToken,
      });
      if (result.success) {
        this.connectionTestResult.set({
          success: true,
          message: `Connection successful for ${result.user?.displayName || "user"} (${result.user?.emailAddress || "no email"})`,
        });
      } else {
        this.connectionTestResult.set(result);
      }
    } catch (err) {
      this.connectionTestResult.set({
        success: false,
        error: "Connection test failed",
      });
    } finally {
      this.testingConnection.set(false);
    }
  }

  editConnection(conn: JiraConnection): void {
    this.editingConnectionId.set(conn.id);
    this.formName.set(conn.name ?? "");
    this.formDomain.set(conn.domain);
    this.formAuthType.set((conn.authType as "api-key" | "oauth") ?? "api-key");
    this.formEmail.set(conn.email ?? "");
    this.formApiToken.set(conn.apiToken ?? "");
    this.oauthAccessToken.set(conn.accessToken ?? "");
    this.oauthRefreshToken.set(conn.refreshToken ?? "");
    this.oauthExpiresAt.set(conn.expiresAt ?? null);
    this.formIsDefault.set(conn.isDefault);

    if (conn.authType === "oauth") {
      // Mock site resource listing if editing an existing connection
      this.oauthResources.set([
        {
          id: conn.domain,
          name: conn.name || "Jira Cloud Site",
          url: "OAuth Connected",
        },
      ]);
      this.selectedOauthResourceId.set(conn.domain);
    }

    this.showConnectionForm.set(true);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.jiraService.deleteConnection(id);
  }

  private resetConnectionForm(): void {
    this.showConnectionForm.set(false);
    this.editingConnectionId.set(null);
    this.formAuthType.set("api-key");
    this.formName.set("");
    this.formDomain.set("");
    this.formEmail.set("");
    this.formApiToken.set("");
    this.formIsDefault.set(false);
    this.connectionTestResult.set(null);
    this.oauthResources.set([]);
    this.selectedOauthResourceId.set("");
    this.oauthAccessToken.set("");
    this.oauthRefreshToken.set("");
    this.oauthExpiresAt.set(null);
  }
}
