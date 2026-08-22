-- Trait manuscrit du client, stocké comme les photos de livraison (fichier, pas base64).

ALTER TABLE "Order" ADD COLUMN "signatureImageUrl" TEXT;
