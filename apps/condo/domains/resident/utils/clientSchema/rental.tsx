import get from 'lodash/get'

import type { IntlShape } from 'react-intl'

import { RENT_PAYMENT_PROVIDER_PAYSTACK } from '@condo/domains/acquiring/constants/rentPayment'

type RentalUnitLike = {
    id?: string | null
    name?: string | null
    unitType?: string | null
    property?: {
        id?: string | null
    } | null
}

type LegacyUnitLike = {
    unitName?: string | null
    unitType?: string | null
    rentalUnit?: RentalUnitLike | null
}

type ResidentRentalDashboardLike = {
    currentRentalUnit?: RentalUnitLike | null
    occupancyStatus?: string | null
    billingFrequency?: string | null
    monthlyRate?: string | null
    arrearsTotal?: string | null
    nextDueDate?: string | null
    unpaidRentCharges?: unknown[] | null
    linkedUnpaidInvoices?: unknown[] | null
}

type RentChargeLike = {
    id?: string | null
    currencyCode?: string | null
}

type InvoiceLike = {
    currencyCode?: string | null
}

type ResidentRentPaymentPayerContact = {
    email?: string | null
    phone?: string | null
}

type ResidentRentPaymentBoundaryArgs = {
    residentId?: string | null
    organizationId?: string | null
    payerContact?: ResidentRentPaymentPayerContact | null
    dashboard?: ResidentRentalDashboardLike | null
}

type ResidentRentPaymentBoundaryResult = {
    input: Record<string, unknown> | null
    disabledReason: string | null
}

type RentPaymentResultLike = {
    amount?: string | null
    currency?: string | null
    paymentId?: string | null
    providerReference?: string | null
    authorizationUrl?: string | null
    paymentUrl?: string | null
    actionTaken?: string | null
}

type RentPaymentErrorLike = {
    graphQLErrors?: Array<{ message?: string | null }>
    message?: string | null
}

function isPositiveMoneyString (value?: string | null): boolean {
    if (!value) return false

    return Number(value) > 0
}

function getRentPaymentCurrency (dashboard?: ResidentRentalDashboardLike | null): string | null {
    const unpaidRentCharges = get(dashboard, 'unpaidRentCharges', []) as RentChargeLike[]
    const linkedUnpaidInvoices = get(dashboard, 'linkedUnpaidInvoices', []) as InvoiceLike[]

    return get(unpaidRentCharges, [0, 'currencyCode']) || get(linkedUnpaidInvoices, [0, 'currencyCode']) || null
}

function getRentPaymentLinkCandidate (result?: RentPaymentResultLike | null): string | null {
    return get(result, 'authorizationUrl') || get(result, 'paymentUrl') || null
}

export function getRentalUnitDisplayName (intl: IntlShape, rentalUnit?: RentalUnitLike | null, fallback?: LegacyUnitLike | null): string {
    const name = get(rentalUnit, 'name') || get(fallback, 'unitName')
    const unitType = get(rentalUnit, 'unitType') || get(fallback, 'unitType')

    if (!name) return ''

    if (!unitType) return name

    try {
        const prefix = intl.formatMessage({ id: `pages.condo.ticket.field.unitType.prefix.${unitType}` as FormatjsIntl.Message['ids'] })
        return prefix ? `${prefix} ${name}` : name
    } catch (error) {
        return name
    }
}

export function getRecordRentalUnitDisplayName (intl: IntlShape, record?: LegacyUnitLike | null): string {
    return getRentalUnitDisplayName(intl, get(record, 'rentalUnit'), record)
}

export function getRecordRentalUnitType (record?: LegacyUnitLike | null): string | null {
    return get(record, ['rentalUnit', 'unitType']) || get(record, 'unitType') || null
}

export function buildRentalUnitSelectWhere ({ propertyId, organizationId, rentableOnly }: {
    propertyId?: string | null
    organizationId?: string | null
    rentableOnly?: boolean
} = {}) {
    return {
        deletedAt: null,
        ...(propertyId ? { property: { id: propertyId } } : {}),
        ...(organizationId ? { organization: { id: organizationId } } : {}),
        ...(rentableOnly ? { rentable: true } : {}),
    }
}

export function buildResidentRentalDashboardDataSource (intl: IntlShape, dashboard?: ResidentRentalDashboardLike | null) {
    if (!dashboard) return []

    return [
        { label: 'Rental unit', value: getRentalUnitDisplayName(intl, get(dashboard, 'currentRentalUnit')) || '—' },
        { label: 'Occupancy status', value: get(dashboard, 'occupancyStatus') || '—' },
        { label: 'Billing frequency', value: get(dashboard, 'billingFrequency') || '—' },
        { label: 'Monthly rate', value: get(dashboard, 'monthlyRate') || '—' },
        { label: 'Arrears', value: get(dashboard, 'arrearsTotal') || '0' },
        { label: 'Next due date', value: get(dashboard, 'nextDueDate') || '—' },
        { label: 'Unpaid rent charges', value: get(dashboard, 'unpaidRentCharges', []).length },
        { label: 'Linked unpaid invoices', value: get(dashboard, 'linkedUnpaidInvoices', []).length },
    ]
}

export function buildResidentRentPaymentInitiationBoundary ({
    residentId,
    organizationId,
    payerContact,
    dashboard,
}: ResidentRentPaymentBoundaryArgs): ResidentRentPaymentBoundaryResult {
    if (!residentId) {
        return {
            input: null,
            disabledReason: 'Resident profile is required to start online rent payment.',
        }
    }

    if (!organizationId) {
        return {
            input: null,
            disabledReason: 'Organization context is required to start online rent payment.',
        }
    }

    const amount = get(dashboard, 'arrearsTotal')
    if (!isPositiveMoneyString(amount)) {
        return {
            input: null,
            disabledReason: 'No unpaid rent charges are available for online payment.',
        }
    }

    const rentalUnitId = get(dashboard, ['currentRentalUnit', 'id'])
    const propertyId = get(dashboard, ['currentRentalUnit', 'property', 'id'])
    if (!rentalUnitId || !propertyId) {
        return {
            input: null,
            disabledReason: 'An active rental unit is required to start online rent payment.',
        }
    }

    const currency = getRentPaymentCurrency(dashboard)
    if (!currency) {
        return {
            input: null,
            disabledReason: 'Currency for unpaid rent charges is unavailable.',
        }
    }

    const email = get(payerContact, 'email') || null
    const phone = get(payerContact, 'phone') || null
    if (!email && !phone) {
        return {
            input: null,
            disabledReason: 'Add a phone number or email to start online rent payment.',
        }
    }

    const unpaidRentCharges = get(dashboard, 'unpaidRentCharges', []) as RentChargeLike[]

    return {
        input: {
            dv: 1,
            organization: { id: organizationId },
            tenant: { id: residentId },
            property: { id: propertyId },
            rentalUnit: { id: rentalUnitId },
            amount,
            currency,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            purpose: 'Online rent payment for unpaid rent charges',
            payerContact: {
                ...(email ? { email } : {}),
                ...(phone ? { phone } : {}),
            },
            rentContext: {
                source: 'residentRentalDashboard',
                residentId,
                unpaidRentChargeIds: unpaidRentCharges.map(charge => charge.id).filter(Boolean),
            },
        },
        disabledReason: null,
    }
}

export function getResidentRentPaymentResultMessage (result?: RentPaymentResultLike | null): string {
    if (get(result, 'actionTaken') === 'duplicate_noop') {
        return 'An existing pending rent payment was reused. Continue with the secure payment link below.'
    }
    if (get(result, 'actionTaken') === 'recovered_retry') {
        return 'The previous pending rent payment could not be reused. Continue with the new secure payment link below.'
    }
    if (get(result, 'actionTaken') === 'pending_noop') {
        return 'A previous rent payment is still pending verification. Please wait a moment before trying again.'
    }
    if (get(result, 'actionTaken') === 'confirmed') {
        return 'The earlier pending rent payment has already been confirmed.'
    }

    if (getRentPaymentLinkCandidate(result)) {
        return 'Rent payment was started successfully. Continue with the secure payment link below.'
    }

    return 'Rent payment was started, but no checkout link is available yet.'
}

export function getResidentRentPaymentLink (result?: RentPaymentResultLike | null): string | null {
    return getRentPaymentLinkCandidate(result)
}

export function getResidentRentPaymentErrorMessage (error?: RentPaymentErrorLike | null): string {
    const message = get(error, ['graphQLErrors', 0, 'message']) || get(error, 'message') || ''

    if (message.includes('not configured for online rent payment initiation')) {
        return 'Online rent payment is not available right now.'
    }
    if (message.includes('rejected the payment initiation request')) {
        return 'The rent payment request is missing required payment details.'
    }
    if (message.includes('failed to initialize online rent payment')) {
        return 'The payment provider could not start the rent payment right now. Please try again later.'
    }
    if (message.includes('already used by another payment intent')) {
        return 'This rent payment request conflicts with another payment that is already in progress.'
    }

    return 'Unable to start rent payment right now.'
}
