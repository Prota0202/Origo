# Déploiement ORIGO — VPS 24/7

Stack actuelle : **Contabo Cloud VPS 4** (4 vCPU / 8 Go / 100 Go, Ubuntu 24.04).
Caddy (HTTPS) → PWA + API + Postgres. Après un reboot, tout remonte (`restart: unless-stopped`).

**Odoo n’est pas sur ce VPS.** La compta / Peppol reste sur [origo.odoo.com](https://origo.odoo.com)
(`WITH_ODOO=0`). Ne pas lancer Community en parallèle (deux comptabilités).

Les restaurants n’ouvrent **jamais** Odoo. ORIGO reste source de vérité des commandes
tant que la création n’est pas basculée.

## 1. Serveur

Déjà en place : Docker, UFW (22 / 80 / 443), SSH par clé uniquement, fail2ban,
swap 2 Go, dumps quotidiens.

IP : `169.58.188.128`. URL temporaire HTTPS :

`https://169.58.188.128.sslip.io`

`sslip.io` dépend d’un DNS public tiers : OK pour tester et installer la PWA,
**pas** pour un restaurant. Chez EuroDNS (registrar de `origo.be`), ajouter :

| DNS | Type | Valeur |
|---|---|---|
| `commande.origo.be` | A | `169.58.188.128` |
| `commande.origo.be` | AAAA (optionnel) | `2a02:c207:2351:3092::1` |

Puis dans `.env.prod` sur le VPS :

```
SITE_ADDRESS=commande.origo.be
CORS_ORIGIN=https://commande.origo.be
ACME_EMAIL=pro@origo.be
```

et `./scripts/deploy.sh` (Let’s Encrypt prend le certificat).

Depuis le Mac (clé déjà installée) : `ssh origo-vps`.

## 2. Configuration

`.env.prod` n’existe **que** sur le serveur et dans `~/.origo/vps.env.prod` sur le Mac.
Il n’est pas commité. Modèle : `.env.prod.example`.

Premier compte direction : `BOOTSTRAP_ADMIN=1` une fois, puis **remettre à 0**.

## 3. Déployer / mettre à jour

Le dépôt GitHub a longtemps été en retard sur le Mac. Tant que le VPS n’a pas
`git pull` d’un `main` à jour, déployer depuis le Mac :

```bash
cd origo-app
./scripts/sync-vps.sh
```

Après le push GitHub, on pourra cloner / `git pull` dans `/opt/origo` à la place.

Les migrations Prisma passent au démarrage de l’API (`migrate deploy`).

Créer les comptes préparation / livreur / clients depuis l’interface direction
(adresse + téléphone obligatoires pour un restaurant). Les comptes de démo
(`PREPA`, `LIVREUR`, `BOMBAY`, `MARCO`) sont désactivés au boot prod.

## 4. Backups

Un dump gzip **et** une archive des photos (`origo-uploads-*.tar.gz`) par jour
dans `/opt/origo/backups` sur le VPS, rétention 14 jours.

Filets hors du disque applicatif :

1. **Snapshots Contabo** (add-on Auto Backup déjà payé) — image machine, pas un dump applicatif.
2. **Copie sur le Mac** (autre machine) :

```bash
./scripts/pull-backups.sh
```

Tâche LaunchAgent `be.origo.pull-backups` : toutes les 6 h si le Mac est allumé.
Si le Mac est éteint 15 jours, il ne reste que le VPS + le snapshot Contabo.

Un dump qui échoue apparaît sur `GET /api/v1/ready` et le tableau de bord.

```bash
# Restaurer (arrête l'API, restaure, redémarre)
./scripts/restore-db.sh backups/origo-20260809T020000Z.sql.gz
```

## Commandes utiles

```bash
C="docker compose --env-file .env.prod -f docker-compose.prod.yml"
$C ps
$C logs -f api
curl https://169.58.188.128.sslip.io/api/v1/ready
```

## Limites connues (dette assumée)

| Sujet | Risque | Quand traiter |
|-------|--------|---------------|
| URL `sslip.io` | Si ce DNS public tombe, l’app est injoignable | `commande.origo.be` **avant le 1er resto** |
| Mac éteint = pas de 3ᵉ copie des dumps | Perte VPS + snapshot Contabo le même jour | Object Storage / disque distant si le Mac n’est pas une copie fiable |
| Photos sur volume Docker | Volume perdu = photos perdues (archivées dans le tar quotidien) | R2/S3 avant plusieurs clients |
| Liste commandes plafonnée à 500 | L’historique ancien disparaît de l’écran admin | Pagination réelle au volume |
| Google Fonts | Requête vers Google (RGPD) | Self-host Inter/Poppins avant un gros volume |
| Peppol / n° TVA vides | Pas de facture électronique légale BE | Début septembre, mode test Odoo d’abord |
