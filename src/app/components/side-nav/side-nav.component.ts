import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface NavItem {
  route: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-side-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: {
    class: 'flex flex-col h-full bg-card/60 border-r border-border/40 transition-all duration-300 ease-in-out select-none',
    '[class.w-64]': '!collapsed()',
    '[class.w-20]': 'collapsed()',
  },
  template: `
    <!-- Nav items -->
    <div class="flex-1 py-5 px-3 space-y-1.5 overflow-y-auto overflow-x-hidden">
      <div
        class="mb-2 px-3 text-[10px] font-bold text-muted-foreground transition-opacity duration-200"
        [class.opacity-0]="collapsed()"
        [class.opacity-100]="!collapsed()"
      >
        Menu
      </div>

      @for (item of navItems(); track item.route) {
        <a
          [routerLink]="item.route"
          #rla="routerLinkActive"
          routerLinkActive="is-active"
          class="group relative flex items-center w-full gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200"
          [class.justify-center]="collapsed()"
          [class]="rla.isActive
            ? 'bg-primary/12 text-primary font-semibold'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
          [title]="collapsed() ? item.label : ''"
          [attr.aria-current]="rla.isActive ? 'page' : undefined"
        >
          @if (rla.isActive && !collapsed()) {
            <span class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"></span>
          }
          <span
            class="flex shrink-0 items-center justify-center transition-transform duration-200"
            [class.group-hover:scale-110]="!rla.isActive"
          >
            @switch (item.route) {
              @case ('/dashboard') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              }
              @case ('/issues') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              }
              @case ('/backlog') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75Z" />
                </svg>
              }
              @case ('/projects') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              }
              @case ('/timesheets') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              @case ('/vacation') {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.5h16.5v3.75H3.75V4.5zM3.75 9.75h16.5v9.75H3.75V9.75zM8.25 4.5v15M15.75 4.5v15M12 13.5h.008v.008H12v-.008z" />
                </svg>
              }
            }
          </span>
          @if (!collapsed()) {
            <span class="truncate tracking-wide">{{ item.label }}</span>
          }
        </a>
      }
    </div>

    <!-- Settings & collapse footer -->
    <div class="px-3 py-4 border-t border-border/30 space-y-1.5">
      <a
        [routerLink]="'/settings'"
        #settingsRla="routerLinkActive"
        routerLinkActive="is-active"
        class="group relative flex items-center w-full gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200"
        [class.justify-center]="collapsed()"
        [class]="settingsRla.isActive
          ? 'bg-primary/12 text-primary font-semibold'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
        [title]="collapsed() ? 'Settings' : ''"
        [attr.aria-current]="settingsRla.isActive ? 'page' : undefined"
      >
        @if (settingsRla.isActive && !collapsed()) {
          <span class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"></span>
        }
        <svg class="size-5 shrink-0 transition-transform duration-300" [class.group-hover:rotate-45]="!settingsRla.isActive" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        @if (!collapsed()) {
          <span class="truncate tracking-wide">Settings</span>
        }
      </a>

      <button
        (click)="toggleCollapse.emit()"
        class="flex items-center w-full gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-all duration-200 group"
        [class.justify-center]="collapsed()"
        [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
      >
        @if (collapsed()) {
          <svg class="size-5 transition-transform duration-300 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
          </svg>
        } @else {
          <svg class="size-5 transition-transform duration-300 group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
          </svg>
        }
        @if (!collapsed()) {
          <span class="truncate tracking-wide">Collapse</span>
        }
      </button>
    </div>
  `,
})
export class SideNavComponent {
  collapsed = input(false);
  toggleCollapse = output<void>();

  readonly navItems = input<NavItem[]>([
    {
      route: '/dashboard',
      label: 'Dashboard',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>`,
    },
    {
      route: '/issues',
      label: 'Issues',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>`,
    },
    {
      route: '/backlog',
      label: 'Backlog',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75Z" /></svg>`,
    },
    {
      route: '/projects',
      label: 'Projects',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>`,
    },
    {
      route: '/timesheets',
      label: 'Timesheets',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    },
    {
      route: '/vacation',
      label: 'Vacation',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.5h16.5v3.75H3.75V4.5zM3.75 9.75h16.5v9.75H3.75V9.75zM8.25 4.5v15M15.75 4.5v15" /></svg>`,
    },
  ]);
}
