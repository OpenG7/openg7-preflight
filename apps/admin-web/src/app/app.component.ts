import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './core/api.service';
import { BriefingComponent } from './features/briefing/briefing.component';
import { MissionsComponent } from './features/missions/missions.component';
import { ReviewComponent } from './features/review/review.component';
import { SettingsComponent } from './features/settings/settings.component';
import { BrowserOidcClient, type BrowserOidcConfig } from './core/oidc-client';

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
  readonly reauthenticationRequired = signal<'mfa'|'password'|undefined>(undefined);
  token = '';
  readonly ssoAvailable=signal(false);
  private oidc?:BrowserOidcClient;
  readonly nav: {id: View; title: string; icon: string}[] = [
    {id: 'briefing', title: 'Briefing de relève', icon: '◈'},
    {id: 'missions', title: 'Missions', icon: '▤'},
    {id: 'reviews', title: 'Propositions & lots', icon: '◇'},
    {id: 'supervision', title: 'Traitements', icon: '≋'},
    {id: 'integrations', title: 'Applications', icon: '⊞'},
    {id: 'policies', title: 'Politiques & audit', icon: '◎'},
  ];
  constructor() { void this.initialize(); }
  private async initialize():Promise<void>{
    try{
      const response=await fetch('/api/auth/config',{cache:'no-store'});
      if(!response.ok&&response.status!==404)throw new Error('auth_configuration_unavailable');
      // The metadata endpoint is an optional capability during a rolling upgrade.
      const config=response.status===404?{enabled:false}:await response.json() as BrowserOidcConfig;
      this.ssoAvailable.set(config.enabled===true);
      this.oidc=new BrowserOidcClient(config,{storage:sessionStorage,currentUrl:()=>new URL(location.href),redirect:url=>location.assign(url),cleanCallback:()=>history.replaceState(null,'',location.pathname)});
      const token=await this.oidc.resume();if(token)this.api.setToken(token);
      await this.connect(!token);
    }catch{this.authError.set('La connexion n’a pas abouti. Relancez-la depuis cette console.');this.authOpen.set(true);}
  }
  async loginSso():Promise<void>{
    this.authBusy.set(true);this.authError.set('');
    try{await this.oidc?.begin({reauthenticate:this.reauthenticationRequired()!==undefined});}catch{this.authError.set('La connexion OpenG7 est indisponible. Vérifiez la configuration du fournisseur d’identité.');this.authBusy.set(false);}
  }
  ssoLoginLabel():string{
    if(this.reauthenticationRequired()==='mfa')return 'Se reconnecter avec MFA';
    return this.reauthenticationRequired()==='password'?'Se reconnecter avec OpenG7':'Se connecter avec OpenG7';
  }
  title(): string { return this.nav.find(item => item.id === this.active())?.title ?? 'Preflight'; }
  async connect(automaticLogin=false): Promise<void> {
    this.authBusy.set(true); this.authError.set('');
    try { await this.api.authenticate(); this.oidc?.sessionEstablished(); this.reauthenticationRequired.set(undefined); this.authOpen.set(false); this.token = ''; }
    catch (error) {
      const assurance=error instanceof HttpErrorResponse&&error.status===403?error.error?.error:undefined;
      this.reauthenticationRequired.set(assurance==='mfa_required'?'mfa':assurance==='password_required'?'password':undefined);
      if(automaticLogin&&error instanceof HttpErrorResponse&&error.status===401){
        try{if(await this.oidc?.beginAutomatically())return;}
        catch{this.authError.set('La connexion OpenG7 est indisponible. Relancez-la depuis cette console.');this.authOpen.set(true);return;}
      }
      this.authError.set(this.api.message(error)); this.authOpen.set(true);
    }
    finally { this.authBusy.set(false); }
  }
  async login(): Promise<void> { this.api.setToken(this.token); await this.connect(); }
  logout(): void { this.oidc?.suspendAutomaticLogin(); this.api.clearToken(); this.authError.set(''); this.authOpen.set(true); }
}
