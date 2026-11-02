# Contexte et modules

```mermaid
flowchart LR
  Sources[Applications sources] -->|API authentifiée / événements v1| API[Preflight API]
  Admin[Administratrice] --> UI[Console Angular]
  UI --> API
  API --> PG[(PostgreSQL)]
  Worker[Worker autonome] <--> PG
  Worker --> AI[Port fournisseur IA]
  AI --> Mock[Simulation déterministe explicite]
  AI -. activation et configuration .-> Model[OpenAI Responses]
  API -->|Réponse à consultation des propositions| Sources
  Identity[Identité OIDC / Keycloak non raccordée] -. JWT signé .-> API
```

```mermaid
flowchart TD
  HTTP[apps/api] --> Engine[packages/engine]
  W[apps/worker] --> Engine
  Engine --> Contracts[packages/contracts]
  Engine --> Providers[packages/ai]
  HTTP --> Ports[packages/integrations]
  Providers --> Contracts
  Ports --> Contracts
  Web[apps/admin-web] -->|HTTP DTO JSON| HTTP
  Engine --> Persistence[PostgreSQL + pg-boss]
```

Le serveur et le worker sont indépendants; le serveur ne lance pas les tâches IA.
Le moteur regroupe persistance, planification et orchestration dans des modules
internes d’un seul package pour éviter des packages vides. Seuls ses exports
publics sont consommés par les applications. Aucun accès aux bases métier externes.
