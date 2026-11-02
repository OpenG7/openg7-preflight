import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Detail, Mission, Page, Result as PreparationResult, json, label } from '../../core/models';

@Component({selector: 'app-missions', standalone: true, imports: [DatePipe, FormsModule], templateUrl: './missions.component.html'})
export class MissionsComponent {
  readonly api = inject(ApiService);
  readonly supervision = input(false);
  readonly data = signal<Page<Mission> | null>(null);
  readonly detail = signal<Detail | null>(null);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly detailError = signal('');
  readonly label = label; readonly json = json;
  readonly statuses = ['received','planning','ready','running','waiting_input','waiting_dependency','review_ready','completed','failed','cancelled','superseded'];
  q = ''; application = ''; status = ''; page = 1; readonly pageSize = 15;
  inputJson = '{}';
  private request = 0;
  constructor() { effect(() => { this.api.revision(); void this.load(); }); }
  async load(reset = false): Promise<void> {
    if (reset) this.page = 1;
    const request = ++this.request; this.loading.set(true); this.error.set('');
    try {
      const page = await this.api.get<Page<Mission>>('/missions', {page: this.page, pageSize: this.pageSize, q: this.q, application: this.application, status: this.status});
      if (request === this.request) this.data.set(page);
    } catch (error) { if (request === this.request) this.error.set(this.api.message(error)); }
    finally { if (request === this.request) this.loading.set(false); }
  }
  async select(mission: Mission): Promise<void> {
    this.detailLoading.set(true); this.detailError.set(''); this.detail.set(null);
    try { this.detail.set(await this.api.get<Detail>(`/missions/${encodeURIComponent(mission.id)}`)); }
    catch (error) { this.detailError.set(this.api.message(error)); }
    finally { this.detailLoading.set(false); }
  }
  async navigate(direction: number): Promise<void> { this.page += direction; await this.load(); }
  async action(action: 'cancel' | 'retry' | 'input'): Promise<void> {
    const mission = this.detail()?.mission; if (!mission) return;
    const question = action === 'cancel' ? 'Annuler cette préparation ? Les résultats métier ne seront pas modifiés.' : action === 'retry' ? 'Relancer les tâches admissibles de cette mission ?' : 'Transmettre ces informations et reprendre la préparation ?';
    if (!window.confirm(question)) return;
    this.busy.set(true); this.detailError.set('');
    try {
      const body: unknown = action === 'input' ? {input: JSON.parse(this.inputJson)} : {};
      await this.api.post(`/missions/${encodeURIComponent(mission.id)}/${action}`, body);
      await this.select(mission); await this.load();
    } catch (error) { this.detailError.set(error instanceof SyntaxError ? 'Les informations doivent être un objet JSON valide.' : this.api.message(error)); }
    finally { this.busy.set(false); }
  }
  canCancel(status: string): boolean { return !['completed','cancelled','superseded'].includes(status); }
  orderedResults(results: PreparationResult[]): PreparationResult[] { return [...results].sort((a, b) => Number(b.kind === 'draft') - Number(a.kind === 'draft')); }
  resultTitle(kind: string | undefined): string { return ({draft: 'Brouillon préparé', completeness: 'Vérification de complétude', 'preparation-policy': 'Contrôle de la politique', 'output-check': 'Vérification du résultat', 'review-proposal': 'Proposition de revue'} as Record<string, string>)[kind ?? ''] ?? kind ?? 'Résultat'; }
  outputText(result: PreparationResult, field: string): string {
    if (!result.output || typeof result.output !== 'object') return '';
    const value = (result.output as Record<string, unknown>)[field]; return typeof value === 'string' ? value : '';
  }
  outputWarnings(result: PreparationResult): string[] {
    if (!result.output || typeof result.output !== 'object') return [];
    const value = (result.output as Record<string, unknown>)['warnings']; return Array.isArray(value) ? value.filter((warning): warning is string => typeof warning === 'string') : [];
  }
}
