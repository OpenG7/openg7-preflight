---
name: architecture-review
description: Réviser les frontières, dépendances et contrats d’un changement au regard de la mission et de l’architecture du dépôt.
---

# Revue d’architecture

Lire la mission dans [AGENTS.md](../../../AGENTS.md) et les seules frontières
concernées dans [l’architecture](../../../docs/ARCHITECTURE.md).

- Comparer le diff à l’état réel; distinguer implémentation, cible et preuve.
- Vérifier propriétaire métier, sens des dépendances, contrats publics et effets.
- Vérifier droits, données exposées, compatibilité et reprise selon le risque.
- Si une frontière change, mettre à jour sa référence et ses consommateurs.

Rapporter les écarts avec fichier, conséquence et correction; indiquer les limites
de la revue. Ne pas imposer une stack ou une arborescence d’un autre projet.
