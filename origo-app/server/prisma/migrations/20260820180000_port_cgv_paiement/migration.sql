-- Frais de port, signature CGV, mode de paiement, lien documents Odoo.

ALTER TABLE "Societe" ADD COLUMN "conditionsGenerales" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Client" ADD COLUMN "modePaiement" TEXT NOT NULL DEFAULT 'sepa';

ALTER TABLE "Order" ADD COLUMN "fraisLivraisonHT" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "cgvAccepteesLe" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "signatureNom" TEXT;
ALTER TABLE "Order" ADD COLUMN "odooNom" TEXT;
ALTER TABLE "Order" ADD COLUMN "odooFactureId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "stripeSessionId" TEXT;

CREATE UNIQUE INDEX "Order_odooFactureId_key" ON "Order"("odooFactureId");
