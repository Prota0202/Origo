# Odoo Enterprise pour l'auto-hébergement.
#
# L'image `odoo:19` de Docker Hub est **Community uniquement** : Enterprise n'est
# pas publié publiquement. Le dépôt Enterprise ne contient que des modules
# supplémentaires — le serveur reste celui de la Community, lancé avec les addons
# Enterprise **en premier** dans l'addons_path, sinon Odoo charge la version
# Community des modules qui existent dans les deux.
#
# Prérequis : un compte GitHub rattaché à l'abonnement Odoo, qui donne accès au
# dépôt privé github.com/odoo/enterprise.
#
#   cd origo-app/odoo
#   git clone --branch 19.0 --depth 1 git@github.com:odoo/enterprise.git tmp-ent
#   mv tmp-ent/* enterprise/ && rm -rf tmp-ent
#
# Le dossier `enterprise/` est versionné vide (`.gitkeep`) et son contenu est
# ignoré par git : le code Enterprise est propriétaire, il ne doit jamais entrer
# dans ce dépôt. Tant qu'il est vide, l'image tourne en Community — ce qui permet
# de valider toute la plomberie avant d'avoir l'abonnement.

FROM odoo:19

# addons_path, proxy_mode, workers, désactivation du gestionnaire de bases.
COPY odoo.conf /etc/odoo/odoo.conf

COPY --chown=odoo:odoo enterprise/ /mnt/enterprise-addons/
