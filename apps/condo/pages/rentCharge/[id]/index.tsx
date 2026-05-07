import { useQuery } from '@apollo/client'
import { Card, Col, Row, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'
import React from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Space, Typography } from '@open-condo/ui'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { formatDate, formatMoney, getPropertyName, getRentalUnitName, getTenantName, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_RENT_CHARGE = gql`
    query getRentChargePage ($id: ID!) {
        rentCharge: RentCharge(where: { id: $id }) {
            id
            billingMonth
            periodStart
            periodEnd
            dueDate
            amount
            currencyCode
            status
            tenant { id user { id name phone } }
            occupancy { id }
            property { id address addressKey }
            rentalUnit { id name unitType }
            allocations(first: 50, sortBy: [allocatedAt_DESC], where: { deletedAt: null }) {
                id
                amount
                currencyCode
                allocatedAt
                payment { id status paymentMethod provider confirmedAt }
            }
            ledgerEntries(first: 50, sortBy: [postedAt_DESC], where: { deletedAt: null }) {
                id
                entryType
                direction
                amount
                currencyCode
                postedAt
                postingStatus
                description
            }
        }
    }
`

const RentChargePage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const { data, loading, error } = useQuery(GET_RENT_CHARGE, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Rent Charge' loading={loading} error={error?.message} />
    }

    const rentCharge = get(data, 'rentCharge')
    if (!rentCharge) {
        return <LoadingOrErrorPage title='Rent Charge' loading={false} error='Rent charge not found' />
    }

    const allocationColumns = [
        { title: 'Allocated At', key: 'allocatedAt', render: (_, allocation) => formatDate(get(allocation, 'allocatedAt')) },
        { title: 'Amount', key: 'amount', render: (_, allocation) => formatMoney(intl, get(allocation, 'amount'), get(allocation, 'currencyCode')) },
        { title: 'Payment', key: 'payment', render: (_, allocation) => renderLink(get(allocation, ['payment', 'id']) || '—', `/payment/${get(allocation, ['payment', 'id'])}`) },
        { title: 'Payment Status', key: 'status', render: (_, allocation) => <StatusTag status={get(allocation, ['payment', 'status'])} /> },
    ]

    const ledgerColumns = [
        { title: 'Posted At', key: 'postedAt', render: (_, entry) => formatDate(get(entry, 'postedAt')) },
        { title: 'Type', dataIndex: 'entryType', key: 'entryType' },
        { title: 'Direction', dataIndex: 'direction', key: 'direction' },
        { title: 'Amount', key: 'amount', render: (_, entry) => formatMoney(intl, get(entry, 'amount'), get(entry, 'currencyCode')) },
        { title: 'Posting Status', dataIndex: 'postingStatus', key: 'postingStatus' },
        { title: 'Description', dataIndex: 'description', key: 'description' },
    ]

    return (
        <PageWrapper>
            <PageHeader title={`Rent Charge ${rentCharge.id}`} subTitle='Rent charge detail' />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={12}>
                            <Card title='Charge Summary'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Tenant: {getTenantName(get(rentCharge, 'tenant'))}</Typography.Text>
                                    <Typography.Text>Property: {getPropertyName(get(rentCharge, 'property'))}</Typography.Text>
                                    <Typography.Text>Rental Unit: {getRentalUnitName(intl, get(rentCharge, 'rentalUnit'))}</Typography.Text>
                                    <Typography.Text>Billing Month: {formatDate(get(rentCharge, 'billingMonth'))}</Typography.Text>
                                    <Typography.Text>Amount: {formatMoney(intl, get(rentCharge, 'amount'), get(rentCharge, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Status: <StatusTag status={get(rentCharge, 'status')} /></Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={12}>
                            <Card title='Period'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Period Start: {formatDate(get(rentCharge, 'periodStart'))}</Typography.Text>
                                    <Typography.Text>Period End: {formatDate(get(rentCharge, 'periodEnd'))}</Typography.Text>
                                    <Typography.Text>Due Date: {formatDate(get(rentCharge, 'dueDate'))}</Typography.Text>
                                    <Typography.Text>Occupancy: {renderLink(get(rentCharge, ['occupancy', 'id']) || '—', `/occupancy/${get(rentCharge, ['occupancy', 'id'])}`)}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                    <Card title='Payment Allocations'>
                        <Table rowKey='id' columns={allocationColumns} dataSource={get(rentCharge, 'allocations', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Ledger Entries'>
                        <Table rowKey='id' columns={ledgerColumns} dataSource={get(rentCharge, 'ledgerEntries', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

RentChargePage.requiredAccess = OrganizationRequired

export default RentChargePage
