import { useQuery } from '@apollo/client'
import { Card, DatePicker, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Head from 'next/head'
import Link from 'next/link'
import React, { useMemo, useState } from 'react'

import { useAuth } from '@open-condo/next/auth'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { ResidentPortalRequired } from '@condo/domains/resident/components/ResidentPortalRequired'

import type { Dayjs } from 'dayjs'

const GET_RESIDENT_STATEMENT_SCOPE = gql`
    query getResidentStatementScope ($userId: ID!) {
        residents: allResidents(
            where: { user: { id: $userId }, deletedAt: null }
            sortBy: [createdAt_ASC]
            first: 10
        ) {
            id
            organization { id }
            currentOccupancy { id }
        }
    }
`

const GET_RESIDENT_STATEMENT = gql`
    query getResidentStatementPage ($data: GetTenantStatementInput!) {
        result: getTenantStatement(data: $data) {
            header {
                tenantName
                tenantPhone
                tenantEmail
                propertyName
                rentalUnitName
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
            }
            rows {
                id
                date
                type
                description
                debit
                credit
                runningBalance
                reference
                status
            }
        }
    }
`

type DateRange = [Dayjs | null, Dayjs | null] | null

function formatDateValue (value?: string | null): string {
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

const ResidentStatementPage: PageComponentType = () => {
    const { user } = useAuth()
    const userId = get(user, 'id')
    const [dateRange, setDateRange] = useState<DateRange>(null)
    const [start, end] = dateRange || [null, null]

    const {
        data: scopeData,
        loading: scopeLoading,
        error: scopeError,
    } = useQuery(GET_RESIDENT_STATEMENT_SCOPE, {
        variables: { userId },
        skip: !userId,
    })

    const residents = get(scopeData, 'residents', [])
    const primaryResident = useMemo(() => {
        return residents.find(resident => get(resident, 'currentOccupancy')) || residents[0] || null
    }, [residents])

    const variables = useMemo(() => {
        const residentId = get(primaryResident, 'id')
        const organizationId = get(primaryResident, ['organization', 'id'])

        if (!residentId || !organizationId) return null

        return {
            data: {
                dv: 1,
                sender: { dv: 1, fingerprint: 'resident-statement-page' },
                organization: { id: organizationId },
                tenant: { id: residentId },
                ...(start ? { dateFrom: start.format('YYYY-MM-DD') } : {}),
                ...(end ? { dateTo: end.format('YYYY-MM-DD') } : {}),
            },
        }
    }, [end, primaryResident, start])

    const {
        data,
        loading,
        error,
        refetch,
    } = useQuery(GET_RESIDENT_STATEMENT, {
        variables,
        skip: !variables,
    })

    if (scopeLoading || loading) {
        return <LoadingOrErrorPage title='Statement' loading={true} />
    }

    if (scopeError || error) {
        return <LoadingOrErrorPage title='Statement' loading={false} error={scopeError?.message || error?.message} />
    }

    const statement = get(data, 'result')
    if (!statement) {
        return <LoadingOrErrorPage title='Statement' loading={false} error='Statement is unavailable for this account.' />
    }

    const header = statement.header
    const summary = statement.summary
    const rows = statement.rows || []

    const columns = [
        {
            title: 'Date',
            key: 'date',
            render: (_, row) => formatDateValue(get(row, 'date')),
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
            title: 'Debit',
            key: 'debit',
            render: (_, row) => formatMoneyValue(get(row, 'debit'), get(header, 'currencyCode')),
        },
        {
            title: 'Credit',
            key: 'credit',
            render: (_, row) => formatMoneyValue(get(row, 'credit'), get(header, 'currencyCode')),
        },
        {
            title: 'Balance',
            key: 'runningBalance',
            render: (_, row) => formatMoneyValue(get(row, 'runningBalance'), get(header, 'currencyCode')),
        },
        {
            title: 'Reference',
            key: 'reference',
            render: (_, row) => get(row, 'reference') || '—',
        },
        {
            title: 'Status',
            key: 'status',
            render: (_, row) => get(row, 'status') || '—',
        },
    ]

    return (
        <>
            <Head>
                <title>Tenant Statement</title>
            </Head>
            <PageWrapper>
                <PageHeader
                    title='Tenant Statement'
                    subTitle='Your ledger-backed rent statement'
                    extra={[
                        <Link key='back' href='/resident/dashboard'>
                            <Button type='secondary'>Back to Portal</Button>
                        </Link>,
                        <Button key='print' type='secondary' onClick={() => window.print()}>
                            Print
                        </Button>,
                    ]}
                />
                <PageContent>
                    <Space direction='vertical' size={24} width='100%'>
                        <Card title='Filters' size='small'>
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

                        <Card title='Statement Summary'>
                            <Space direction='vertical' size={8}>
                                <Typography.Text>Tenant: {get(header, 'tenantName') || '—'}</Typography.Text>
                                <Typography.Text>Phone: {get(header, 'tenantPhone') || '—'}</Typography.Text>
                                <Typography.Text>Email: {get(header, 'tenantEmail') || '—'}</Typography.Text>
                                <Typography.Text>Property: {get(header, 'propertyName') || '—'}</Typography.Text>
                                <Typography.Text>Rental Unit: {get(header, 'rentalUnitName') || '—'}</Typography.Text>
                                <Typography.Text>Occupancy Status: {get(header, 'occupancyStatus') || '—'}</Typography.Text>
                                <Typography.Text>Opening Balance: {formatMoneyValue(get(summary, 'openingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                                <Typography.Text>Closing Balance: {formatMoneyValue(get(summary, 'closingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                                <Typography.Text>Outstanding Balance: {formatMoneyValue(get(summary, 'outstandingBalance'), get(header, 'currencyCode'))}</Typography.Text>
                            </Space>
                        </Card>

                        <Card title='Statement Rows'>
                            <Table
                                rowKey='id'
                                columns={columns}
                                dataSource={rows}
                                pagination={false}
                                scroll={{ x: true }}
                            />
                        </Card>
                    </Space>
                </PageContent>
            </PageWrapper>
        </>
    )
}

ResidentStatementPage.requiredAccess = ResidentPortalRequired

export default ResidentStatementPage
