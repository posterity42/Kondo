const Big = require('big.js')
const dayjs = require('dayjs')
const get = require('lodash/get')

const { GQLError, GQLErrorCode: { BAD_USER_INPUT } } = require('@open-condo/keystone/errors')
const { find, getById } = require('@open-condo/keystone/schema')

const {
    LEDGER_ENTRY_DIRECTION_CREDIT,
    LEDGER_ENTRY_DIRECTION_DEBIT,
    LEDGER_ENTRY_STATUS_POSTED,
    LEDGER_ENTRY_TYPE_CHARGE,
    LEDGER_ENTRY_TYPE_PAYMENT,
    LEDGER_ENTRY_TYPE_REVERSAL,
} = require('@condo/domains/billing/constants/ledger')
const { DEFAULT_RENT_CHARGE_CURRENCY_CODE } = require('@condo/domains/billing/constants/rent')
const { OCCUPANCY_STATUS_ACTIVE } = require('@condo/domains/resident/constants/occupancy')

const ERRORS = {
    REQUIRED_ORGANIZATION: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_REQUIRED_ORGANIZATION',
        message: 'Organization is required for tenant statement',
        messageForUser: 'api.billing.tenantStatement.REQUIRED_ORGANIZATION',
    },
    REQUIRED_TENANT: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_REQUIRED_TENANT',
        message: 'Tenant is required for tenant statement',
        messageForUser: 'api.billing.tenantStatement.REQUIRED_TENANT',
    },
    TENANT_NOT_FOUND: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_TENANT_NOT_FOUND',
        message: 'Tenant not found',
        messageForUser: 'api.billing.tenantStatement.TENANT_NOT_FOUND',
    },
    OCCUPANCY_NOT_FOUND: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_OCCUPANCY_NOT_FOUND',
        message: 'Occupancy not found',
        messageForUser: 'api.billing.tenantStatement.OCCUPANCY_NOT_FOUND',
    },
    PROPERTY_NOT_FOUND: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_PROPERTY_NOT_FOUND',
        message: 'Property not found',
        messageForUser: 'api.billing.tenantStatement.PROPERTY_NOT_FOUND',
    },
    SCOPE_MISMATCH: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_SCOPE_MISMATCH',
        message: 'Tenant statement organization, tenant, occupancy, and property must match',
        messageForUser: 'api.billing.tenantStatement.SCOPE_MISMATCH',
    },
    INVALID_DATE_RANGE: {
        code: BAD_USER_INPUT,
        type: 'TENANT_STATEMENT_INVALID_DATE_RANGE',
        message: 'Statement date range is invalid',
        messageForUser: 'api.billing.tenantStatement.INVALID_DATE_RANGE',
    },
}

const LEDGER_ROW_PRIORITY = 1
const ALLOCATION_ROW_PRIORITY = 2
const RECEIPT_ROW_PRIORITY = 3

function toMoney (value) {
    return Big(value || 0).toFixed(8)
}

function compareByDateAndPriority (left, right) {
    const leftTime = new Date(left.date).getTime()
    const rightTime = new Date(right.date).getTime()

    if (leftTime !== rightTime) return leftTime - rightTime
    if (left.priority !== right.priority) return left.priority - right.priority

    return String(left.id).localeCompare(String(right.id))
}

function isDateWithinRange (value, start, end) {
    const current = dayjs(value)
    if (!current.isValid()) return false
    if (start && current.isBefore(start)) return false
    if (end && current.isAfter(end)) return false

    return true
}

function isBeforeStart (value, start) {
    if (!start) return false

    return dayjs(value).isBefore(start)
}

function isOnOrBeforeEnd (value, end) {
    if (!end) return true

    return !dayjs(value).isAfter(end)
}

function getEntrySignedAmount (entry) {
    const amount = Big(entry.amount || 0)

    return entry.direction === LEDGER_ENTRY_DIRECTION_DEBIT ? amount : amount.times(-1)
}

function mapLedgerEntryType (entryType) {
    if (entryType === LEDGER_ENTRY_TYPE_CHARGE) return 'charge'
    if (entryType === LEDGER_ENTRY_TYPE_PAYMENT) return 'payment'
    if (entryType === LEDGER_ENTRY_TYPE_REVERSAL) return 'reversal'

    return 'adjustment'
}

function matchesScopedEntity (entity, scope) {
    if (!entity) return false
    if (scope.occupancyId && String(entity.occupancy) !== String(scope.occupancyId)) return false
    if (scope.propertyId && String(entity.property) !== String(scope.propertyId)) return false

    return true
}

function getScopedOccupancyRecord ({ occupancy, activeOccupancy, scopedEntries, scopedCharges }) {
    if (occupancy) return occupancy
    if (activeOccupancy) return activeOccupancy

    const occupancyId = scopedEntries.find(entry => entry.occupancy)?.occupancy || scopedCharges.find(charge => charge.occupancy)?.occupancy
    return occupancyId ? { id: occupancyId } : null
}

function getLinkedEntityData (entry, maps) {
    if (entry.rentCharge) {
        return {
            linkedEntityId: entry.rentCharge,
            linkedEntityType: 'RentCharge',
            reference: get(maps.rentCharges, [entry.rentCharge, 'billingMonth']),
            status: get(maps.rentCharges, [entry.rentCharge, 'status']),
        }
    }

    if (entry.receipt) {
        return {
            linkedEntityId: entry.receipt,
            linkedEntityType: 'PaymentReceipt',
            reference: get(maps.receipts, [entry.receipt, 'number']),
            status: get(maps.payments, [entry.payment, 'status']) || get(maps.receipts, [entry.receipt, 'paymentStatus']),
        }
    }

    if (entry.payment) {
        return {
            linkedEntityId: entry.payment,
            linkedEntityType: 'Payment',
            reference: get(maps.payments, [entry.payment, 'externalTransactionId']),
            status: get(maps.payments, [entry.payment, 'status']),
        }
    }

    return {
        linkedEntityId: entry.id,
        linkedEntityType: 'LedgerEntry',
        reference: null,
        status: entry.postingStatus,
    }
}

async function getTenantStatement (context, data) {
    const organizationId = get(data, ['organization', 'id'])
    const tenantId = get(data, ['tenant', 'id'])
    const occupancyId = get(data, ['occupancy', 'id'])
    const propertyId = get(data, ['property', 'id'])
    const start = data.dateFrom ? dayjs(data.dateFrom).startOf('day') : null
    const end = data.dateTo ? dayjs(data.dateTo).endOf('day') : null

    if (!organizationId) throw new GQLError(ERRORS.REQUIRED_ORGANIZATION, context)
    if (!tenantId) throw new GQLError(ERRORS.REQUIRED_TENANT, context)
    if ((start && !start.isValid()) || (end && !end.isValid()) || (start && end && start.isAfter(end))) {
        throw new GQLError(ERRORS.INVALID_DATE_RANGE, context)
    }

    const tenant = await getById('Resident', tenantId)
    if (!tenant) throw new GQLError(ERRORS.TENANT_NOT_FOUND, context)

    const occupancy = occupancyId ? await getById('Occupancy', occupancyId) : null
    const property = propertyId ? await getById('Property', propertyId) : null

    if (occupancyId && !occupancy) throw new GQLError(ERRORS.OCCUPANCY_NOT_FOUND, context)
    if (propertyId && !property) throw new GQLError(ERRORS.PROPERTY_NOT_FOUND, context)

    if (occupancy && (
        String(occupancy.organization) !== String(organizationId)
        || String(occupancy.tenant) !== String(tenantId)
        || (propertyId && String(occupancy.property) !== String(propertyId))
    )) {
        throw new GQLError(ERRORS.SCOPE_MISMATCH, context)
    }

    if (property && String(property.organization) !== String(organizationId)) {
        throw new GQLError(ERRORS.SCOPE_MISMATCH, context)
    }

    const activeOccupancies = await find('Occupancy', {
        organization: { id: organizationId },
        tenant: { id: tenantId },
        status: OCCUPANCY_STATUS_ACTIVE,
        deletedAt: null,
    })
    const activeOccupancy = activeOccupancies[0] || null

    const ledgers = await find('TenantLedger', {
        organization: { id: organizationId },
        tenant: { id: tenantId },
        deletedAt: null,
    })
    const ledgerIds = ledgers.map(ledger => ledger.id)

    const scope = { organizationId, tenantId, occupancyId, propertyId }
    const ledgerEntries = ledgerIds.length > 0 ? await find('LedgerEntry', {
        ledger: { id_in: ledgerIds },
        postingStatus: LEDGER_ENTRY_STATUS_POSTED,
        deletedAt: null,
    }) : []

    const scopedEntries = ledgerEntries
        .filter(entry => matchesScopedEntity(entry, scope))
        .sort((left, right) => compareByDateAndPriority(
            { id: left.id, date: left.postedAt, priority: LEDGER_ROW_PRIORITY },
            { id: right.id, date: right.postedAt, priority: LEDGER_ROW_PRIORITY }
        ))

    const paymentIds = [...new Set(scopedEntries.map(entry => entry.payment).filter(Boolean))]
    const chargeIds = [...new Set(scopedEntries.map(entry => entry.rentCharge).filter(Boolean))]
    const receiptIds = [...new Set(scopedEntries.map(entry => entry.receipt).filter(Boolean))]

    const rentCharges = chargeIds.length > 0 ? await find('RentCharge', {
        id_in: chargeIds,
        deletedAt: null,
    }) : []
    const rentChargeMap = Object.fromEntries(rentCharges.map(charge => [charge.id, charge]))

    const payments = paymentIds.length > 0 ? await find('Payment', {
        id_in: paymentIds,
        deletedAt: null,
    }) : []
    const paymentMap = Object.fromEntries(payments.map(payment => [payment.id, payment]))

    const relatedReceipts = paymentIds.length > 0 ? await find('PaymentReceipt', {
        payment: { id_in: paymentIds },
        deletedAt: null,
    }) : []
    const receipts = Object.values(Object.fromEntries([...relatedReceipts, ...(
        receiptIds.length > 0 ? await find('PaymentReceipt', { id_in: receiptIds, deletedAt: null }) : []
    )].map(receipt => [receipt.id, receipt])))
    const receiptMap = Object.fromEntries(receipts.map(receipt => [receipt.id, receipt]))

    const allocations = paymentIds.length > 0 ? await find('PaymentAllocation', {
        payment: { id_in: paymentIds },
        deletedAt: null,
    }) : []
    const scopedAllocations = allocations
        .filter(allocation => matchesScopedEntity(rentChargeMap[allocation.rentCharge], scope))
        .sort((left, right) => compareByDateAndPriority(
            { id: left.id, date: left.allocatedAt, priority: ALLOCATION_ROW_PRIORITY },
            { id: right.id, date: right.allocatedAt, priority: ALLOCATION_ROW_PRIORITY }
        ))

    const filteredEntries = scopedEntries.filter(entry => isDateWithinRange(entry.postedAt, start, end))
    const filteredReceipts = receipts.filter(receipt => {
        const payment = paymentMap[receipt.payment]
        if (!payment) return false
        if (occupancyId && String(payment.occupancy) !== String(occupancyId)) return false
        if (propertyId && String(payment.property) !== String(propertyId)) return false

        return isDateWithinRange(receipt.issuedAt, start, end)
    })
    const filteredAllocations = scopedAllocations.filter(allocation => isDateWithinRange(allocation.allocatedAt, start, end))

    const openingBalance = scopedEntries.reduce((total, entry) => {
        if (!isBeforeStart(entry.postedAt, start)) return total

        return total.plus(getEntrySignedAmount(entry))
    }, Big(0))
    const closingBalance = scopedEntries.reduce((total, entry) => {
        if (!isOnOrBeforeEnd(entry.postedAt, end)) return total

        return total.plus(getEntrySignedAmount(entry))
    }, Big(0))
    const outstandingBalance = scopedEntries.reduce((total, entry) => total.plus(getEntrySignedAmount(entry)), Big(0))

    const maps = {
        rentCharges: rentChargeMap,
        payments: paymentMap,
        receipts: receiptMap,
    }

    const ledgerRows = filteredEntries.map(entry => {
        const linked = getLinkedEntityData(entry, maps)
        const payment = entry.payment ? paymentMap[entry.payment] : null
        const charge = entry.rentCharge ? rentChargeMap[entry.rentCharge] : null
        const description = entry.description
            || (entry.entryType === LEDGER_ENTRY_TYPE_CHARGE && charge ? `Rent charge ${charge.billingMonth}` : null)
            || (entry.entryType === LEDGER_ENTRY_TYPE_PAYMENT ? 'Payment received' : null)
            || (entry.entryType === LEDGER_ENTRY_TYPE_REVERSAL ? 'Reversal posted' : null)
            || 'Ledger adjustment'

        return {
            id: `ledger:${entry.id}`,
            date: entry.postedAt,
            type: mapLedgerEntryType(entry.entryType),
            description,
            debit: entry.direction === LEDGER_ENTRY_DIRECTION_DEBIT ? toMoney(entry.amount) : null,
            credit: entry.direction === LEDGER_ENTRY_DIRECTION_CREDIT ? toMoney(entry.amount) : null,
            runningBalance: null,
            linkedEntityId: linked.linkedEntityId,
            linkedEntityType: linked.linkedEntityType,
            reference: linked.reference || get(payment, 'externalTransactionId'),
            status: linked.status || entry.postingStatus,
            occupancyId: entry.occupancy || get(charge, 'occupancy') || get(payment, 'occupancy') || null,
            propertyId: entry.property || get(charge, 'property') || get(payment, 'property') || null,
            rentalUnitId: entry.rentalUnit || get(charge, 'rentalUnit') || get(payment, 'rentalUnit') || null,
            signedAmount: getEntrySignedAmount(entry),
            priority: LEDGER_ROW_PRIORITY,
        }
    })

    const allocationRows = filteredAllocations.map(allocation => {
        const charge = rentChargeMap[allocation.rentCharge]
        const payment = paymentMap[allocation.payment]
        const amount = Big(allocation.amount || 0)
        const isReversalAllocation = amount.lt(0)

        return {
            id: `allocation:${allocation.id}`,
            date: allocation.allocatedAt,
            type: 'allocation',
            description: isReversalAllocation
                ? `Allocation reversal for rent charge ${get(charge, 'billingMonth') || allocation.rentCharge}`
                : `Allocated to rent charge ${get(charge, 'billingMonth') || allocation.rentCharge}`,
            debit: null,
            credit: null,
            runningBalance: null,
            linkedEntityId: allocation.id,
            linkedEntityType: 'PaymentAllocation',
            reference: get(payment, 'externalTransactionId') || allocation.rentCharge,
            status: get(charge, 'status') || get(payment, 'status') || null,
            occupancyId: get(charge, 'occupancy') || get(payment, 'occupancy') || null,
            propertyId: get(charge, 'property') || get(payment, 'property') || null,
            rentalUnitId: get(charge, 'rentalUnit') || get(payment, 'rentalUnit') || null,
            signedAmount: null,
            priority: ALLOCATION_ROW_PRIORITY,
        }
    })

    const receiptRows = filteredReceipts.map(receipt => {
        const payment = paymentMap[receipt.payment]

        return {
            id: `receipt:${receipt.id}`,
            date: receipt.issuedAt,
            type: 'receipt',
            description: `Receipt ${receipt.number || receipt.id}`,
            debit: null,
            credit: null,
            runningBalance: null,
            linkedEntityId: receipt.id,
            linkedEntityType: 'PaymentReceipt',
            reference: receipt.number || receipt.reference || get(payment, 'externalTransactionId') || null,
            status: get(payment, 'status') || null,
            occupancyId: get(payment, 'occupancy') || null,
            propertyId: get(payment, 'property') || null,
            rentalUnitId: get(payment, 'rentalUnit') || null,
            signedAmount: null,
            priority: RECEIPT_ROW_PRIORITY,
        }
    })

    const rows = [...ledgerRows, ...allocationRows, ...receiptRows].sort(compareByDateAndPriority)
    let runningBalance = openingBalance

    for (const row of rows) {
        if (row.signedAmount) {
            runningBalance = runningBalance.plus(row.signedAmount)
        }

        row.runningBalance = toMoney(runningBalance)
        delete row.signedAmount
        delete row.priority
    }

    const filteredSummaryEntries = filteredEntries
    const totalCharges = filteredSummaryEntries.reduce((total, entry) => {
        if (entry.entryType !== LEDGER_ENTRY_TYPE_CHARGE) return total
        return total.plus(entry.amount || 0)
    }, Big(0))
    const totalPayments = filteredSummaryEntries.reduce((total, entry) => {
        if (entry.entryType !== LEDGER_ENTRY_TYPE_PAYMENT) return total
        return total.plus(entry.amount || 0)
    }, Big(0))
    const totalReversals = filteredSummaryEntries.reduce((total, entry) => {
        if (entry.entryType !== LEDGER_ENTRY_TYPE_REVERSAL) return total
        return total.plus(entry.amount || 0)
    }, Big(0))
    const totalCreditsAdjustments = filteredSummaryEntries.reduce((total, entry) => {
        if (entry.entryType === LEDGER_ENTRY_TYPE_CHARGE || entry.entryType === LEDGER_ENTRY_TYPE_PAYMENT || entry.entryType === LEDGER_ENTRY_TYPE_REVERSAL) {
            return total
        }

        if (entry.direction !== LEDGER_ENTRY_DIRECTION_CREDIT) return total

        return total.plus(entry.amount || 0)
    }, Big(0))

    const scopedOccupancy = getScopedOccupancyRecord({
        occupancy,
        activeOccupancy,
        scopedEntries,
        scopedCharges: rentCharges.filter(charge => matchesScopedEntity(charge, scope)),
    })
    const scopedPropertyId = propertyId
        || get(occupancy, 'property')
        || get(scopedOccupancy, 'property')
        || get(activeOccupancy, 'property')
        || get(tenant, 'property')
        || rows.find(row => row.propertyId)?.propertyId
        || null
    const scopedProperty = scopedPropertyId ? await getById('Property', scopedPropertyId) : null
    const scopedRentalUnitId = get(occupancy, 'rentalUnit')
        || get(scopedOccupancy, 'rentalUnit')
        || get(activeOccupancy, 'rentalUnit')
        || rows.find(row => row.rentalUnitId)?.rentalUnitId
        || null
    const scopedRentalUnit = scopedRentalUnitId ? await getById('RentalUnit', scopedRentalUnitId) : null
    const periodStart = data.dateFrom || rows[0]?.date || null
    const periodEnd = data.dateTo || rows[rows.length - 1]?.date || null

    return {
        header: {
            tenantId: tenant.id,
            tenantName: get(tenant, ['user', 'name']) || get(tenant, ['user', 'phone']) || tenant.id,
            tenantPhone: get(tenant, ['user', 'phone']) || null,
            tenantEmail: get(tenant, ['user', 'email']) || null,
            propertyId: scopedPropertyId,
            propertyName: get(scopedProperty, 'address') || get(scopedProperty, 'name') || null,
            rentalUnitId: scopedRentalUnitId,
            rentalUnitName: get(scopedRentalUnit, 'name') || null,
            occupancyId: get(occupancy, 'id') || get(scopedOccupancy, 'id') || null,
            occupancyStatus: get(occupancy, 'status') || get(scopedOccupancy, 'status') || get(activeOccupancy, 'status') || null,
            statementPeriodStart: periodStart,
            statementPeriodEnd: periodEnd,
            currencyCode: DEFAULT_RENT_CHARGE_CURRENCY_CODE,
        },
        summary: {
            totalCharges: toMoney(totalCharges),
            totalPayments: toMoney(totalPayments),
            totalReversals: toMoney(totalReversals),
            totalCreditsAdjustments: toMoney(totalCreditsAdjustments),
            openingBalance: toMoney(openingBalance),
            closingBalance: toMoney(closingBalance),
            outstandingBalance: toMoney(outstandingBalance),
            runningBalanceAvailable: true,
        },
        rows,
    }
}

module.exports = {
    getTenantStatement,
}
