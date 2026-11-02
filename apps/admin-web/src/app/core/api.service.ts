import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Session } from './models';

@Injectable({providedIn: 'root'})
export class ApiService {
  private readonly http = inject(HttpClient);
  private token = '';
  readonly session = signal<Session | null>(null);
  readonly revision = signal(0);

  setToken(token: string): void { this.token = token.trim(); this.session.set(null); }
  clearToken(): void { this.token = ''; this.session.set(null); this.revision.update(v => v + 1); }
  refresh(): void { this.revision.update(v => v + 1); }
  async authenticate(): Promise<void> { this.session.set(await this.get<Session>('/session')); this.refresh(); }
  canOperate(): boolean { return this.session()?.roles.some(role => role === 'operator' || role === 'administrator') ?? false; }
  canAdminister(): boolean { return this.session()?.roles.includes('administrator') ?? false; }
  get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params = params.set(key, String(value));
    return firstValueFrom(this.http.get<T>(`/api${path}`, {headers: this.headers(), params}));
  }
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`/api${path}`, body, {headers: this.headers()}));
  }
  message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'L’API est injoignable. Vérifiez son démarrage et la connexion.';
      if (error.status === 401) return 'Session requise ou expirée. Connectez-vous avec un jeton valide.';
      if (error.status === 403) return 'Votre rôle ne permet pas cette opération.';
      if (error.status === 429) return 'Trop de requêtes. Patientez avant de recommencer.';
      const body = error.error as {message?: string; error?: string} | null;
      const messages: Record<string, string> = {
        invalid_contract: 'Les paramètres transmis ne respectent pas le contrat attendu.',
        batch_not_homogeneous: 'Ces dossiers ne partagent pas les mêmes critères. Préparez des lots distincts.',
        heterogeneous_batch: 'Ces dossiers ne partagent pas les mêmes critères. Préparez des lots distincts.',
        obsolete_proposal: 'Une proposition est devenue obsolète. Actualisez la liste avant de la regrouper.',
        batch_version_conflict: 'La sélection du lot a changé. Actualisez avant de recommencer.',
        batch_contains_obsolete_proposal: 'Un dossier du lot est devenu obsolète. Actualisez et excluez-le avant de transmettre.',
        mission_not_found: 'Cette mission est introuvable dans votre périmètre autorisé.',
        application_forbidden: 'Cette application ne fait pas partie de votre périmètre autorisé.',
      };
      return body?.message ?? (body?.error ? messages[body.error] ?? (error.status === 409 ? 'Le dossier a changé. Actualisez avant de recommencer.' : `Opération refusée : ${body.error}.`) : `La requête a échoué (${error.status}).`);
    }
    return error instanceof Error ? error.message : 'Une erreur est survenue.';
  }
  private headers(): HttpHeaders { return this.token ? new HttpHeaders({Authorization: `Bearer ${this.token}`}) : new HttpHeaders(); }
}
