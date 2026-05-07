import { useQuery } from '@apollo/client'
import { Card, Col, DatePicker, Row, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useMemo, useState } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { renderLink } from '@condo/domains/common/utils/Renders'
import {
    formatDate,
    formatDateTime,
    formatEnumLabel,
    formatMoney,
    getRentalUnitName,
    getTenantName,
    StatusTag,
} from '@condo/domains/property/components/RentalAdmin/utils'

import styles from './StatementPage.module.css'

import type { Dayjs } from 'dayjs'

const GET_TENANT_STATEMENT = gql`
    query getTenantStatementPage ($data: GetTenantStatementInput!) {
        result: getTenantStatement(data: $data) {
            header {
                tenantId
                tenantName
                tenantPhone
                tenantEmail
                propertyId
                propertyName
                rentalUnitId
                rentalUnitName
                occupancyId
                occupancyStatus
                statementPeriodStart
                statementPeriodEnd
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

type StatementPageProps = {
    title: string
    subTitle: string
    tenantId: string
    occupancyId?: string
    propertyId?: string
    extraLinks?: Array<React.ReactNode>
}

type DateRange = [Dayjs | null, Dayjs | null] | null

function getLinkedEntityLink (row) {
    if (!row.linkedEntityId) return null
    if (row.linkedEntityType === 'Payment') return `/payment/${row.linkedEntityId}`
    if (row.linkedEntityType === 'PaymentReceipt') return `/receipt/${row.linkedEntityId}`
    if (row.linkedEntityType === 'RentCharge') return `/rentCharge/${row.linkedEntityId}`

    return null
}

export const StatementPage: React.FC<StatementPageProps> = ({ title, subTitle, tenantId, occupancyId, propertyId, extraLinks = [] }) => {
    const intl = useIntl()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [dateRange, setDateRange] = useState<DateRange>(null)
    const [start, end] = dateRange || [null, null]

    const variables = useMemo(() => ({
        data: {
            dv: 1,
            sender: { dv: 1, fingerprint: 'rental-admin-statement-page' },
            organization: { id: organizationId },
            tenant: { id: tenantId },
            ...(occupancyId ? { occupancy: { id: occupancyId } } : {}),
            ...(propertyId ? { property: { id: propertyId } } : {}),
            ...(start ? { dateFrom: start.format('YYYY-MM-DD') } : {}),
            ...(end ? { dateTo: end.format('YYYY-MM-DD') } : {}),
        },
    }), [end, occupancyId, organizationId, propertyId, start, tenantId])

    const { data, loading, error, refetch } = useQuery(GET_TENANT_STATEMENT, {
        variables,
        skip: !organizationId || !tenantId,
    })

    if (!tenantId) {
        return <LoadingOrErrorPage title={title} loading={true} />
    }

    if (loading && !data) {
        return <LoadingOrErrorPage title={title} loading={loading} />
    }

    if (error) {
        return <LoadingOrErrorPage title={title} loading={false} error={error.message} />
    }

    const statement = get(data, 'result')
    if (!statement) {
        return <LoadingOrErrorPage title={title} loading={false} error='Statement not found' />
    }

    const header = statement.header
    const summary = statement.summary
    const rows = statement.rows || []
    const extra = [
        ...extraLinks,
        <Button key='print-statement' type='secondary' onClick={() => window.print()}>
            Print
        </Button>,
    ]

    const columns = [
        {
            title: 'Date',
            key: 'date',
            render: (_, row) => formatDateTime(get(row, 'date')),
        },
        {
            title: 'Type',
            key: 'type',
            render: (_, row) => formatEnumLabel(get(row, 'type')),
        },
        {
            title: 'Description',
            dataIndex: 'description',
            key: 'description',
        },
        {
            title: 'Debit',
            key: 'debit',
            align: 'right' as const,
            render: (_, row) => formatMoney(intl, get(row, 'debit'), get(header, 'currencyCode')),
        },
        {
            title: 'Credit',
            key: 'credit',
            align: 'right' as const,
            render: (_, row) => formatMoney(intl, get(row, 'credit'), get(header, 'currencyCode')),
        },
        {
            title: 'Running Balance',
            key: 'runningBalance',
            align: 'right' as const,
            render: (_, row) => formatMoney(intl, get(row, 'runningBalance'), get(header, 'currencyCode')),
        },
        {
            title: 'Reference',
            key: 'reference',
            render: (_, row) => get(row, 'reference') || '—',
        },
        {
            title: 'Status',
            key: 'status',
            render: (_, row) => get(row, 'status') ? <StatusTag status={get(row, 'status')} /> : '—',
        },
        {
            title: 'Linked Entity',
            key: 'linkedEntity',
            render: (_, row) => {
                const href = getLinkedEntityLink(row)
                if (href) {
                    return renderLink(get(row, 'linkedEntityType'), href)
                }

                return get(row, 'linkedEntityType') || '—'
            },
        },
        {
            title: 'Tenancy',
            key: 'occupancy',
            render: (_, row) => get(row, 'occupancyId') ? renderLink(get(row, 'occupancyId'), `/tenancy/${get(row, 'occupancyId')}`) : '—',
        },
    ]

    return (
        <PageWrapper>
            <PageHeader title={title} subTitle={subTitle} extra={extra} />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Card className={styles.filtersCard} title='Filters' size='small'>
                        <Space align='end' wrap size={16}>
                            <Space direction='vertical' size={8}>
                                <Typography.Text>Date Range</Typography.Text>
                                <DatePicker.RangePicker
                                    value={dateRange}
                                    onChange={(range) => setDateRange(range as DateRange)}
                                    allowEmpty={[true, true]}
                                />
                            </Space>
                            <Button type='secondary' onClick={() => {
                                setDateRange(null)
                                void refetch()
                            }}>
                                Clear Dates
                            </Button>
                        </Space>
                    </Card>

                    <Card title='Statement Header'>
                        <Row gutter={[24, 24]}>
                            <Col xs={24} md={8}>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Tenant: {get(header, 'tenantName') || getTenantName(header)}</Typography.Text>
                                    <Typography.Text>Phone: {get(header, 'tenantPhone') || '—'}</Typography.Text>
                                    <Typography.Text>Email: {get(header, 'tenantEmail') || '—'}</Typography.Text>
                                </Space>
                            </Col>
                            <Col xs={24} md={8}>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>
                                        Property: {get(header, 'propertyId')
                                            ? renderLink(get(header, 'propertyName') || get(header, 'propertyId'), `/property/${get(header, 'propertyId')}/rentals`)
                                            : get(header, 'propertyName') || '—'}
                                    </Typography.Text>
                                    <Typography.Text>
                                        Unit / Room / Bed: {get(header, 'rentalUnitId')
                                            ? renderLink(getRentalUnitName(intl, { id: get(header, 'rentalUnitId'), name: get(header, 'rentalUnitName') }), `/rentalUnit/${get(header, 'rentalUnitId')}`)
                                            : get(header, 'rentalUnitName') || '—'}
                                    </Typography.Text>
                                    <Typography.Text>
                                        Tenancy: {get(header, 'occupancyId')
                                            ? renderLink(get(header, 'occupancyId'), `/tenancy/${get(header, 'occupancyId')}`)
                                            : '—'}
                                    </Typography.Text>
                                </Space>
                            </Col>
                            <Col xs={24} md={8}>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Status: {get(header, 'occupancyStatus') ? <StatusTag status={get(header, 'occupancyStatus')} /> : '—'}</Typography.Text>
                                    <Typography.Text>Statement Period: {formatDate(get(header, 'statementPeriodStart'))} to {formatDate(get(header, 'statementPeriodEnd'))}</Typography.Text>
                                    <Typography.Text>Currency: {get(header, 'currencyCode') || 'GHS'}</Typography.Text>
                                </Space>
                            </Col>
                        </Row>
                    </Card>

                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={8}>
                            <Card className={styles.summaryCard} title='Movement'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Total Charges: {formatMoney(intl, get(summary, 'totalCharges'), get(header, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Total Payments: {formatMoney(intl, get(summary, 'totalPayments'), get(header, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Total Reversals: {formatMoney(intl, get(summary, 'totalReversals'), get(header, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Total Credits / Adjustments: {formatMoney(intl, get(summary, 'totalCreditsAdjustments'), get(header, 'currencyCode'))}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card className={styles.summaryCard} title='Balances'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Opening Balance: {formatMoney(intl, get(summary, 'openingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Closing Balance: {formatMoney(intl, get(summary, 'closingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Outstanding Balance: {formatMoney(intl, get(summary, 'outstandingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card className={styles.summaryCard} title='Notes'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Source of truth: posted ledger entries</Typography.Text>
                                    <Typography.Text>Running balance: {get(summary, 'runningBalanceAvailable') ? 'derived from ordered ledger entries' : 'not available'}</Typography.Text>
                                    <Typography.Text type='secondary'>Receipt and allocation rows are informational and do not mutate balances.</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                    </Row>

                    <Card title='Transactions'>
                        <Table rowKey='id' columns={columns} dataSource={rows} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}
