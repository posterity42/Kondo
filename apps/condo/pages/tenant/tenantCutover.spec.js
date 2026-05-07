const fs = require('fs')
const path = require('path')

const appRoot = path.resolve(__dirname, '../..')

function readAppFile (relativePath) {
    return fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
}

describe('tenant-first rental cutover', () => {
    test('primary navigation exposes tenants and tenancies without contacts or occupancies', () => {
        const app = readAppFile('pages/_app.tsx')

        expect(app).toContain('label: \'Tenants\'')
        expect(app).toContain('path: \'tenant\'')
        expect(app).toContain('label: \'Tenancies\'')
        expect(app).toContain('path: \'tenancy\'')
        expect(app).toContain('label: \'Units / Rooms / Beds\'')
        expect(app).not.toContain('path: \'contact\'')
        expect(app).not.toContain('label: \'global.section.contacts\'')
        expect(app).not.toContain('label: \'Occupancies\'')
    })

    test('tenant list has the authorized add tenant action and operator columns', () => {
        const tenantList = readAppFile('pages/tenant/index.tsx')

        expect(tenantList).toContain('canManageResidents')
        expect(tenantList).toContain('Add Tenant')
        expect(tenantList).toContain('title: \'Tenant\'')
        expect(tenantList).toContain('title: \'Phone\'')
        expect(tenantList).toContain('title: \'Property\'')
        expect(tenantList).toContain('title: \'Unit / Room / Bed\'')
        expect(tenantList).toContain('title: \'Tenancy Status\'')
        expect(tenantList).toContain('title: \'Balance\'')
    })

    test('tenant creation does not create or require contacts', () => {
        const createTenantPage = readAppFile('pages/tenant/create.tsx')
        const createTenantService = readAppFile('domains/resident/schema/CreateAdminTenantProfileService.js')

        expect(createTenantPage).toContain('createAdminTenantProfile')
        expect(createTenantPage).not.toContain('/contact')
        expect(createTenantService).not.toContain('find(\'Contact\'')
        expect(createTenantService).not.toContain('Contact.create')
    })

    test('tenant detail can create tenancy and exposes required sections', () => {
        const tenantDetail = readAppFile('pages/tenant/[id]/index.tsx')

        expect(tenantDetail).toContain('Create Tenancy')
        expect(tenantDetail).toContain('/tenancy/check-in?tenantId=')
        for (const section of ['Profile', 'Tenancy', 'Recent Rent Charges', 'Recent Payments', 'Ledger', 'Maintenance', 'Documents']) {
            expect(tenantDetail).toContain(section)
        }
        expect(tenantDetail).not.toContain('Occupancy statement')
    })

    test('billing and payment surfaces use tenant and tenancy links', () => {
        const paymentList = readAppFile('pages/payment/index.tsx')
        const paymentDetail = readAppFile('pages/payment/[id]/index.tsx')
        const statementPage = readAppFile('domains/property/components/RentalAdmin/StatementPage.tsx')

        expect(paymentList).toContain('label=\'Tenancy\'')
        expect(paymentList).toContain('label=\'Unit / Room / Bed\'')
        expect(paymentDetail).toContain('Tenancy statement')
        expect(paymentDetail).toContain('/tenancy/')
        expect(statementPage).toContain('title: \'Tenancy\'')
        expect(statementPage).toContain('/tenancy/')
        expect(paymentDetail).not.toContain('Occupancy statement')
    })
})
