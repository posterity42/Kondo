import { useQuery } from '@apollo/client'
import { Card, Col, Row, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Link from 'next/link'
import React, { useMemo } from 'react'

import { useAuth } from '@open-condo/next/auth'
import { useIntl } from '@open-condo/next/intl'
import { Button, Space, Typography } from '@open-condo/ui'

import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'
import { getRentalUnitDisplayName } from '@condo/domains/resident/utils/clientSchema/rental'


const GET_RESIDENT_PORTAL_DATA = gql`
    query getResidentPortalData ($userId: ID!) {
        residents: allResidents(
            where: { user: { id: $userId }, deletedAt: null }
            sortBy: [createdAt_ASC]
            first: 10
        ) {
            id
            organization { id name }
            property { id address addressKey }
            user { id name phone email }
            currentOccupancy {
                id
                status
                startDate
                expectedEndDate
                rentalUnit { id name unitType property { id } }
            }
        }
        payments: allPayments(
            where: { tenant: { user: { id: $userId } }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: 5
        ) {
            id
            amount
            currencyCode
            paymentMethod
            status
            confirmedAt
            receipt { id number }
        }
        receipts: allPaymentReceipts(
            where: { tenant: { user: { id: $userId } }, deletedAt: null }
            sortBy: [issuedAt_DESC]
            first: 5
        ) {
            id
            number
            amount
            currencyCode
            issuedAt
            paymentMethod
            balanceAfterPayment
        }
        tickets: allTickets(
            where: { client: { id: $userId }, canReadByResident: true, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: 5
        ) {
            id
            number
            details
            status {
                id
                name
                type
                color
            }
            createdAt
            updatedAt
        }
    }
`

const GET_RESIDENT_STATEMENT = gql`
    query getResidentPortalStatement ($data: GetTenantStatementInput!) {
        result: getTenantStatement(data: $data) {
            summary {
                outstandingBalance
                closingBalance
                totalCharges
                totalPayments
                totalReversals
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
            }
        }
    }
`

function formatDateTimeValue (value?: string | null): string {
    if (!value) return '—'

    return new Date(value).toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    })
}

function formatMoneyValue (value?: string | null, currencyCode?: string | null): string {
    if (!value) return `0 ${currencyCode || ''}`.trim()

    return `${value} ${currencyCode || ''}`.trim()
}

export const ResidentPortalDashboard: React.FC = () => {
    const intl = useIntl()
    const { user } = useAuth()
    const userId = get(user, 'id')

    const { data, loading, error } = useQuery(GET_RESIDENT_PORTAL_DATA, {
        variables: { userId },
        skip: !userId,
    })

    const residents = get(data, 'residents', [])
    const primaryResident = useMemo(() => {
        return residents.find(resident => get(resident, 'currentOccupancy')) || residents[0] || null
    }, [residents])

    const statementVariables = useMemo(() => {
        const tenantId = get(primaryResident, 'id')
        const organizationId = get(primaryResident, ['organization', 'id'])

        if (!tenantId || !organizationId) return null

        return {
            data: {
                dv: 1,
                sender: { dv: 1, fingerprint: 'resident-portal-dashboard' },
                organization: { id: organizationId },
                tenant: { id: tenantId },
            },
        }
    }, [primaryResident])

    const {
        data: statementData,
        loading: statementLoading,
        error: statementError,
    } = useQuery(GET_RESIDENT_STATEMENT, {
        variables: statementVariables,
        skip: !statementVariables,
    })

    const statement = get(statementData, 'result')
    const statementRows = useMemo(() => {
        const rows = get(statement, 'rows', [])
        return [...rows].slice(-5).reverse()
    }, [statement])

    const currentOccupancy = get(primaryResident, 'currentOccupancy')
    const currentRentalUnit = get(currentOccupancy, 'rentalUnit')
    const payments = get(data, 'payments', [])
    const receipts = get(data, 'receipts', [])
    const tickets = get(data, 'tickets', [])
    const outstandingBalance = get(statement, ['summary', 'outstandingBalance']) || '0.00000000'

    const paymentColumns = [
        {
            title: 'Date',
            key: 'confirmedAt',
            render: (_, payment) => formatDateTimeValue(get(payment, 'confirmedAt')),
        },
        {
            title: 'Amount',
            key: 'amount',
            render: (_, payment) => formatMoneyValue(get(payment, 'amount'), get(payment, 'currencyCode')),
        },
        {
            title: 'Method',
            dataIndex: 'paymentMethod',
            key: 'paymentMethod',
        },
        {
            title: 'Status',
            key: 'status',
            render: (_, payment) => get(payment, 'status') ? <StatusTag status={get(payment, 'status')} /> : '—',
        },
        {
            title: 'Receipt',
            key: 'receipt',
            render: (_, payment) => get(payment, ['receipt', 'number']) || '—',
        },
    ]

    const receiptColumns = [
        {
            title: 'Receipt',
            key: 'number',
            render: (_, receipt) => get(receipt, 'number') || get(receipt, 'id'),
        },
        {
            title: 'Issued',
            key: 'issuedAt',
            render: (_, receipt) => formatDateTimeValue(get(receipt, 'issuedAt')),
        },
        {
            title: 'Amount',
            key: 'amount',
            render: (_, receipt) => formatMoneyValue(get(receipt, 'amount'), get(receipt, 'currencyCode')),
        },
        {
            title: 'Balance After',
            key: 'balanceAfterPayment',
            render: (_, receipt) => formatMoneyValue(get(receipt, 'balanceAfterPayment'), get(receipt, 'currencyCode')),
        },
    ]

    const ticketColumns = [
        {
            title: 'Request',
            key: 'number',
            render: (_, ticket) => get(ticket, 'number') ? `#${get(ticket, 'number')}` : get(ticket, 'id'),
        },
        {
            title: 'Details',
            key: 'details',
            render: (_, ticket) => get(ticket, 'details') || '—',
        },
        {
            title: 'Updated',
            key: 'updatedAt',
            render: (_, ticket) => formatDateTimeValue(get(ticket, 'updatedAt')),
        },
        {
            title: 'Status',
            key: 'status',
            render: (_, ticket) => get(ticket, ['status', 'type']) ? <StatusTag status={get(ticket, ['status', 'type'])} /> : (get(ticket, ['status', 'name']) || '—'),
        },
    ]

    const statementColumns = [
        {
            title: 'Date',
            key: 'date',
            render: (_, row) => formatDateTimeValue(get(row, 'date')),
        },
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
        },
        {
            title: 'Description',
            dataIndex: 'description',
            key: 'description',
        },
        {
            title: 'Balance',
            key: 'runningBalance',
            render: (_, row) => formatMoneyValue(get(row, 'runningBalance')),
        },
    ]

    if (loading) {
        return <LoadingOrErrorPage title='Tenant portal' loading={true} />
    }

    if (error) {
        return <LoadingOrErrorPage title='Tenant portal' loading={false} error={error.message} />
    }

    if (!primaryResident) {
        return <LoadingOrErrorPage title='Tenant portal' loading={false} error='No tenant profile is linked to this account yet.' />
    }

    return (
        <Space direction='vertical' size={24} width='100%'>
            <Row gutter={[24, 24]}>
                <Col xs={24} lg={12}>
                    <Card title='Current Occupancy'>
                        <Space direction='vertical' size={8}>
                            <Typography.Text>
                                Property: {get(primaryResident, ['property', 'address']) || '—'}
                            </Typography.Text>
                            <Typography.Text>
                                Rental Unit: {getRentalUnitDisplayName(intl, currentRentalUnit) || '—'}
                            </Typography.Text>
                            <Typography.Text>
                                Start Date: {formatDateTimeValue(get(currentOccupancy, 'startDate'))}
                            </Typography.Text>
                            <Typography.Text>
                                Expected End Date: {formatDateTimeValue(get(currentOccupancy, 'expectedEndDate'))}
                            </Typography.Text>
                            <Typography.Text>
                                Status: {get(currentOccupancy, 'status') ? <StatusTag status={get(currentOccupancy, 'status')} /> : '—'}
                            </Typography.Text>
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card
                        title='Balance Summary'
                        extra={(
                            <Link href='/resident/statement'>
                                <Button type='secondary'>Open Statement</Button>
                            </Link>
                        )}
                    >
                        <Space direction='vertical' size={8}>
                            <Typography.Text>
                                Outstanding Balance: {formatMoneyValue(outstandingBalance)}
                            </Typography.Text>
                            <Typography.Text>
                                Closing Balance: {formatMoneyValue(get(statement, ['summary', 'closingBalance']))}
                            </Typography.Text>
                            <Typography.Text>
                                Charges: {formatMoneyValue(get(statement, ['summary', 'totalCharges']))}
                            </Typography.Text>
                            <Typography.Text>
                                Payments: {formatMoneyValue(get(statement, ['summary', 'totalPayments']))}
                            </Typography.Text>
                            <Typography.Text>
                                Reversals: {formatMoneyValue(get(statement, ['summary', 'totalReversals']))}
                            </Typography.Text>
                            {statementError && (
                                <Typography.Text type='secondary'>
                                    Statement preview is unavailable right now.
                                </Typography.Text>
                            )}
                        </Space>
                    </Card>
                </Col>
            </Row>

            <Card
                title='Recent Statement Activity'
                extra={renderLink('Full statement', '/resident/statement')}
            >
                <Table
                    rowKey='id'
                    columns={statementColumns}
                    dataSource={statementRows}
                    loading={statementLoading}
                    pagination={false}
                    scroll={{ x: true }}
                />
            </Card>

            <Card title='Recent Payments'>
                <Table
                    rowKey='id'
                    columns={paymentColumns}
                    dataSource={payments}
                    pagination={false}
                    scroll={{ x: true }}
                />
            </Card>

            <Card title='Recent Receipts'>
                <Table
                    rowKey='id'
                    columns={receiptColumns}
                    dataSource={receipts}
                    pagination={false}
                    scroll={{ x: true }}
                />
            </Card>

            <Card title='Recent Service Requests'>
                <Table
                    rowKey='id'
                    columns={ticketColumns}
                    dataSource={tickets}
                    pagination={false}
                    scroll={{ x: true }}
                />
            </Card>
        </Space>
    )
}
