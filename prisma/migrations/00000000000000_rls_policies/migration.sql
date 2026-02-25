-- Enable RLS on all tenant-scoped tables
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccessArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Admin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY tenant_isolation ON "Device"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "Ticket"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "Scan"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "AccessArea"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "ApiConfig"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "Admin"
  FOR ALL USING ("accountId" = current_setting('app.current_tenant_id', TRUE)::int);

CREATE POLICY tenant_isolation ON "Account"
  FOR ALL USING ("id" = current_setting('app.current_tenant_id', TRUE)::int);
