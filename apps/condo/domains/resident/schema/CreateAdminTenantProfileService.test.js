const { gql } = require('graphql-tag')

const { throwIfError } = require('@open-condo/codegen/generate.test.utils')
const {
    catchErrorFrom,
    expectToThrowAccessDeniedErrorToObj,
    makeLoggedInAdminClient,
} = require('@open-condo/keystone/test.utils')

const { Contact } = require('@condo/domains/contact/utils/testSchema')
const { createTestOrganization, makeEmployeeUserClientWithAbilities } = require('@condo/domains/organization/utils/testSchema')
const { createTestProperty } = require('@condo/domains/property/utils/testSchema')
const { Occupancy } = require('@condo/domains/resident/utils/testSchema')
const { RESIDENT } = require('@condo/domains/user/constants/common')
const { UserAdmin, createTestEmail, createTestPhone } = require('@condo/domains/user/utils/testSchema')

const CREATE_ADMIN_TENANT_PROFILE_MUTATION = gql`
    mutation createAdminTenantProfileForTest ($data: CreateAdminTenantProfileInput!) {
        obj: createAdminTenantProfile(data: $data) {
            id
            property { id }
            currentOccupancy { id }
            user { id name phone email }
            ghanaCardNumber
            emergencyContactName
            emergencyContactPhone
        }
    }
`

async function createAdminTenantProfileByTestClient (client, data) {
    const { data: result, errors } = await client.mutate(CREATE_ADMIN_TENANT_PROFILE_MUTATION, { data })
    throwIfError(result, errors)
    return result.obj
}

describe('CreateAdminTenantProfileService', () => {
    test('creates tenant, resident user, and compatibility contact without occupancy', async () => {
        const admin = await makeLoggedInAdminClient()
        const employeeClient = await makeEmployeeUserClientWithAbilities({ canManageResidents: true })
        const phone = createTestPhone()
        const email = createTestEmail()

        const tenant = await createAdminTenantProfileByTestClient(employeeClient, {
            dv: 1,
            sender: { dv: 1, fingerprint: 'create-admin-tenant' },
            organizationId: employeeClient.organization.id,
            propertyId: employeeClient.property.id,
            name: 'Ama Mensah',
            phone,
            email,
            ghanaCardNumber: 'GHA-123456789-0',
            emergencyContactName: 'Kofi Mensah',
            emergencyContactPhone: createTestPhone(),
        })

        expect(tenant).toMatchObject({
            property: { id: employeeClient.property.id },
            currentOccupancy: null,
            user: {
                id: expect.any(String),
                name: 'Ama Mensah',
                phone,
                email: email.toLowerCase(),
            },
            ghanaCardNumber: 'GHA-123456789-0',
            emergencyContactName: 'Kofi Mensah',
        })

        const [createdUser] = await UserAdmin.getAll(admin, { id: tenant.user.id, deletedAt: null })
        expect(createdUser).toMatchObject({
            id: tenant.user.id,
            type: RESIDENT,
            phone,
            email: email.toLowerCase(),
            isPhoneVerified: false,
            isEmailVerified: false,
        })

        const contacts = await Contact.getAll(admin, {
            organization: { id: employeeClient.organization.id },
            property: { id: employeeClient.property.id },
            phone,
            deletedAt: null,
        })
        expect(contacts).toHaveLength(1)
        expect(contacts[0]).toMatchObject({
            name: 'Ama Mensah',
            phone,
            email: email.toLowerCase(),
            unitName: null,
            unitType: null,
        })

        const occupancies = await Occupancy.getAll(admin, {
            tenant: { id: tenant.id },
            deletedAt: null,
        })
        expect(occupancies).toHaveLength(0)
    })

    test('denies creation without canManageResidents permission', async () => {
        const employeeClient = await makeEmployeeUserClientWithAbilities({ canManageResidents: false })

        await expectToThrowAccessDeniedErrorToObj(async () => {
            await createAdminTenantProfileByTestClient(employeeClient, {
                dv: 1,
                sender: { dv: 1, fingerprint: 'create-admin-tenant' },
                organizationId: employeeClient.organization.id,
                propertyId: employeeClient.property.id,
                name: 'No Access Tenant',
                phone: createTestPhone(),
            })
        })
    })

    test('rejects cross-organization property usage', async () => {
        const admin = await makeLoggedInAdminClient()
        const employeeClient = await makeEmployeeUserClientWithAbilities({ canManageResidents: true })
        const [otherOrganization] = await createTestOrganization(admin)
        const [otherProperty] = await createTestProperty(admin, otherOrganization)

        await catchErrorFrom(async () => {
            await createAdminTenantProfileByTestClient(employeeClient, {
                dv: 1,
                sender: { dv: 1, fingerprint: 'create-admin-tenant' },
                organizationId: employeeClient.organization.id,
                propertyId: otherProperty.id,
                name: 'Wrong Scope Tenant',
                phone: createTestPhone(),
            })
        }, ({ errors, data }) => {
            expect(errors[0].message).toContain('Property not found in the specified organization')
            expect(data).toEqual({ obj: null })
        })
    })

    test('keeps existing uniqueness rules for tenant phone numbers', async () => {
        const admin = await makeLoggedInAdminClient()
        const employeeClient = await makeEmployeeUserClientWithAbilities({ canManageResidents: true })
        const phone = createTestPhone()

        await createAdminTenantProfileByTestClient(employeeClient, {
            dv: 1,
            sender: { dv: 1, fingerprint: 'create-admin-tenant-1' },
            organizationId: employeeClient.organization.id,
            propertyId: employeeClient.property.id,
            name: 'First Tenant',
            phone,
        })

        await catchErrorFrom(async () => {
            await createAdminTenantProfileByTestClient(employeeClient, {
                dv: 1,
                sender: { dv: 1, fingerprint: 'create-admin-tenant-2' },
                organizationId: employeeClient.organization.id,
                propertyId: employeeClient.property.id,
                name: 'Duplicate Tenant',
                phone,
            })
        }, ({ errors, data }) => {
            expect(errors[0].message).toMatch('You attempted to perform an invalid mutation')
            expect(errors[0].data.messages[0]).toContain('user already exists')
            expect(data).toEqual({ obj: null })
        })

        const users = await UserAdmin.getAll(admin, { phone, deletedAt: null })
        expect(users).toHaveLength(1)
    })
})
