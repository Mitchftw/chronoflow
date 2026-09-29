import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../services/settings.service';

/**
 * A droplet is a self-contained module that lives in the notch/island: it can
 * contribute a compact "live activity" to the pill and/or a page to the
 * expanded panel. The definition here is only metadata; the views live next
 * to the droplet's own code and are mounted by the island component.
 */
export interface DropletDef {
  id: string;
  name: string;
  description: string;
  /** Built-in droplets can't be switched off (the timer is the core of the app). */
  builtin: boolean;
  defaultEnabled: boolean;
  category: string;
  /** One-line pitch shown on the store card. */
  tagline: string;
  /** Bullet list shown in the detail dialog. */
  features: readonly string[];
}

export const DROPLETS: readonly DropletDef[] = [
  {
    id: 'timer',
    name: 'Timer',
    description: 'Start, stop and switch your time tracking right from the notch.',
    builtin: true,
    defaultEnabled: true,
    category: 'Productivity',
    tagline: 'Track time from the notch',
    features: ['Search issues and start a timer', 'Live elapsed time', 'Stop with a note'],
  },
  {
    id: 'media',
    name: 'Media',
    description: 'Now playing and controls for Spotify, your browser and other players.',
    builtin: false,
    defaultEnabled: false,
    category: 'Media',
    tagline: 'Now playing in your notch',
    features: ['Cover art, title and artist', 'Play, pause, previous and next', 'Works with any player Windows reports'],
  },
  {
    id: 'agents',
    name: 'Agents',
    description:
      'See live Claude Code and Codex progress in your notch: the current tool call, the file being edited and the lines changed, plus your 5-hour and weekly plan limits.',
    builtin: false,
    defaultEnabled: false,
    category: 'AI',
    tagline: 'Live Claude Code & Codex progress in the notch',
    features: [
      'Live coding agent sessions with per-tool activity',
      'Claude Code and Codex CLI usage limits (5-hour and weekly)',
      'Current file, tool call and lines changed',
      'Small notch pill + expanded card',
      'Fully local, reads only your own agent session logs',
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class DropletRegistryService {
  private settings = inject(SettingsService);

  readonly all = DROPLETS;

  isEnabled(id: string): boolean {
    const def = DROPLETS.find((d) => d.id === id);
    if (!def) return false;
    if (def.builtin) return true;
    return this.settings.settings().droplets?.[id] ?? def.defaultEnabled;
  }

  toggle(id: string): void {
    this.settings.update({
      droplets: { ...this.settings.settings().droplets, [id]: !this.isEnabled(id) },
    });
  }
}
