-- AlterTable
-- `startMonth` nasce sem default porque toda conta NOVA sempre recebe a
-- competência em que foi criada (definido pela aplicação). Para as contas já
-- existentes, usamos a competência de criação (`createdAt`) como aproximação
-- razoável do início da vigência.
ALTER TABLE "bills" ADD COLUMN     "startMonth" DATE,
ADD COLUMN     "totalInstallments" INTEGER;

UPDATE "bills" SET "startMonth" = date_trunc('month', "createdAt")::date WHERE "startMonth" IS NULL;

ALTER TABLE "bills" ALTER COLUMN "startMonth" SET NOT NULL;
