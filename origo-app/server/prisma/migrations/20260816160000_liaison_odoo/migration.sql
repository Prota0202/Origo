-- Lien ORIGO ↔ Odoo : on stocke les ids distants pour ne pas recréer
-- un produit ou un partenaire à chaque synchro. `odooId` unique empêche
-- deux fiches ORIGO de pointer vers le même enregistrement Odoo.

ALTER TABLE "Client" ADD COLUMN "odooId" INTEGER;
ALTER TABLE "Client" ADD COLUMN "odooTarifId" INTEGER;
CREATE UNIQUE INDEX "Client_odooId_key" ON "Client"("odooId");

ALTER TABLE "Product" ADD COLUMN "odooId" INTEGER;
ALTER TABLE "Product" ADD COLUMN "odooVarianteId" INTEGER;
CREATE UNIQUE INDEX "Product_odooId_key" ON "Product"("odooId");
CREATE UNIQUE INDEX "Product_odooVarianteId_key" ON "Product"("odooVarianteId");
