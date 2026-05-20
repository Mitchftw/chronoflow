import { Component, ChangeDetectionStrategy, inject, computed, OnInit, OnDestroy } from '@angular/core';
import { TimerService } from '../../services/timer.service';
import { SettingsService } from '../../services/settings.service';
import { DatabaseService } from '../../services/database.service';
import { IpcService } from '../../services/ipc.service';
import { DraggableTimerComponent } from './draggable-timer.component';
import { NotchTimerComponent } from './notch-timer.component';
import { type SearchResult } from '../common/search-bar.component';

@Component({
  selector: 'app-timer-window',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DraggableTimerComponent, NotchTimerComponent],
  host: {
    class: 'flex items-start justify-center w-screen h-screen',
    '[style.background]': '"transparent"',
  },
  template: `
    @if (timerMode() === 'notch') {
      <app-notch-timer
        [isRunning]="timer.isRunning()"
        [issueName]="timer.activeIssue()?.title ?? null"
        [formattedTime]="timer.formattedElapsed()"
        [localIssues]="db.issues()"
        (resultSelected)="handleResultSelected($event)"
        (stop)="handleStop()"
        (expand)="handleExpand()"
        (close)="handleClose()"
      />
    } @else {
      <app-draggable-timer
        [isRunning]="timer.isRunning()"
        [issueName]="timer.activeIssue()?.title ?? null"
        [formattedTime]="timer.formattedElapsed()"
        [localIssues]="db.issues()"
        (resultSelected)="handleResultSelected($event)"
        (stop)="handleStop()"
        (close)="handleClose()"
      />
    }
  `,
})
export class TimerWindowComponent implements OnInit, OnDestroy {
  protected timer = inject(TimerService);
  protected db = inject(DatabaseService);
  private settings = inject(SettingsService);
  private ipc = inject(IpcService);

  private cleanup: (() => void) | null = null;

  timerMode = computed(() => this.settings.settings().timerMode);

  ngOnInit(): void {
    // Load local database issues and settings
    this.db.loadAll();

    // Listen for timer state updates pushed from main process
    this.cleanup = this.ipc.onTimerWindowStateUpdate((state) => {
      // State updates are handled by timer.service.ts polling, but we stay synced
    });
  }

  ngOnDestroy(): void {
    this.cleanup?.();
  }

  async handleResultSelected(result: SearchResult): Promise<void> {
    let targetIssueId: string | undefined;

    if (result.type === 'create') {
      const issue = await this.db.createIssue({ title: result.issue.title });
      targetIssueId = issue.id;
    } else if (result.type === 'jira') {
      const existing = this.db.issues().find((i) => i.jiraIssueKey === result.key);
      if (existing) {
        targetIssueId = existing.id;
      } else {
        const issue = await this.db.createIssue({
          title: result.summary,
          jiraIssueKey: result.key,
        });
        targetIssueId = issue.id;
      }
    } else if (result.type === 'local') {
      targetIssueId = result.id;
    }

    if (targetIssueId) {
      await this.timer.start(targetIssueId);
      await this.db.reloadTimeEntries();
    }
  }

  async handleStop(): Promise<void> {
    await this.timer.stop();
  }

  handleExpand(): void {
    // Restore main window and close the timer overlay
    this.ipc.restoreMainWindow();
  }

  async handleClose(): Promise<void> {
    await this.timer.stop();
    await this.ipc.hideTimerWindow();
  }
}
