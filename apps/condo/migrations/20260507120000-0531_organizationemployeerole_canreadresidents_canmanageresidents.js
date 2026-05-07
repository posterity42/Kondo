// Hand-written migration: adds canReadResidents and canManageResidents to OrganizationEmployeeRole
// (and history record), aligning the role-permission model with the rental "Tenants" workflow.
// Existing roles get canReadResidents=true (matching canReadProperties default) and
// canManageResidents=false (matching canManageProperties default) so behavior of legacy roles
// is preserved while letting normal employees view tenants in their own organization.

exports.up = async (knex) => {
    await knex.raw(`
    BEGIN;
--
-- Add field canReadResidents to organizationemployeerole
--
ALTER TABLE "OrganizationEmployeeRole" ADD COLUMN IF NOT EXISTS "canReadResidents" boolean DEFAULT true NOT NULL;
ALTER TABLE "OrganizationEmployeeRole" ALTER COLUMN "canReadResidents" SET DEFAULT true;
--
-- Add field canManageResidents to organizationemployeerole
--
ALTER TABLE "OrganizationEmployeeRole" ADD COLUMN IF NOT EXISTS "canManageResidents" boolean DEFAULT false NOT NULL;
ALTER TABLE "OrganizationEmployeeRole" ALTER COLUMN "canManageResidents" SET DEFAULT false;
--
-- Add field canReadResidents to organizationemployeerolehistoryrecord
--
ALTER TABLE "OrganizationEmployeeRoleHistoryRecord" ADD COLUMN IF NOT EXISTS "canReadResidents" boolean NULL;
--
-- Add field canManageResidents to organizationemployeerolehistoryrecord
--
ALTER TABLE "OrganizationEmployeeRoleHistoryRecord" ADD COLUMN IF NOT EXISTS "canManageResidents" boolean NULL;
COMMIT;
    `)
}

exports.down = async (knex) => {
    await knex.raw(`
    BEGIN;
ALTER TABLE "OrganizationEmployeeRoleHistoryRecord" DROP COLUMN IF EXISTS "canManageResidents" CASCADE;
ALTER TABLE "OrganizationEmployeeRoleHistoryRecord" DROP COLUMN IF EXISTS "canReadResidents" CASCADE;
ALTER TABLE "OrganizationEmployeeRole" DROP COLUMN IF EXISTS "canManageResidents" CASCADE;
ALTER TABLE "OrganizationEmployeeRole" DROP COLUMN IF EXISTS "canReadResidents" CASCADE;
COMMIT;
    `)
}
