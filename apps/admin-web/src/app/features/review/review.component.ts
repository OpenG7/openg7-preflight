import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { Batch, Data, Page, Proposal, json } from '../../core/models';

@Component({selector: 'app-review', standalone: true, imports: [DatePipe], templateUrl: './review.component.html'})
export class ReviewComponent {
  readonly api = inject(ApiService);
  readonly proposals = signal<Proposal[]>([]);
  readonly batches = signal<Batch[]>([]);
  readonly batch = signal<Batch | null>(null);
  readonly selected = signal<Set<string>>(new Set());
  readonly loading = signal(false); readonly busy = signal(false);
  readonly error = signal(''); readonly info = signal('');
  readonly total = signal(0); readonly json = json;
  page = 1; readonly pageSize = 20;
  constructor() { effect(() => { this.api.revision(); void this.load(); }); }
  async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [proposals, batches] = await Promise.all([
        this.api.get<Page<Proposal>>('/proposals', {page: this.page, pageSize: this.pageSize}),
        this.api.get<Page<Batch> | Batch[]>('/review-batches'),
      ]);
      this.proposals.set(proposals.items); this.total.set(proposals.total);
      this.batches.set(Array.isArray(batches) ? batches : batches.items);
      this.selected.set(new Set());
    } catch (error) { this.error.set(this.api.message(error)); }
    finally { this.loading.set(false); }
  }
  toggle(id: string): void { this.selected.update(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  isReady(proposal: Proposal): boolean { return proposal.status === 'prepared'; }
  async createBatch(): Promise<void> {
    this.busy.set(true); this.error.set(''); this.info.set('');
    try {
      const batch = await this.api.post<Batch>('/review-batches', {proposalIds: [...this.selected()]});
      await this.load(); this.batch.set(batch); this.info.set('Lot préparé. Chaque dossier reste à confirmer dans l’application qui détient l’autorité.');
    } catch (error) { this.error.set(this.api.message(error)); }
    finally { this.busy.set(false); }
  }
  async openBatch(batch: Batch): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.batch.set(await this.api.get<Batch>(`/review-batches/${encodeURIComponent(batch.id)}`)); }
    catch (error) { this.error.set(this.api.message(error)); }
    finally { this.busy.set(false); }
  }
  async exclude(item: Data): Promise<void> {
    const batch = this.batch(); if (!batch || !window.confirm('Exclure ce dossier du lot préparé ? La sélection sera versionnée.')) return;
    this.busy.set(true); this.error.set('');
    try {
      await this.api.post(`/review-batches/${encodeURIComponent(batch.id)}/exclude`, {proposalId: String(item['proposalId']), version: batch.version});
      await this.openBatch(batch);
    } catch (error) { this.error.set(this.api.message(error)); }
    finally { this.busy.set(false); }
  }
  async exportBatch(): Promise<void> {
    const batch = this.batch(); if (!batch) return;
    this.busy.set(true); this.error.set('');
    try {
      const data = await this.api.post<unknown>(`/review-batches/${encodeURIComponent(batch.id)}/export`, {version: batch.version});
      const url = URL.createObjectURL(new Blob([json(data)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `preflight-lot-${batch.id}-v${batch.version}.json`; link.click(); URL.revokeObjectURL(url);
      this.info.set('Lot exporté pour transmission. Aucune décision métier n’a été prise.');
    } catch (error) { this.error.set(this.api.message(error)); }
    finally { this.busy.set(false); }
  }
  async navigate(direction: number): Promise<void> { this.page += direction; await this.load(); }
  containsBlocked(batch: Batch): boolean { return batch.items?.some(item => !item['excluded'] && Boolean(item['blocked'])) ?? false; }
  explanations(proposal: Proposal): string { const text = proposal['explanations']; return Array.isArray(text) ? text.map(String).join(' ') : String(text ?? proposal.explanation ?? 'Consulter les contrôles et résultats préparés.'); }
}
