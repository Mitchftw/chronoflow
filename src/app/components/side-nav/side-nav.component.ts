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
    class: 'flex flex-col h-full bg-card/70 backdrop-blur-xl border-r border-border/40 transition-all duration-300 ease-in-out select-none',
    '[class.w-64]': '!collapsed()',
    '[class.w-16]': 'collapsed()',
  },
  template: `
    <!-- Brand -->
    <div class="flex items-center h-16 px-4 border-b border-border/30">
      <div class="flex items-center gap-3 overflow-hidden">
        <div class="flex-shrink-0 size-8 rounded-xl bg-gradient-to-tr from-primary to-violet-500 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/25">
          <svg class="size-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        @if (!collapsed()) {
          <div class="flex flex-col">
            <span class="font-bold text-sm tracking-tight text-foreground bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">TimeTracker</span>
            <span class="text-[9px] text-primary/80 font-bold uppercase tracking-widest font-sans">Pro Edition</span>
          </div>
        }
      </div>
    </div>

    <!-- Nav items -->
    <div class="flex-1 py-6 px-3 space-y-1.5 overflow-y-auto">
      <div
        class="mb-3 px-2.5 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest transition-opacity duration-200"
        [class.opacity-0]="collapsed()"
        [class.opacity-100]="!collapsed()"
      >
        Main Menu
      </div>
      @for (item of navItems(); track item.route) {
        <a
          [routerLink]="item.route"
          routerLinkActive="bg-primary text-primary-foreground shadow-lg shadow-primary/25 font-semibold"
          #rla="routerLinkActive"
          class="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 group relative"
          [class.justify-center]="collapsed()"
          [class]="rla.isActive ? '' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
          [title]="collapsed() ? item.label : ''"
          [attr.aria-current]="rla.isActive ? 'page' : undefined"
        >
          <span
            class="flex-shrink-0 transition-transform duration-300"
            [class.group-hover:scale-110]="!rla.isActive"
            [innerHTML]="item.icon"
          ></span>
          @if (!collapsed()) {
            <span class="text-sm tracking-wide font-medium whitespace-nowrap">{{ item.label }}</span>
          }
          @if (rla.isActive && !collapsed()) {
            <div class="absolute right-3.5 size-1.5 rounded-full bg-primary-foreground/60"></div>
          }
        </a>
      }
    </div>

    <!-- Settings & collapse footer -->
    <div class="px-3 py-4 border-t border-border/30 bg-muted/10 space-y-1.5">
      <a
        [routerLink]="'/settings'"
        routerLinkActive="bg-primary text-primary-foreground shadow-lg shadow-primary/25 font-semibold"
        #settingsRla="routerLinkActive"
        class="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 group"
        [class.justify-center]="collapsed()"
        [class]="settingsRla.isActive ? '' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
        [title]="collapsed() ? 'Settings' : ''"
        [attr.aria-current]="settingsRla.isActive ? 'page' : undefined"
      >
        <svg class="size-5 flex-shrink-0 transition-transform duration-300" [class.group-hover:rotate-45]="!settingsRla.isActive" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        @if (!collapsed()) {
          <span class="text-sm tracking-wide font-medium">Settings</span>
        }
      </a>

      <button
        (click)="toggleCollapse.emit()"
        class="flex items-center w-full gap-3 px-3 py-2 rounded-xl text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-all duration-300 mt-2 group"
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
          <span class="text-sm tracking-wide font-medium">Collapse</span>
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
      route: '/projects',
      label: 'Projects',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>`,
    },
    {
      route: '/timesheets',
      label: 'Timesheets',
      icon: `<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    },
  ]);
}
