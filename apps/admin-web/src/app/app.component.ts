import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './core/api.service';
import { BriefingComponent } from './features/briefing/briefing.component';
import { MissionsComponent } from './features/missions/missions.component';
import { ReviewComponent } from './features/review/review.component';
import { SettingsComponent } from './features/settings/settings.component';

type View = 'briefing' | 'missions' | 'reviews' | 'supervision' | 'integrations' | 'policies';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, BriefingComponent, MissionsComponent, ReviewComponent, SettingsComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  readonly api = inject(ApiService);
  readonly active = signal<View>('briefing');
  readonly authOpen = signal(false);
  readonly authError = signal('');
  readonly authBusy = signal(false);
  token = '';
  readonly nav: {id: View; title: string; icon: string}[] = [
    {id: 'briefing', title: 'Briefing de relève', icon: '◈'},
    {id: 'missions', title: 'Missions', icon: '▤'},
    {id: 'reviews', title: 'Propositions & lots', icon: '◇'},
    {id: 'supervision', title: 'Traitements', icon: '≋'},
    {id: 'integrations', title: 'Applications', icon: '⊞'},
    {id: 'policies', title: 'Politiques & audit', icon: '◎'},
  ];
  constructor() { void this.connect(); }
  title(): string { return this.nav.find(item => item.id === this.active())?.title ?? 'Preflight'; }
  async connect(): Promise<void> {
    this.authBusy.set(true); this.authError.set('');
    try { await this.api.authenticate(); this.authOpen.set(false); this.token = ''; }
    catch (error) { this.authError.set(this.api.message(error)); this.authOpen.set(true); }
    finally { this.authBusy.set(false); }
  }
  async login(): Promise<void> { this.api.setToken(this.token); await this.connect(); }
  logout(): void { this.api.clearToken(); this.authOpen.set(true); }
}
