import { Component, effect, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Briefing, Data, label } from '../../core/models';

@Component({
  selector: 'app-briefing', standalone: true, imports: [DatePipe, FormsModule],
  templateUrl: './briefing.component.html',
})
export class BriefingComponent {
  readonly api = inject(ApiService);
  readonly openMissions = output<void>();
  readonly openReviews = output<void>();
  readonly data = signal<Briefing | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly label = label;
  application = ''; status = ''; since = '';
  private request = 0;
  constructor() { effect(() => { this.api.revision(); void this.load(); }); }
  async load(): Promise<void> {
    const request = ++this.request; this.loading.set(true); this.error.set('');
    try {
      const data = await this.api.get<Briefing>('/briefing', {application: this.application, status: this.status, since: this.since ? new Date(this.since).toISOString() : undefined});
      if (request === this.request) this.data.set(data);
    } catch (error) { if (request === this.request) this.error.set(this.api.message(error)); }
    finally { if (request === this.request) this.loading.set(false); }
  }
  count(key: string): number { return this.data()?.counts[key] ?? 0; }
  async checkpoint(): Promise<void> {
    try { await this.api.post('/briefing/checkpoint'); await this.load(); }
    catch (error) { this.error.set(this.api.message(error)); }
  }
  fromBeginning(since: string | undefined): boolean { return !since || Date.parse(since) <= 0; }
  recentActivities(activities: Data[] | undefined): Data[] { return (activities ?? []).filter(activity => activity['action'] !== 'task.started').slice(0, 10); }
  activityText(activity: Data): string {
    const action = String(activity['action'] ?? activity['event'] ?? activity['type'] ?? '');
    const data = activity['data'] && typeof activity['data'] === 'object' ? activity['data'] as Data : {};
    if (action === 'mission.transition') {
      const transitions: Record<string, string> = {
        planning: 'Plan de préparation établi', ready: 'Préparation planifiée', running: 'Préparation en cours',
        waiting_input: 'Préparation bloquée : informations manquantes', waiting_dependency: 'Dépendance attendue',
        review_ready: 'Préparation prête pour examen', completed: 'Préparation terminée',
        failed: 'Échec nécessitant une intervention', cancelled: 'Préparation annulée', superseded: 'Nouvelle version source prise en compte',
      };
      return transitions[String(data['to'])] ?? 'État de la préparation mis à jour';
    }
    if (action === 'task.completed') {
      const tasks: Record<string, string> = {
        completeness: 'Informations disponibles vérifiées', 'preparation-policy': 'Politique de préparation vérifiée',
        draft: 'Brouillon préparé', 'output-check': 'Résultat contrôlé', 'review-proposal': 'Proposition de revue préparée',
      };
      return tasks[String(data['kind'])] ?? 'Étape de préparation terminée';
    }
    const actions: Record<string, string> = {
      'mission.received': 'Mission reçue', 'mission.input_provided': 'Informations complémentaires reçues',
      'task.waiting_input': 'Préparation bloquée : informations manquantes', 'task.retry_scheduled': 'Nouvelle tentative programmée',
      'task.quarantined': 'Échec nécessitant une intervention', 'task.started': 'Étape de préparation démarrée',
      'source.decision_reported': 'Décision signalée par l’application source',
    };
    return actions[action] ?? 'Préparation mise à jour';
  }
  activityTime(activity: Data): string { return String(activity['createdAt'] ?? activity['timestamp'] ?? ''); }
  activityMission(activity: Data): string { return String(activity['missionId'] ?? activity['entityId'] ?? ''); }
}
