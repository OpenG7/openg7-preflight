import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {providers: [provideHttpClient(), provideRouter([])]})
  .catch(() => { document.body.textContent = 'La console n’a pas pu démarrer. Rechargez la page ou consultez le diagnostic.'; });
