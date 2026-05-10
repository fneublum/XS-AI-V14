ALTER TABLE commission_sales_contracts ADD COLUMN IF NOT EXISTS "sellerId" UUID;
ALTER TABLE commission_sales_contracts ADD COLUMN IF NOT EXISTS "buyerId" UUID;
