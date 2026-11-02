import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { Data, json } from '../../core/models';

interface Integration {application: string; connected: boolean; mode: string; capabilities: string[];}
interface Workflow {type: string; version: string; sourceApplication: string; policy: string; capability: string; requiredInput: string[];}
interface Configuration {schemaVersion: string; policy: string; authMode: string; workflows: Workflow[]; limits?: Record<string, number>; maxBatchSize?: number;}

@Component({
  selector: 'app-settings', standalone: true, imports: [DatePipe],
  template: `
    <section class="page-heading"><div><div class="eyebrow">{{mode() === 'integrations' ? 'CONTRATS & CAPACITÉS' : 'GOUVERNANCE OPÉRATIONNELLE'}}</div><h1>{{mode() === 'integrations' ? 'Applications & intégrations' : 'Politiques & audit'}}<span class="gold">.</span></h1><p>{{mode() === 'integrations' ? 'Une intégration potentielle n’est pas une connexion active.' : 'Versions, limites et contrôles effectivement configurés.'}}</p></div></section>
    @if (error()) { <div class="alert error" role="alert">{{error()}} <button type="button" (click)="load()">Réessayer</button></div> }
    @if (loading()) { <p class="loading" role="status">Chargement de la configuration effective…</p> }
    @if (mode() === 'integrations') {
      <div class="integration-grid">
        @for (integration of integrations(); track integration.application) {
          <article class="panel integration-card"><div class="integration-symbol" aria-hidden="true">⊞</div><span class="tag" [class.gold-tag]="!integration.connected">{{integration.connected ? 'Connectée' : 'Non raccordée'}}</span><h2>{{integration.application}}</h2><p>{{modeLabel(integration.mode)}}</p><h3>Capacités déclarées</h3>@for (capability of integration.capabilities; track capability) { <span class="capability">{{capability}}</span> } @empty { <p class="small muted">Aucune capacité connectée.</p> }</article>
        } @empty { @if (!loading()) { <section class="panel empty-state"><h2>Aucune application visible</h2><p>Les applications autorisées pour votre identité apparaîtront ici.</p></section> } }
      </div>
      <div class="authority-note"><span aria-hidden="true">⊞</span><p>Les workflows de démonstration utilisent des sources logiques identifiées. Ils ne prouvent aucune connexion à Funding Platform ou OpenG7 Social.</p></div>
    } @else if (configuration(); as config) {
      <div class="policy-summary"><article class="panel policy-card"><div class="eyebrow">POLITIQUE</div><h2>{{config.policy}}</h2><p>Préparer des propositions, sans exécuter de décision métier.</p></article><article class="panel policy-card"><div class="eyebrow">CONTRÔLE D’ACCÈS</div><h2>{{config.authMode === 'development' ? 'Identité locale de développement' : 'JWT signé et vérifié'}}</h2><p>Rôles, tenant et applications vérifiés côté serveur.</p></article><article class="panel policy-card"><div class="eyebrow">REVUE COLLECTIVE</div><h2>{{config.limits?.['maxBatchSize'] ?? config.maxBatchSize}} dossiers maximum</h2><p>Sélection versionnée et retrait des propositions obsolètes.</p></article></div>
      <section class="panel section-gap"><div class="panel-heading"><div><div class="eyebrow">DÉFINITIONS VERSIONNÉES</div><h2>Workflows disponibles</h2></div></div>@for (workflow of config.workflows; track workflow.type) { <article class="workflow-definition"><div><h3>{{workflow.type}}</h3><p>{{workflow.sourceApplication}} · version {{workflow.version}}</p></div><dl><dt>Capacité</dt><dd>{{workflow.capability}}</dd><dt>Données requises</dt><dd>{{workflow.requiredInput.join(', ')}}</dd><dt>Politique</dt><dd>{{workflow.policy}}</dd></dl></article> }<details class="configuration-details"><summary>Configuration technique effective</summary><pre>{{json(config)}}</pre></details></section>
      @if (api.canAdminister()) { <section class="panel section-gap"><div class="panel-heading"><div><div class="eyebrow">100 DERNIÈRES OPÉRATIONS AUTORISÉES</div><h2>Journal d’accès et d’interventions</h2></div></div><div class="table-scroll"><table><thead><tr><th>Date</th><th>Opération</th><th>Identité</th><th>Objet</th></tr></thead><tbody>@for (entry of audit(); track $index) { <tr><td>{{asString(entry['createdAt']) | date:'dd/MM/yyyy HH:mm:ss'}}</td><td>{{entry['action']}}</td><td>{{entry['actor']}}</td><td class="mono">{{entry['objectId'] || '—'}}</td></tr> } @empty { <tr><td colspan="4">Aucune opération auditée disponible.</td></tr> }</tbody></table></div></section> }
      <div class="authority-note"><span aria-hidden="true">◎</span><p>Chaque mission expose son historique dans la fiche de détail. Les interventions sont autorisées par rôle, tenant et application source.</p></div>
    }
  `,
})
export class SettingsComponent {
  readonly api = inject(ApiService);
  readonly mode = input<'integrations' | 'policies'>('integrations');
  readonly integrations = signal<Integration[]>([]);
  readonly configuration = signal<Configuration | null>(null);
  readonly audit = signal<Data[]>([]);
  readonly error = signal(''); readonly loading = signal(false); readonly json = json;
  private request = 0;
  constructor() { effect(() => { this.api.revision(); this.mode(); void this.load(); }); }
  async load(): Promise<void> {
    const request = ++this.request; this.loading.set(true); this.error.set('');
    try {
      if (this.mode() === 'integrations') {
        const data = await this.api.get<{items: Integration[]}>('/integrations');
        if (request === this.request) this.integrations.set(data.items);
      } else {
        const [config, audit] = await Promise.all([this.api.get<Configuration>('/config'), this.api.canAdminister() ? this.api.get<{items: Data[]}>('/audit') : Promise.resolve({items: []})]);
        if (request === this.request) { this.configuration.set(config); this.audit.set(audit.items); }
      }
    }
    catch (error) { if (request === this.request) this.error.set(this.api.message(error)); }
    finally { if (request === this.request) this.loading.set(false); }
  }
  asString(value: unknown): string { return typeof value === 'string' ? value : ''; }
  modeLabel(mode: string): string {
    return ({simulator: 'Simulateur de source logique', 'extension-port': 'Interface d’extension disponible', 'not-connected': 'Intégration à définir', 'jwt-contract-only': 'Contrat JWT préparé, identité à raccorder'} as Record<string, string>)[mode] ?? mode;
  }
}
