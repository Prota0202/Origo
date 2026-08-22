-- Liaison commande ORIGO → sale.order Odoo.
-- Unique sur odooId : deux commandes ORIGO ne doivent pas pointer le même devis.

ALTER TABLE "Order" ADD COLUMN "odooId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "odooSyncStatut" TEXT;
ALTER TABLE "Order" ADD COLUMN "odooSyncErreur" TEXT;
ALTER TABLE "Order" ADD COLUMN "odooSyncLe" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_odooId_key" ON "Order"("odooId");
CREATE INDEX "Order_odooSyncStatut_idx" ON "Order"("odooSyncStatut");
