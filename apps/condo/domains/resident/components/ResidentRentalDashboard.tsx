import { useMutation, useQuery } from '@apollo/client'
import { Alert } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, List, Space, Typography } from '@open-condo/ui'

import { INITIATE_RENT_PAYMENT_MUTATION } from '@condo/domains/acquiring/gql'
import {
    buildResidentRentPaymentInitiationBoundary,
    buildResidentRentalDashboardDataSource,
    getResidentRentPaymentErrorMessage,
    getResidentRentPaymentLink,
    getResidentRentPaymentResultMessage,
} from '@condo/domains/resident/utils/clientSchema/rental'

const GET_RESIDENT_RENTAL_DASHBOARD_QUERY = gql`
    query getResidentRentalDashboard ($residentId: ID!) {
        result: residentRentalDashboard(data: { residentId: $residentId }) {
            currentRentalUnit { id name unitType property { id address addressKey } }
            occupancyStatus
            billingFrequency
            monthlyRate
            arrearsTotal
            nextDueDate
            unpaidRentCharges { id billingMonth periodStart periodEnd dueDate amount currencyCode status invoice { id status } }
            linkedUnpaidInvoices { id status toPay currencyCode }
        }
    }
`

type ResidentRentalDashboardProps = {
    residentId?: string | null
    organizationId?: string | null
    payerContact?: {
        email?: string | null
        phone?: string | null
    } | null
}

export const ResidentRentalDashboard: React.FC<ResidentRentalDashboardProps> = ({ residentId, organizationId, payerContact }) => {
    const intl = useIntl()
    const { data, loading, error } = useQuery(GET_RESIDENT_RENTAL_DASHBOARD_QUERY, {
        variables: { residentId },
        skip: !residentId,
    })
    const [initiateRentPayment, { loading: initiationLoading }] = useMutation(INITIATE_RENT_PAYMENT_MUTATION)
    const [initiationResult, setInitiationResult] = useState<Record<string, unknown> | null>(null)
    const [initiationError, setInitiationError] = useState<string | null>(null)

    const dashboard = get(data, 'result')

    const dataSource = useMemo(() => buildResidentRentalDashboardDataSource(intl, dashboard), [dashboard, intl])
    const rentPaymentBoundary = useMemo(() => buildResidentRentPaymentInitiationBoundary({
        residentId,
        organizationId,
        payerContact,
        dashboard,
    }), [dashboard, organizationId, payerContact, residentId])
    const rentPaymentLink = useMemo(() => getResidentRentPaymentLink(initiationResult), [initiationResult])

    const handleInitiateRentPayment = useCallback(async () => {
        if (!rentPaymentBoundary.input) return

        setInitiationError(null)

        try {
            const result = await initiateRentPayment({
                variables: {
                    data: {
                        ...rentPaymentBoundary.input,
                        sender: getClientSideSenderInfo(),
                    },
                },
            })

            setInitiationResult(get(result, ['data', 'result']) || null)
        } catch (error) {
            setInitiationResult(null)
            setInitiationError(getResidentRentPaymentErrorMessage(error))
        }
    }, [initiateRentPayment, rentPaymentBoundary.input])

    if (!residentId || error) return null

    if (loading) {
        return <Typography.Text type='secondary'>Loading rental dashboard...</Typography.Text>
    }

    if (!dashboard) return null

    return (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            <List title='Rental dashboard' dataSource={dataSource} />
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Typography.Title level={4}>Rent payment</Typography.Title>
                <Typography.Text type='secondary'>
                    Start a Paystack payment for the resident&apos;s unpaid rent charges using the public payment initiation flow.
                </Typography.Text>
                {rentPaymentBoundary.disabledReason && (
                    <Alert
                        type='info'
                        showIcon
                        message={rentPaymentBoundary.disabledReason}
                    />
                )}
                {initiationError && (
                    <Alert
                        type='error'
                        showIcon
                        message={initiationError}
                    />
                )}
                {initiationResult && (
                    <Alert
                        type={['duplicate_noop', 'pending_noop', 'confirmed'].includes(get(initiationResult, 'actionTaken')) ? 'info' : 'success'}
                        showIcon
                        message={getResidentRentPaymentResultMessage(initiationResult)}
                        description={(
                            <Space direction='vertical' size={4}>
                                <Typography.Text>
                                    Amount: {get(initiationResult, 'amount') || '—'} {get(initiationResult, 'currency') || ''}
                                </Typography.Text>
                                <Typography.Text>
                                    Status: {get(initiationResult, 'status') || '—'}
                                </Typography.Text>
                                <Typography.Text>
                                    Payment reference: {get(initiationResult, 'providerReference') || '—'}
                                </Typography.Text>
                                {rentPaymentLink && (
                                    <Typography.Link href={rentPaymentLink} target='_blank' rel='noreferrer'>
                                        Open secure payment page
                                    </Typography.Link>
                                )}
                            </Space>
                        )}
                    />
                )}
                <Button
                    type='primary'
                    disabled={!rentPaymentBoundary.input}
                    loading={initiationLoading}
                    onClick={handleInitiateRentPayment}
                >
                    Pay unpaid rent with Paystack
                </Button>
            </Space>
        </Space>
    )
}
