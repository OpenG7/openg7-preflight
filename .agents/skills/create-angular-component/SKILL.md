---
name: create-angular-component
description: Créer un composant dans un workspace Angular existant selon ses conventions locales; ne s’applique pas à un dépôt de cadrage ou sans Angular.
---

# Composant Angular

Vérifier le manifest et le workspace; lire [AGENTS.md](../../../AGENTS.md) puis
la référence UI du projet. Si Angular est absent, cette procédure ne justifie
pas sa création; suivre le périmètre de la demande.

1. Rechercher un équivalent et définir responsabilité, portée métier et placement.
2. Utiliser les conventions locales pour API typée, état, styles et hooks stables.
3. Prévoir états utiles, i18n, clavier/focus et SSR selon le produit.
4. Mettre à jour registre et tests concernés; exécuter les commandes disponibles.

Atomic Design classe la composition, sans imposer une arborescence globale.
Aucun nom de sélecteur, package ou chemin Nexus n’est universel.
