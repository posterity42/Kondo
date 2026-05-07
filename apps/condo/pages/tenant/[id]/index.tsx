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

const GET_TENANT = gql`
    query getTenantPage ($id: ID!, $organizationId: ID!) {
        tenant: Resident(where: { id: $id }) {
            id
            user { id name phone email }
            property { id address addressKey }
            currentOccupancy {
                id
                status
                startDate
                expectedEndDate
                actualEndDate
                monthlyRate
                billingFrequency
                rentalUnit { id name unitType }
            }
            ghanaCardNumber
            emergencyContactName
            emergencyContactPhone
            institutionName
            studentIdNumber
            programme
            level
        }
        rentCharges: allRentCharges(
            where: { organization: { id: $organizationId }, tenant: { id: $id }, deletedAt: null }
            sortBy: [billingMonth_DESC]
            first: 20
        ) {
            id
            billingMonth
            dueDate
            amount
            currencyCode
            status
            occupancy { id }
        }
        payments: allPayments(
            where: { organization: { id: $organizationId }, tenant: { id: $id }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: 20
        ) {
            id
            amount
            currencyCode
            paymentMethod
            provider
            status
            confirmedAt
            reversedAt
        }
        ledgers: allTenantLedgers(
            where: { organization: { id: $organizationId }, tenant: { id: $id }, deletedAt: null }
            first: 5
        ) {
            id
            currencyCode
            status
        }
    }
`

const TenantPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const { data, loading, error } = useQuery(GET_TENANT, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Tenant' loading={loading} error={error?.message} />
    }

    const tenant = get(data, 'tenant')
    if (!tenant) {
        return <LoadingOrErrorPage title='Tenant' loading={false} error='Tenant not found' />
    }

    const chargeColumns = [
        { title: 'Billing Month', key: 'billingMonth', render: (_, charge) => formatDate(get(charge, 'billingMonth')) },
        { title: 'Due Date', key: 'dueDate', render: (_, charge) => formatDate(get(charge, 'dueDate')) },
        { title: 'Amount', key: 'amount', render: (_, charge) => formatMoney(intl, get(charge, 'amount'), get(charge, 'currencyCode')) },
        { title: 'Status', key: 'status', render: (_, charge) => <StatusTag status={get(charge, 'status')} /> },
        { title: 'View', key: 'view', render: (_, charge) => renderLink('Open', `/rentCharge/${charge.id}`) },
    ]
    const paymentColumns = [
        { title: 'Amount', key: 'amount', render: (_, payment) => formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode')) },
        { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod' },
        { title: 'Provider', dataIndex: 'provider', key: 'provider' },
        { title: 'Confirmed At', key: 'confirmedAt', render: (_, payment) => formatDate(get(payment, 'confirmedAt')) },
        { title: 'Status', key: 'status', render: (_, payment) => <StatusTag status={get(payment, 'status')} /> },
        { title: 'View', key: 'view', render: (_, payment) => renderLink('Open', `/payment/${payment.id}`) },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title={getTenantName(tenant)}
                subTitle='Tenant detail'
                extra={[
                    renderLink('Statement', `/tenant/${tenant.id}/statement`),
                    get(tenant, ['currentOccupancy', 'id']) ? renderLink('Occupancy statement', `/occupancy/${get(tenant, ['currentOccupancy', 'id'])}/statement`) : null,
                ].filter(Boolean)}
            />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={8}>
                            <Card title='Tenant Profile'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Phone: {get(tenant, ['user', 'phone']) || '—'}</Typography.Text>
                                    <Typography.Text>Email: {get(tenant, ['user', 'email']) || '—'}</Typography.Text>
                                    <Typography.Text>Ghana Card: {get(tenant, 'ghanaCardNumber') || '—'}</Typography.Text>
                                    <Typography.Text>Emergency Contact: {get(tenant, 'emergencyContactName') || '—'}</Typography.Text>
                                    <Typography.Text>Emergency Phone: {get(tenant, 'emergencyContactPhone') || '—'}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Current Occupancy'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Property: {getPropertyName(get(tenant, 'property'))}</Typography.Text>
                                    <Typography.Text>Rental Unit: {get(tenant, 'currentOccupancy') ? renderLink(getRentalUnitName(intl, get(tenant, ['currentOccupancy', 'rentalUnit'])), `/occupancy/${get(tenant, ['currentOccupancy', 'id'])}`) : '—'}</Typography.Text>
                                    <Typography.Text>Status: <StatusTag status={get(tenant, ['currentOccupancy', 'status'])} /></Typography.Text>
                                    <Typography.Text>Billing Frequency: {get(tenant, ['currentOccupancy', 'billingFrequency']) || '—'}</Typography.Text>
                                    <Typography.Text>Monthly Rate: {formatMoney(intl, get(tenant, ['currentOccupancy', 'monthlyRate']))}</Typography.Text>
                                    <Typography.Text>Statement: {renderLink('Open tenant statement', `/tenant/${tenant.id}/statement`)}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Student / Hostel Data'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Institution: {get(tenant, 'institutionName') || '—'}</Typography.Text>
                                    <Typography.Text>Student ID: {get(tenant, 'studentIdNumber') || '—'}</Typography.Text>
                                    <Typography.Text>Programme: {get(tenant, 'programme') || '—'}</Typography.Text>
                                    <Typography.Text>Level: {get(tenant, 'level') || '—'}</Typography.Text>
                                    <Typography.Text>Ledgers: {get(data, 'ledgers', []).map(ledger => renderLink(ledger.id, `/ledger/${ledger.id}`)).reduce((prev, cur) => prev ? <>{prev}, {cur}</> : cur, null) || '—'}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Tenant Portal Activation'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>
                                        Tenant portal activation is not yet configured.
                                    </Typography.Text>
                                    <Typography.Text type='secondary'>
                                        Admin-created tenants keep their passwordless resident user until a dedicated activation flow is added.
                                    </Typography.Text>
                                    <Typography.Text type='secondary'>
                                        Portal route is reserved at `/resident/dashboard` for authenticated resident sessions only.
                                    </Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                    <Card title='Recent Rent Charges'>
                        <Table rowKey='id' columns={chargeColumns} dataSource={get(data, 'rentCharges', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Recent Payments'>
                        <Table rowKey='id' columns={paymentColumns} dataSource={get(data, 'payments', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

TenantPage.requiredAccess = OrganizationRequired

export default TenantPage
