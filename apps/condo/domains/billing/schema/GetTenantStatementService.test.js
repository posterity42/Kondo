/* eslint-disable jest/no-disabled-tests */
const { gql } = require('graphql-tag')

const { throwIfError } = require('@open-condo/codegen/generate.test.utils')
const { closeKVClients } = require('@open-condo/keystone/kv')
const { makeLoggedInAdminClient, setFakeClientMode } = require('@open-condo/keystone/test.utils')

const {
    RENT_PAYMENT_METHOD_CASH,
} = require('@condo/domains/acquiring/constants/rentPayment')
const {
    recordManualRentPaymentByTestClient,
    reverseManualRentPaymentByTestClient,
} = require('@condo/domains/acquiring/utils/testSchema')
const { createTestOrganization } = require('@condo/domains/organization/utils/testSchema')
const { makeClientWithRegisteredOrganization } = require('@condo/domains/organization/utils/testSchema/Organization')
const { createTestProperty } = require('@condo/domains/property/utils/testSchema')
const {
    createTestBillingPolicy,
    createTestRentalUnit,
    createTestResident,
} = require('@condo/domains/resident/utils/testSchema')
const { makeClientWithResidentUser } = require('@condo/domains/user/utils/testSchema')

function initTenantStatementSchemaTestMode () {
    try {
        const index = require('@app/condo/index')
        setFakeClientMode(index)

        return { enabled: true, reason: null }
    } catch (error) {
        void closeKVClients()

        return {
            enabled: false,
            reason: [
                'GetTenantStatementService.test.js requires either an in-process Condo Keystone test app',
                'or a prepared schema-test environment.',
                `In-process bootstrap failed: ${error.message}`,
            ].join(' '),
        }
    }
}

const tenantStatementSchemaTestMode = initTenantStatementSchemaTestMode()
const describeTenantStatementService = tenantStatementSchemaTestMode.enabled ? describe : describe.skip

if (!tenantStatementSchemaTestMode.enabled) {
    test.skip(tenantStatementSchemaTestMode.reason, () => {})
}

const GET_TENANT_STATEMENT_QUERY = gql`
    query getTenantStatement ($data: GetTenantStatementInput!) {
        result: getTenantStatement(data: $data) {
            header {
                tenantId
                propertyId
                rentalUnitId
                occupancyId
                currencyCode
            }
            summary {
                totalCharges
                totalPayments
                totalReversals
                totalCreditsAdjustments
                openingBalance
                closingBalance
                outstandingBalance
                runningBalanceAvailable
            }
            rows {
                id
                date
                type
                description
                debit
                credit
                runningBalance
                linkedEntityId
                linkedEntityType
                reference
                status
                occupancyId
                propertyId
                rentalUnitId
            }
        }
    }
`

const CREATE_OCCUPANCY_MUTATION = gql`
    mutation createOccupancyForTenantStatement ($data: OccupancyCreateInput) {
        obj: createOccupancy(data: $data) {
            id
            status
            tenant { id }
            property { id }
            rentalUnit { id }
            organization { id }
        }
    }
`

const UPDATE_OCCUPANCY_MUTATION = gql`
    mutation updateOccupancyForTenantStatement ($id: ID!, $data: OccupancyUpdateInput!) {
        obj: updateOccupancy(id: $id, data: $data) {
            id
            status
            actualEndDate
        }
    }
`

const CREATE_RENT_CHARGE_MUTATION = gql`
    mutation createRentChargeForTenantStatement ($data: RentChargeCreateInput) {
        obj: createRentCharge(data: $data) {
            id
            amount
            billingMonth
            status
            occupancy { id }
            property { id }
            rentalUnit { id }
            tenant { id }
        }
    }
`

const CREATE_TENANT_LEDGER_MUTATION = gql`
    mutation createTenantLedgerForTenantStatement ($data: TenantLedgerCreateInput) {
        obj: createTenantLedger(data: $data) {
            id
            organization { id }
            tenant { id }
            currencyCode
        }
    }
`

const CREATE_LEDGER_ENTRY_MUTATION = gql`
    mutation createLedgerEntryForTenantStatement ($data: LedgerEntryCreateInput) {
        obj: createLedgerEntry(data: $data) {
            id
            amount
            entryType
            direction
            postingStatus
            payment { id }
            rentCharge { id }
        }
    }
`

async function mutate (client, query, variables) {
    const { data, errors } = await client.mutate(query, variables)
    throwIfError(data, errors)

    return data.obj
}

async function createOccupancy (client, organization, resident, property, rentalUnit, extraAttrs = {}) {
    return await mutate(client, CREATE_OCCUPANCY_MUTATION, {
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: `occupancy-${resident.id.slice(0, 8)}` },
            organization: { connect: { id: organization.id } },
            tenant: { connect: { id: resident.id } },
            property: { connect: { id: property.id } },
            rentalUnit: { connect: { id: rentalUnit.id } },
            startDate: '2026-01-01',
            monthlyRate: '100',
            ...extraAttrs,
        },
    })
}

async function updateOccupancy (client, id, extraAttrs = {}) {
    return await mutate(client, UPDATE_OCCUPANCY_MUTATION, {
        id,
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: `occupancy-update-${id.slice(0, 8)}` },
            ...extraAttrs,
        },
    })
}

async function createRentCharge (client, organization, occupancy, billingMonth, amount) {
    return await mutate(client, CREATE_RENT_CHARGE_MUTATION, {
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: `charge-${billingMonth}` },
            organization: { connect: { id: organization.id } },
            occupancy: { connect: { id: occupancy.id } },
            property: { connect: { id: occupancy.property.id } },
            rentalUnit: { connect: { id: occupancy.rentalUnit.id } },
            billingMonth,
            periodStart: billingMonth,
            periodEnd: billingMonth === '2026-01-01' ? '2026-01-31' : '2026-02-28',
            dueDate: billingMonth,
            currencyCode: 'GHS',
            amount,
        },
    })
}

async function createTenantLedger (client, organization, tenant) {
    return await mutate(client, CREATE_TENANT_LEDGER_MUTATION, {
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: `ledger-${tenant.id.slice(0, 8)}` },
            organization: { connect: { id: organization.id } },
            tenant: { connect: { id: tenant.id } },
            currencyCode: 'GHS',
            status: 'active',
        },
    })
}

async function createChargeLedgerEntry (client, ledger, organization, occupancy, rentCharge) {
    return await mutate(client, CREATE_LEDGER_ENTRY_MUTATION, {
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: `entry-${rentCharge.id.slice(0, 8)}` },
            organization: { connect: { id: organization.id } },
            ledger: { connect: { id: ledger.id } },
            tenant: { connect: { id: occupancy.tenant.id } },
            occupancy: { connect: { id: occupancy.id } },
            property: { connect: { id: occupancy.property.id } },
            rentalUnit: { connect: { id: occupancy.rentalUnit.id } },
            rentCharge: { connect: { id: rentCharge.id } },
            entryType: 'charge',
            direction: 'debit',
            amount: rentCharge.amount,
            currencyCode: 'GHS',
            postingStatus: 'posted',
            description: `Rent charge ${rentCharge.billingMonth}`,
        },
    })
}

async function makeFixture ({ chargeAmounts = ['100'], organizationAttrs = { importId: 'GHORG' } } = {}) {
    const admin = await makeLoggedInAdminClient()
    const [organization] = await createTestOrganization(admin, organizationAttrs)
    const [property] = await createTestProperty(admin, organization)
    await createTestBillingPolicy(admin, organization, property)

    const residentClient = await makeClientWithResidentUser()
    const [resident] = await createTestResident(admin, residentClient.user, property)
    const rentalUnit = await createTestRentalUnit(admin, organization, property)
    const occupancy = await createOccupancy(admin, organization, resident, property, rentalUnit)
    const ledger = await createTenantLedger(admin, organization, resident)

    const months = ['2026-01-01', '2026-02-01']
    const charges = []
    for (let index = 0; index < chargeAmounts.length; index += 1) {
        const charge = await createRentCharge(admin, organization, occupancy, months[index], chargeAmounts[index])
        await createChargeLedgerEntry(admin, ledger, organization, occupancy, charge)
        charges.push(charge)
    }

    return {
        admin,
        organization,
        property,
        resident,
        residentClient,
        rentalUnit,
        occupancy,
        ledger,
        charges,
    }
}

function buildPaymentData (fixture, extraAttrs = {}) {
    return {
        organization: { id: fixture.organization.id },
        tenant: { id: fixture.resident.id },
        occupancy: { id: fixture.occupancy.id },
        property: { id: fixture.property.id },
        rentalUnit: { id: fixture.rentalUnit.id },
        amount: '100',
        paymentMethod: RENT_PAYMENT_METHOD_CASH,
        confirmedAt: '2026-05-04T10:00:00.000Z',
        depositedDate: '2026-05-04T10:00:00.000Z',
        ...extraAttrs,
    }
}

function buildReversalData (fixture, payment, extraAttrs = {}) {
    return {
        organization: { id: fixture.organization.id },
        payment: { id: payment.id },
        reason: 'Cash entry recorded in error',
        ...extraAttrs,
    }
}

async function queryTenantStatement (client, extraAttrs = {}, { raw = false } = {}) {
    const data = {
        dv: 1,
        sender: { dv: 1, fingerprint: 'tenant-statement-test' },
        ...extraAttrs,
    }
    const response = await client.query(GET_TENANT_STATEMENT_QUERY, { data })

    if (raw) return response

    throwIfError(response.data, response.errors)

    return response.data.result
}

describeTenantStatementService('GetTenantStatementService', () => {
    test('returns statement for tenant with unpaid charge', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        })

        expect(result.summary.totalCharges).toBe('100.00000000')
        expect(result.summary.totalPayments).toBe('0.00000000')
        expect(result.summary.totalReversals).toBe('0.00000000')
        expect(result.summary.closingBalance).toBe('100.00000000')
        expect(result.summary.outstandingBalance).toBe('100.00000000')
        expect(result.rows.map(row => row.type)).toEqual(['charge'])
        expect(result.rows[0].runningBalance).toBe('100.00000000')
    })

    test('returns statement after partial payment', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        await recordManualRentPaymentByTestClient(fixture.admin, buildPaymentData(fixture, { amount: '40' }))

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        })

        expect(result.summary.totalCharges).toBe('100.00000000')
        expect(result.summary.totalPayments).toBe('40.00000000')
        expect(result.summary.closingBalance).toBe('60.00000000')
        expect(result.summary.outstandingBalance).toBe('60.00000000')
        expect(result.rows.map(row => row.type)).toEqual(['charge', 'payment', 'allocation', 'receipt'])
        expect(result.rows.find(row => row.type === 'payment').runningBalance).toBe('60.00000000')
    })

    test('returns statement after full payment', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        await recordManualRentPaymentByTestClient(fixture.admin, buildPaymentData(fixture, { amount: '100' }))

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        })

        expect(result.summary.totalPayments).toBe('100.00000000')
        expect(result.summary.closingBalance).toBe('0.00000000')
        expect(result.summary.outstandingBalance).toBe('0.00000000')
    })

    test('returns statement after reversal', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        const [paymentResult] = await recordManualRentPaymentByTestClient(fixture.admin, buildPaymentData(fixture, { amount: '100' }))
        await reverseManualRentPaymentByTestClient(fixture.admin, buildReversalData(fixture, paymentResult.payment))

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        })

        expect(result.summary.totalPayments).toBe('100.00000000')
        expect(result.summary.totalReversals).toBe('100.00000000')
        expect(result.summary.closingBalance).toBe('100.00000000')
        expect(result.summary.outstandingBalance).toBe('100.00000000')
        expect(result.rows.map(row => row.type)).toEqual(['charge', 'payment', 'allocation', 'receipt', 'reversal', 'allocation'])
    })

    test('enforces organization isolation', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        const foreignOrgClient = await makeClientWithRegisteredOrganization()

        const response = await queryTenantStatement(foreignOrgClient, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        }, { raw: true })

        expect(response.data?.result || null).toBeNull()
        expect((response.errors || []).length).toBeGreaterThan(0)
    })

    test('allows resident to read own statement', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })

        const result = await queryTenantStatement(fixture.residentClient, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        })

        expect(result.header.tenantId).toBe(fixture.resident.id)
        expect(result.summary.outstandingBalance).toBe('100.00000000')
    })

    test('denies resident access to another tenant statement', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        const foreignResidentClient = await makeClientWithResidentUser()
        const [foreignResident] = await createTestResident(fixture.admin, foreignResidentClient.user, fixture.property)

        const response = await queryTenantStatement(foreignResidentClient, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
        }, { raw: true })

        expect(response.data?.result || null).toBeNull()
        expect((response.errors || []).length).toBeGreaterThan(0)
        expect(foreignResident.id).toBeDefined()
    })

    test('occupancy filter excludes other occupancies for the same tenant', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        const secondRentalUnit = await createTestRentalUnit(fixture.admin, fixture.organization, fixture.property, { name: 'B2' })

        await updateOccupancy(fixture.admin, fixture.occupancy.id, {
            status: 'ended',
            actualEndDate: '2026-01-31',
        })

        const secondOccupancy = await createOccupancy(fixture.admin, fixture.organization, fixture.resident, fixture.property, secondRentalUnit, {
            startDate: '2026-02-01',
            monthlyRate: '130',
        })
        const secondCharge = await createRentCharge(fixture.admin, fixture.organization, secondOccupancy, '2026-02-01', '130')
        await createChargeLedgerEntry(fixture.admin, fixture.ledger, fixture.organization, secondOccupancy, secondCharge)

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
            occupancy: { id: fixture.occupancy.id },
        })

        expect(result.rows).toHaveLength(1)
        expect(result.rows[0].occupancyId).toBe(fixture.occupancy.id)
        expect(result.summary.closingBalance).toBe('100.00000000')
    })

    test('applies date range filter with opening and closing balance', async () => {
        const fixture = await makeFixture({ chargeAmounts: ['100'] })
        await recordManualRentPaymentByTestClient(fixture.admin, buildPaymentData(fixture, { amount: '40' }))

        const result = await queryTenantStatement(fixture.admin, {
            organization: { id: fixture.organization.id },
            tenant: { id: fixture.resident.id },
            dateFrom: '2026-05-04',
            dateTo: '2026-05-04',
        })

        expect(result.summary.openingBalance).toBe('100.00000000')
        expect(result.summary.closingBalance).toBe('60.00000000')
        expect(result.rows.map(row => row.type)).toEqual(['payment', 'allocation', 'receipt'])
    })
})
