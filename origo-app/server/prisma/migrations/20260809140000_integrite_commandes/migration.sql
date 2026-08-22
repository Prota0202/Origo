-- Intégrité des commandes et du stock.

-- 1. Quantité commandée à l'origine.
-- Elle n'existait pas : la livraison partielle écrasait quantiteCartons et
-- rangeait la quantité d'origine dans le libellé produit (« … (cmd 10) »).
-- Sans cette colonne, rouvrir une commande livrée corrompt stock et total.
ALTER TABLE "OrderItem" ADD COLUMN "quantiteCommandee" INTEGER;

-- Reprise de l'existant : à défaut d'historique, la quantité facturée
-- est la meilleure approximation de la quantité commandée.
UPDATE "OrderItem"
SET "quantiteCommandee" = "quantiteCartons"
WHERE "quantiteCommandee" IS NULL;

-- 2. Filet de sécurité : un stock négatif n'a aucun sens physique et
-- révèle une écriture concurrente perdue. On refuse au niveau base,
-- pour ne pas dépendre uniquement du code applicatif.
-- Remise à zéro préalable, sinon la contrainte ne peut pas s'appliquer
-- sur une base déjà corrompue.
UPDATE "Product" SET "stock" = 0 WHERE "stock" < 0;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_stock_positif" CHECK ("stock" >= 0);
