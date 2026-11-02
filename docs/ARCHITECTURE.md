# Architecture du template OpenG7

## Responsabilité

Ce dépôt possède le standard commun, ses budgets et son mécanisme de propagation.
Il fournit une structure adaptable aux missions OpenG7, sans application ni stack
imposée. Les règles d’exécution sont dans [AGENTS.md](../AGENTS.md).

## Propriété des documents

- [Socle](standards/agent-common.md) : source du bloc identique de chaque AGENTS racine.
- [Standard](standards/README.md) : organisation, budgets, contrôle et synchronisation.
- Mission, architecture et lectures conditionnelles : propriété de chaque projet.
- Instructions d’outil et skills : pointeurs locaux; aucune copie de registres produit.
- Registres, schémas, APIs, runbooks : références du dépôt qui les implémente.

## Propagation

La direction est template → bloc commun et fichiers explicitement gérés.
Le [manifest](../scripts/sync-manifest.json) exclut les architectures, missions,
workflows applicatifs, instructions spécialisées et skills des projets.
Le synchroniseur valide toutes les préconditions avant écriture; il exige les
marqueurs du bloc, refuse chemins sortants et liens symboliques, et conserve
à l’octet près le texte local hors bloc. Les modes check/dry-run ne mutent rien.

Chaque dépôt reste utilisable seul. Le contrôle local compare le bloc à sa copie
du socle; le contrôle de synchronisation détecte la dérive par rapport au template.
La revue vérifie le périmètre métier, que le contrôle textuel ne peut pas prouver.
