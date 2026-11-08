# Contrats versionnés

Source de vérité : [packages/contracts](../packages/contracts/src/index.ts).
Enveloppes strictes `schemaVersion: "1.0"`; versions inconnues et champs inattendus
sont refusés. Les versions source sont des entiers positifs.

```json
{
  "schemaVersion": "1.0",
  "eventId": "synthetic-activation-1",
  "tenantId": "openg7-demo",
  "source": {
    "application": "funding-platform",
    "subjectType": "sponsorship",
    "subjectId": "synthetic-engagement-1",
    "version": 1
  },
  "workflow": { "type": "sponsorship-preparation-v1", "version": "1.0" },
  "priority": "normal",
  "constraints": { "humanApprovalRequired": true, "maxCostUsd": 0.5 },
  "input": {
    "title": "Atelier synthétique",
    "description": "Présentation à préparer",
    "benefits": ["Brouillon de présentation Web"]
  }
}
```

`missionId` est optionnel; Preflight en génère un si absent. `eventId` déduplique
les livraisons; la clé source/version/workflow évite aussi de refaire une même
préparation. Une clé réutilisée avec un contenu différent est un conflit.
`input` contient uniquement le matériel nécessaire à la préparation.

Social utilise `application: "openg7-social"`, le workflow
`editorial-brief-preparation-v1`, version `1.0`, et `input.topic`.

Les limites par défaut sont 0,50 USD, 30 secondes et 3 tentatives. Les enveloppes
refusent les budgets supérieurs à 100 USD, les délais supérieurs à 120 secondes
et plus de 5 tentatives. Ces plafonds techniques ne remplacent pas une politique
tenant de production. `humanApprovalRequired` reste toujours vrai.

Les événements initiaux sont `mission.submitted` et `source.updated` avec identifiant
unique et version de schéma. Les résultats possèdent une provenance et un schéma
de sortie strict; une réponse IA invalide ne devient pas un résultat de brouillon.

## Proposition éditoriale de commandite

Le workflow `sponsorship-preparation-v1` accepte un `input.editorialContext`
optionnel, strict et versionné `1.0`. Le contrat propriétaire se trouve dans
[editorial.ts](../packages/contracts/src/editorial.ts); les missions v1 sans ce
contexte et le workflow Social restent compatibles.

Le contexte identifie l’engagement, sa version, l’empreinte SHA-256 du snapshot,
le consentement et le nom public autorisé, les faits source nécessaires, les
informations manquantes et les obligations exactes Web/Facebook. Un nom public
sans consentement est refusé. Les coordonnées administratives privées inutiles
ne font pas partie du matériau envoyé au fournisseur. Une absence de consentement
ou d’identité produit une préparation partielle, sans texte public nominatif.

La proposition peut inclure `editorialPreparation`, avec un contenu `common` et
des `variants` par obligation et destination. Son état est `partial` ou
`ready_for_review`; `publicationAuthorized` reste toujours `false`. Les adaptations
sont déterministes à partir du même brouillon validé, sans appel IA supplémentaire.
La provenance fournisseur/modèle/simulation reste celle du résultat référencé.

Les versions internes du contenu commun et des déclinaisons commencent à 1 dans
chaque proposition. Elles ne remplacent ni la révision source monotone, ni la
version d’engagement, ni les versions des brouillons, approbations et publications
Funding. L’import et l’adoption humaine doivent revalider ces références et
préserver les modifications manuelles. Les médias restent sans sélection tant
que leurs droits n’ont pas été qualifiés pour chaque destination.

L’enveloppe mission.submitted contient `schemaVersion`, `eventId`, `type` et
`mission` (le contrat complet ci-dessus). Exemple de notification d’obsolescence :

```json
{
  "schemaVersion": "1.0",
  "eventId": "synthetic-source-update-2",
  "type": "source.updated",
  "tenantId": "openg7-demo",
  "source": {
    "application": "funding-platform",
    "subjectType": "sponsorship",
    "subjectId": "synthetic-engagement-1",
    "version": 2
  }
}
```
