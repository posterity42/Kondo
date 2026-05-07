import { useQuery } from '@apollo/client'
import { Alert, Card, Col, Row, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'
import React from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { PageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { formatMoney, getPropertyName } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_RENTAL_UNIT = gql`
    query getRentalUnitPage ($id: ID!, $organizationId: ID!) {
        rentalUnit: RentalUnit(where: { id: $id }) {
            id
            name
            unitType
            rentable
            capacity
            defaultMonthlyRate
            property { id address addressKey }
            parent { id name unitType }
            children(where: { deletedAt: null }, first: 100, sortBy: [name_ASC]) {
                id
                name
                unitType
                rentable
                capacity
                defaultMonthlyRate
            }
        }
        occupancies: allOccupancies(
            where: { organization: { id: $organizationId }, rentalUnit: { id: $id }, deletedAt: null }
            first: 20
            sortBy: [createdAt_DESC]
        ) {
            id
            status
            startDate
            expectedEndDate
            actualEndDate
            monthlyRate
            tenant { id user { id name phone } }
        }
    }
`

const RentalUnitPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const id = get(query, 'id')
    const { data, loading, error } = useQuery(GET_RENTAL_UNIT, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Unit / Room / Bed' loading={loading} error={error?.message} />
    }

    const rentalUnit = get(data, 'rentalUnit')
    if (!rentalUnit) {
        return <LoadingOrErrorPage title='Unit / Room / Bed' loading={false} error='Unit, room, or bed not found' />
    }

    const childColumns = [
        {
            title: 'Child Unit / Room / Bed',
            dataIndex: 'name',
            key: 'name',
            render: (_, unit) => renderLink(get(unit, 'name') || unit.id, `/rentalUnit/${unit.id}`),
        },
        { title: 'Type', dataIndex: 'unitType', key: 'unitType' },
        { title: 'Rentable', dataIndex: 'rentable', key: 'rentable', render: value => value ? 'Yes' : 'No' },
        { title: 'Capacity', dataIndex: 'capacity', key: 'capacity' },
        { title: 'Default Monthly Rate', key: 'defaultMonthlyRate', render: (_, unit) => formatMoney(intl, get(unit, 'defaultMonthlyRate')) },
    ]

    const occupancyColumns = [
        {
            title: 'Tenant',
            key: 'tenant',
            render: (_, occupancy) => renderLink(get(occupancy, ['tenant', 'user', 'name']) || get(occupancy, ['tenant', 'user', 'phone']) || occupancy.id, `/tenant/${get(occupancy, ['tenant', 'id'])}`),
        },
        { title: 'Status', dataIndex: 'status', key: 'status' },
        { title: 'Start Date', dataIndex: 'startDate', key: 'startDate' },
        { title: 'Expected End', dataIndex: 'expectedEndDate', key: 'expectedEndDate' },
        { title: 'Actual End', dataIndex: 'actualEndDate', key: 'actualEndDate' },
        { title: 'Monthly Rate', key: 'monthlyRate', render: (_, occupancy) => formatMoney(intl, get(occupancy, 'monthlyRate')) },
    ]

    return (
        <PageWrapper>
            <PageHeader title={get(rentalUnit, 'name')} subTitle='Unit / Room / Bed detail' />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={12}>
                            <Card title='Structure'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Type: {get(rentalUnit, 'unitType')}</Typography.Text>
                                    <Typography.Text>Property: {getPropertyName(get(rentalUnit, 'property'))}</Typography.Text>
                                    <Typography.Text>Parent: {get(rentalUnit, ['parent', 'name']) || '—'}</Typography.Text>
                                    <Typography.Text>Rentable: {get(rentalUnit, 'rentable') ? 'Yes' : 'No'}</Typography.Text>
                                    <Typography.Text>Capacity: {get(rentalUnit, 'capacity') || '—'}</Typography.Text>
                                    <Typography.Text>Default Monthly Rate: {formatMoney(intl, get(rentalUnit, 'defaultMonthlyRate'))}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={12}>
                            <Alert
                                type='info'
                                showIcon
                                message='Hostel hierarchy'
                                description='Use parent and child units to model buildings, floors, rooms, and beds. Beds should be the rentable unit where billing happens per bed.'
                            />
                        </Col>
                    </Row>
                    <Card title='Child Units / Rooms / Beds'>
                        <Table rowKey='id' columns={childColumns} dataSource={get(rentalUnit, 'children', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Recent Tenancies'>
                        <Table rowKey='id' columns={occupancyColumns} dataSource={get(data, 'occupancies', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

RentalUnitPage.requiredAccess = OrganizationRequired

export default RentalUnitPage
