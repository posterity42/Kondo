import { useMutation, useQuery } from '@apollo/client'
import { Button as AntButton, Card, Form, Input, InputNumber, Modal, Select, Space as AntSpace, Switch, Table, notification } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { DEFAULT_PAGE_SIZE, formatMoney, getPropertyName, matchesSearch, PageError } from '@condo/domains/property/components/RentalAdmin/utils'

const RENTAL_UNIT_FIELDS = `
    id
    name
    unitType
    rentable
    capacity
    defaultMonthlyRate
    property { id address addressKey }
    parent { id name unitType }
    children(where: { deletedAt: null }, first: 50, sortBy: [name_ASC]) { id name unitType rentable }
`

const GET_RENTAL_UNITS = gql`
    query getRentalUnitsPage ($organizationId: ID!) {
        rentalUnits: allRentalUnits(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            ${RENTAL_UNIT_FIELDS}
        }
        properties: allProperties(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [address_ASC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            address
            addressKey
        }
    }
`

const CREATE_RENTAL_UNIT = gql`
    mutation createRentalUnitFromAdminPage ($data: RentalUnitCreateInput!) {
        obj: createRentalUnit(data: $data) { id }
    }
`

const UPDATE_RENTAL_UNIT = gql`
    mutation updateRentalUnitFromAdminPage ($id: ID!, $data: RentalUnitUpdateInput!) {
        obj: updateRentalUnit(id: $id, data: $data) { id }
    }
`

const UNIT_TYPES = ['apartment', 'house', 'floor', 'room', 'bed']

const RentalUnitsPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization, link } = useOrganization()
    const organizationId = get(organization, 'id')
    const canManageProperties = get(link, ['role', 'canManageProperties'], false)
    const [form] = Form.useForm()
    const [selectedUnit, setSelectedUnit] = useState<Record<string, unknown> | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [propertyFilter, setPropertyFilter] = useState<string | undefined>()
    const [unitTypeFilter, setUnitTypeFilter] = useState<string | undefined>()
    const [rentableFilter, setRentableFilter] = useState<string>('all')

    const { data, loading, error, refetch } = useQuery(GET_RENTAL_UNITS, {
        variables: { organizationId },
        skip: !organizationId,
        fetchPolicy: 'cache-and-network',
    })
    const [createRentalUnit, createState] = useMutation(CREATE_RENTAL_UNIT)
    const [updateRentalUnit, updateState] = useMutation(UPDATE_RENTAL_UNIT)

    const rentalUnits = get(data, 'rentalUnits', [])
    const properties = get(data, 'properties', [])

    const propertyOptions = useMemo(() => properties.map(property => ({
        label: getPropertyName(property),
        value: property.id,
    })), [properties])

    const unitOptions = useMemo(() => rentalUnits.map(unit => ({
        label: `${get(unit, 'name')} (${get(unit, 'unitType')})`,
        value: unit.id,
    })), [rentalUnits])

    const filteredRentalUnits = useMemo(() => rentalUnits.filter(unit => {
        if (propertyFilter && get(unit, ['property', 'id']) !== propertyFilter) return false
        if (unitTypeFilter && get(unit, 'unitType') !== unitTypeFilter) return false
        if (rentableFilter === 'rentable' && !get(unit, 'rentable')) return false
        if (rentableFilter === 'not_rentable' && get(unit, 'rentable')) return false

        return matchesSearch(search, [
            get(unit, 'name'),
            get(unit, 'unitType'),
            get(unit, ['parent', 'name']),
            getPropertyName(get(unit, 'property')),
        ])
    }), [propertyFilter, rentableFilter, rentalUnits, search, unitTypeFilter])

    const handleOpenCreate = () => {
        setSelectedUnit(null)
        form.resetFields()
        form.setFieldsValue({ rentable: true, capacity: 1, unitType: 'room' })
        setIsModalOpen(true)
    }

    const handleOpenEdit = (unit) => {
        setSelectedUnit(unit)
        form.setFieldsValue({
            name: get(unit, 'name'),
            unitType: get(unit, 'unitType'),
            rentable: get(unit, 'rentable'),
            capacity: get(unit, 'capacity'),
            defaultMonthlyRate: get(unit, 'defaultMonthlyRate') ? Number(get(unit, 'defaultMonthlyRate')) : undefined,
            property: get(unit, ['property', 'id']),
            parent: get(unit, ['parent', 'id']),
        })
        setIsModalOpen(true)
    }

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const data = {
            dv: 1,
            sender: getClientSideSenderInfo(),
            organization: { connect: { id: organizationId } },
            property: { connect: { id: values.property } },
            ...(values.parent ? { parent: { connect: { id: values.parent } } } : {}),
            name: values.name,
            unitType: values.unitType,
            rentable: values.rentable,
            capacity: values.capacity,
            ...(values.defaultMonthlyRate ? { defaultMonthlyRate: String(values.defaultMonthlyRate) } : {}),
        }

        if (selectedUnit?.id) {
            await updateRentalUnit({ variables: { id: selectedUnit.id, data } })
            notification.success({ message: 'Rental Unit updated' })
        } else {
            await createRentalUnit({ variables: { data } })
            notification.success({ message: 'Rental Unit created' })
        }

        setIsModalOpen(false)
        await refetch()
    }

    const columns = [
        {
            title: 'Rental Unit',
            dataIndex: 'name',
            key: 'name',
            render: (_, unit) => renderLink(get(unit, 'name') || unit.id, `/rentalUnit/${unit.id}`),
        },
        {
            title: 'Type',
            dataIndex: 'unitType',
            key: 'unitType',
        },
        {
            title: 'Property',
            key: 'property',
            render: (_, unit) => getPropertyName(get(unit, 'property')),
        },
        {
            title: 'Parent',
            key: 'parent',
            render: (_, unit) => get(unit, ['parent', 'name']) || '—',
        },
        {
            title: 'Rentable',
            dataIndex: 'rentable',
            key: 'rentable',
            render: (value) => value ? 'Yes' : 'No',
        },
        {
            title: 'Capacity',
            dataIndex: 'capacity',
            key: 'capacity',
        },
        {
            title: 'Default Monthly Rate',
            key: 'defaultMonthlyRate',
            render: (_, unit) => formatMoney(intl, get(unit, 'defaultMonthlyRate')),
        },
        {
            title: 'Children',
            key: 'children',
            render: (_, unit) => get(unit, 'children', []).length,
        },
        ...(canManageProperties ? [{
            title: 'Actions',
            key: 'actions',
            render: (_, unit) => (
                <AntButton type='link' onClick={() => handleOpenEdit(unit)}>
                    Edit
                </AntButton>
            ),
        }] : []),
    ]

    const modalLoading = createState.loading || updateState.loading

    return (
        <PageWrapper>
            <PageHeader
                title='Rental Units'
                subTitle='Rooms, beds, apartments, floors, and other rentable structures'
                extra={canManageProperties ? [
                    <Button key='create-rental-unit' type='primary' onClick={handleOpenCreate}>Add Rental Unit</Button>,
                ] : []}
            />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        Showing the latest {DEFAULT_PAGE_SIZE} rental units scoped to your organisation.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder='Search by rental unit, type, parent, or property' />
                            <Space wrap>
                                <Select allowClear showSearch placeholder='Property' value={propertyFilter} onChange={setPropertyFilter} options={propertyOptions} style={{ minWidth: 220 }} />
                                <Select allowClear placeholder='Unit Type' value={unitTypeFilter} onChange={setUnitTypeFilter} options={UNIT_TYPES.map(value => ({ label: value, value }))} style={{ minWidth: 180 }} />
                                <Select value={rentableFilter} onChange={setRentableFilter} options={[
                                    { label: 'All units', value: 'all' },
                                    { label: 'Rentable only', value: 'rentable' },
                                    { label: 'Non-rentable only', value: 'not_rentable' },
                                ]} style={{ minWidth: 180 }} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table
                        rowKey='id'
                        loading={loading}
                        columns={columns}
                        dataSource={filteredRentalUnits}
                        pagination={false}
                        scroll={{ x: true }}
                    />
                </Space>
            </TablePageContent>
            <Modal
                destroyOnClose
                open={isModalOpen}
                title={selectedUnit ? 'Edit Rental Unit' : 'Create Rental Unit'}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSubmit}
                confirmLoading={modalLoading}
            >
                <Form form={form} layout='vertical'>
                    <Form.Item name='property' label='Property' rules={[{ required: true, message: 'Select a property' }]}>
                        <Select options={propertyOptions} showSearch />
                    </Form.Item>
                    <Form.Item name='parent' label='Parent Rental Unit'>
                        <Select allowClear options={unitOptions.filter(option => option.value !== selectedUnit?.id)} showSearch />
                    </Form.Item>
                    <Form.Item name='name' label='Name' rules={[{ required: true, message: 'Enter the rental unit name' }]}>
                        <Input placeholder='Room A1 / Bed 01 / Flat 2B' />
                    </Form.Item>
                    <Form.Item name='unitType' label='Type' rules={[{ required: true, message: 'Select a unit type' }]}>
                        <Select options={UNIT_TYPES.map(value => ({ label: value, value }))} />
                    </Form.Item>
                    <AntSpace size={16} style={{ display: 'flex' }}>
                        <Form.Item name='capacity' label='Capacity' rules={[{ required: true, message: 'Enter capacity' }]} style={{ flex: 1 }}>
                            <InputNumber min={1} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name='defaultMonthlyRate' label='Default Monthly Rate (GHS)' style={{ flex: 1 }}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    </AntSpace>
                    <Form.Item name='rentable' label='Rentable' valuePropName='checked'>
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </PageWrapper>
    )
}

RentalUnitsPage.requiredAccess = OrganizationRequired

export default RentalUnitsPage
