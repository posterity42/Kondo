import { useMutation, useQuery } from '@apollo/client'
import { Button as AntButton, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space as AntSpace, Table, notification } from 'antd'
import dayjs from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Link from 'next/link'
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
import {
    DEFAULT_PAGE_SIZE,
    PageError,
    formatDate,
    formatMoney,
    getPropertyName,
    getRentalUnitName,
    getTenantName,
    isDateInRange,
    matchesSearch,
    StatusTag,
} from '@condo/domains/property/components/RentalAdmin/utils'
import { getOccupancyLifecycleActions } from '@condo/domains/property/components/Rentals/utils'

const OCCUPANCY_FIELDS = `
    id
    status
    startDate
    expectedEndDate
    actualEndDate
    billingFrequency
    monthlyRate
    tenant { id user { id name phone email } }
    property { id address addressKey }
    rentalUnit { id name unitType capacity defaultMonthlyRate parent { id name unitType } }
`

const GET_OCCUPANCIES = gql`
    query getOccupanciesPage ($organizationId: ID!) {
        occupancies: allOccupancies(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            ${OCCUPANCY_FIELDS}
        }
        tenants: allResidents(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            user { id name phone email }
            currentOccupancy { id status rentalUnit { id name unitType } property { id address addressKey } }
        }
        rentalUnits: allRentalUnits(
            where: { organization: { id: $organizationId }, deletedAt: null, rentable: true }
            sortBy: [name_ASC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            name
            unitType
            defaultMonthlyRate
            property { id address addressKey }
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
        ledgers: allTenantLedgers(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            tenant { id }
        }
    }
`

const RENEW_OCCUPANCY = gql`
    mutation renewOccupancyFromOccupancyPage ($data: RenewOccupancyInput!) {
        obj: renewOccupancy(data: $data) { id }
    }
`

const CHECK_OUT_OCCUPANCY = gql`
    mutation checkOutOccupancyFromOccupancyPage ($data: CheckOutOccupancyInput!) {
        result: checkOutOccupancy(data: $data) {
            occupancy { id }
            arrears { amount currencyCode chargeCount }
        }
    }
`

const TRANSFER_OCCUPANCY = gql`
    mutation transferOccupancyFromOccupancyPage ($data: TransferOccupancyInput!) {
        result: transferOccupancy(data: $data) {
            newOccupancy { id }
            previousArrears { amount currencyCode chargeCount }
        }
    }
`

const CANCEL_OCCUPANCY = gql`
    mutation cancelOccupancyFromOccupancyPage ($data: CancelOccupancyInput!) {
        obj: cancelOccupancy(data: $data) { id }
    }
`

type ActionState = {
    type: 'renew' | 'checkOut' | 'transfer' | 'cancel'
    occupancy?: Record<string, unknown>
} | null

const OccupanciesPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization, link } = useOrganization()
    const organizationId = get(organization, 'id')
    const canManageProperties = get(link, ['role', 'canManageProperties'], false)
    const [form] = Form.useForm()
    const [actionState, setActionState] = useState<ActionState>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const [propertyFilter, setPropertyFilter] = useState<string | undefined>()
    const [tenantFilter, setTenantFilter] = useState<string | undefined>()
    const [rentalUnitFilter, setRentalUnitFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)

    const { data, loading, error, refetch } = useQuery(GET_OCCUPANCIES, {
        variables: { organizationId },
        skip: !organizationId,
        fetchPolicy: 'cache-and-network',
    })
    const [renewOccupancy, renewState] = useMutation(RENEW_OCCUPANCY)
    const [checkOutOccupancy, checkOutState] = useMutation(CHECK_OUT_OCCUPANCY)
    const [transferOccupancy, transferState] = useMutation(TRANSFER_OCCUPANCY)
    const [cancelOccupancy, cancelState] = useMutation(CANCEL_OCCUPANCY)

    const occupancies = get(data, 'occupancies', [])
    const rentalUnits = get(data, 'rentalUnits', [])
    const properties = get(data, 'properties', [])
    const tenants = get(data, 'tenants', [])
    const ledgers = get(data, 'ledgers', [])

    const propertyOptions = useMemo(() => properties.map(property => ({
        label: getPropertyName(property),
        value: property.id,
    })), [properties])

    const tenantOptions = useMemo(() => tenants.map(tenant => ({
        label: getTenantName(tenant),
        value: tenant.id,
    })), [tenants])

    const rentalUnitOptions = useMemo(() => rentalUnits.map(unit => ({
        label: `${get(unit, 'name')} (${getPropertyName(get(unit, 'property'))})`,
        value: unit.id,
    })), [rentalUnits])

    const ledgerByTenantId = useMemo(() => ledgers.reduce((map, ledger) => {
        const tenantId = get(ledger, ['tenant', 'id'])
        if (tenantId && !map[tenantId]) map[tenantId] = ledger
        return map
    }, {}), [ledgers])

    const filteredOccupancies = useMemo(() => {
        const [startDate, endDate] = dateRange || []

        return occupancies.filter(occupancy => {
            if (statusFilter && get(occupancy, 'status') !== statusFilter) return false
            if (propertyFilter && get(occupancy, ['property', 'id']) !== propertyFilter) return false
            if (tenantFilter && get(occupancy, ['tenant', 'id']) !== tenantFilter) return false
            if (rentalUnitFilter && get(occupancy, ['rentalUnit', 'id']) !== rentalUnitFilter) return false
            if (!isDateInRange(get(occupancy, 'startDate'), startDate, endDate) && !isDateInRange(get(occupancy, 'expectedEndDate'), startDate, endDate)) return false

            return matchesSearch(search, [
                getTenantName(get(occupancy, 'tenant')),
                get(occupancy, ['tenant', 'user', 'phone']),
                getPropertyName(get(occupancy, 'property')),
                get(occupancy, ['rentalUnit', 'name']),
                get(occupancy, ['rentalUnit', 'unitType']),
                get(occupancy, 'status'),
            ])
        })
    }, [dateRange, occupancies, propertyFilter, rentalUnitFilter, search, statusFilter, tenantFilter])

    const openAction = (type, occupancy?) => {
        setActionState({ type, occupancy })
        form.resetFields()
        form.setFieldsValue({
            expectedEndDate: get(occupancy, 'expectedEndDate') ? dayjs(get(occupancy, 'expectedEndDate')) : undefined,
            actualEndDate: dayjs(),
            monthlyRate: get(occupancy, 'monthlyRate') ? Number(get(occupancy, 'monthlyRate')) : undefined,
            billingFrequency: get(occupancy, 'billingFrequency'),
            targetRentalUnitId: undefined,
            createFinalCharges: true,
            transferDate: dayjs(),
        })
    }

    const closeAction = () => {
        setActionState(null)
        form.resetFields()
    }

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const sender = getClientSideSenderInfo()

        if (actionState?.type === 'renew') {
            await renewOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: actionState.occupancy?.id,
                        expectedEndDate: values.expectedEndDate?.toISOString(),
                        monthlyRate: values.monthlyRate ? String(values.monthlyRate) : undefined,
                        billingFrequency: values.billingFrequency,
                    },
                },
            })
            notification.success({ message: 'Tenancy renewed' })
        }

        if (actionState?.type === 'checkOut') {
            const result = await checkOutOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: actionState.occupancy?.id,
                        actualEndDate: values.actualEndDate?.toISOString(),
                        createFinalCharges: values.createFinalCharges,
                    },
                },
            })
            const arrears = get(result, ['data', 'result', 'arrears'])
            notification.success({ message: `Tenancy checked out${arrears ? ` with arrears ${arrears.amount} ${arrears.currencyCode}` : ''}` })
        }

        if (actionState?.type === 'transfer') {
            await transferOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: actionState.occupancy?.id,
                        targetRentalUnitId: values.targetRentalUnitId,
                        transferDate: values.transferDate?.toISOString(),
                        expectedEndDate: values.expectedEndDate?.toISOString(),
                        monthlyRate: values.monthlyRate ? String(values.monthlyRate) : undefined,
                        billingFrequency: values.billingFrequency,
                        createFinalCharges: values.createFinalCharges,
                    },
                },
            })
            notification.success({ message: 'Tenancy transferred' })
        }

        if (actionState?.type === 'cancel') {
            await cancelOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: actionState.occupancy?.id,
                    },
                },
            })
            notification.success({ message: 'Tenancy canceled' })
        }

        closeAction()
        await refetch()
    }

    const columns = [
        {
            title: 'Tenant',
            key: 'tenant',
            render: (_, occupancy) => renderLink(getTenantName(get(occupancy, 'tenant')), `/tenant/${get(occupancy, ['tenant', 'id'])}`),
        },
        {
            title: 'Property',
            key: 'property',
            render: (_, occupancy) => getPropertyName(get(occupancy, 'property')),
        },
        {
            title: 'Unit / Room / Bed',
            key: 'rentalUnit',
            render: (_, occupancy) => renderLink(getRentalUnitName(intl, get(occupancy, 'rentalUnit')), `/rentalUnit/${get(occupancy, ['rentalUnit', 'id'])}`),
        },
        { title: 'Start Date', key: 'startDate', render: (_, occupancy) => formatDate(get(occupancy, 'startDate')) },
        { title: 'Expected End', key: 'expectedEndDate', render: (_, occupancy) => formatDate(get(occupancy, 'expectedEndDate')) },
        { title: 'Actual End', key: 'actualEndDate', render: (_, occupancy) => formatDate(get(occupancy, 'actualEndDate')) },
        { title: 'Status', key: 'status', render: (_, occupancy) => <StatusTag status={get(occupancy, 'status')} /> },
        { title: 'Billing Frequency', dataIndex: 'billingFrequency', key: 'billingFrequency' },
        { title: 'Monthly Rate', key: 'monthlyRate', render: (_, occupancy) => formatMoney(intl, get(occupancy, 'monthlyRate')) },
        {
            title: 'Quick Actions',
            key: 'quickActions',
            render: (_, occupancy) => {
                const tenantId = get(occupancy, ['tenant', 'id'])
                const ledger = ledgerByTenantId[tenantId]

                return (
                    <AntSpace wrap>
                        {renderLink('View tenancy', `/tenancy/${occupancy.id}`)}
                        {renderLink('View tenant', `/tenant/${tenantId}`)}
                        {ledger ? renderLink('View ledger', `/ledger/${ledger.id}`) : <Typography.Text type='secondary'>No ledger</Typography.Text>}
                        {renderLink('Record payment', `/payment?mode=record&tenantId=${tenantId}&occupancyId=${occupancy.id}&propertyId=${get(occupancy, ['property', 'id'])}&rentalUnitId=${get(occupancy, ['rentalUnit', 'id'])}`)}
                    </AntSpace>
                )
            },
        },
        ...(canManageProperties ? [{
            title: 'Lifecycle',
            key: 'actions',
            render: (_, occupancy) => (
                <AntSpace wrap>
                    {getOccupancyLifecycleActions(get(occupancy, 'status'), canManageProperties)
                        .filter(action => action !== 'checkIn')
                        .map(action => (
                            <AntButton key={action} type='link' onClick={() => openAction(action, occupancy)}>
                                {action}
                            </AntButton>
                        ))}
                </AntSpace>
            ),
        }] : []),
    ]

    const isModalOpen = !!actionState
    const modalLoading = renewState.loading || checkOutState.loading || transferState.loading || cancelState.loading

    return (
        <PageWrapper>
            <PageHeader
                title='Tenancies'
                subTitle='Check-ins, active stays, renewals, transfers, and check-outs'
                extra={canManageProperties ? [
                    <Link key='check-in-wizard' href='/tenancy/check-in'>
                        <Button type='primary'>Check In Tenant</Button>
                    </Link>,
                ] : []}
            />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        Active and historical tenancy agreements for units, rooms, and beds in your organisation.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <AntSpace direction='vertical' size={12} style={{ width: '100%' }}>
                            <Input
                                allowClear
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                placeholder='Search by tenant, property, unit, phone, or status'
                            />
                            <AntSpace wrap>
                                <Select allowClear placeholder='Status' value={statusFilter} options={[
                                    { label: 'planned', value: 'planned' },
                                    { label: 'active', value: 'active' },
                                    { label: 'ended', value: 'ended' },
                                    { label: 'canceled', value: 'canceled' },
                                ]} onChange={setStatusFilter} style={{ minWidth: 180 }} />
                                <Select allowClear showSearch placeholder='Property' value={propertyFilter} options={propertyOptions} onChange={setPropertyFilter} style={{ minWidth: 220 }} />
                                <Select allowClear showSearch placeholder='Tenant' value={tenantFilter} options={tenantOptions} onChange={setTenantFilter} style={{ minWidth: 220 }} />
                                <Select allowClear showSearch placeholder='Unit / Room / Bed' value={rentalUnitFilter} options={rentalUnitOptions} onChange={setRentalUnitFilter} style={{ minWidth: 220 }} />
                                <DatePicker.RangePicker value={dateRange || undefined} onChange={value => setDateRange(value as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)} />
                            </AntSpace>
                        </AntSpace>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredOccupancies} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
            <Modal
                destroyOnClose
                open={isModalOpen}
                title={`Tenancy ${actionState?.type}`}
                onCancel={closeAction}
                onOk={handleSubmit}
                confirmLoading={modalLoading}
            >
                <Form form={form} layout='vertical'>
                    {actionState?.type === 'renew' && (
                        <>
                            <Typography.Paragraph type='secondary'>
                                Review the updated end date and pricing terms before renewing this tenancy.
                            </Typography.Paragraph>
                            <Form.Item name='expectedEndDate' label='New Expected End Date' rules={[{ required: true, message: 'Select a new end date' }]}>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='billingFrequency' label='Billing Frequency' style={{ flex: 1 }}>
                                    <Select options={[{ label: 'monthly', value: 'monthly' }, { label: 'annual', value: 'annual' }]} />
                                </Form.Item>
                                <Form.Item name='monthlyRate' label='Monthly Rate (GHS)' style={{ flex: 1 }}>
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                        </>
                    )}
                    {actionState?.type === 'checkOut' && (
                        <>
                            <Typography.Paragraph type='secondary'>
                                This action uses the existing checkout service and can optionally create final rent charges from backend logic.
                            </Typography.Paragraph>
                            <Form.Item name='actualEndDate' label='Actual End Date' rules={[{ required: true, message: 'Select check-out date' }]}>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name='createFinalCharges' valuePropName='checked'>
                                <Checkbox>Create final charges during check-out</Checkbox>
                            </Form.Item>
                        </>
                    )}
                    {actionState?.type === 'transfer' && (
                        <>
                            <Typography.Paragraph type='secondary'>
                                Transfer keeps existing accounting services in place and moves the tenant to a different unit, room, or bed.
                            </Typography.Paragraph>
                            <Form.Item name='targetRentalUnitId' label='Target Unit / Room / Bed' rules={[{ required: true, message: 'Select the destination unit' }]}>
                                <Select showSearch options={rentalUnitOptions.filter(option => option.value !== get(actionState, ['occupancy', 'rentalUnit', 'id']))} />
                            </Form.Item>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='transferDate' label='Transfer Date' rules={[{ required: true, message: 'Select transfer date' }]} style={{ flex: 1 }}>
                                    <DatePicker style={{ width: '100%' }} />
                                </Form.Item>
                                <Form.Item name='expectedEndDate' label='Expected End Date' style={{ flex: 1 }}>
                                    <DatePicker style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='billingFrequency' label='Billing Frequency' style={{ flex: 1 }}>
                                    <Select options={[{ label: 'monthly', value: 'monthly' }, { label: 'annual', value: 'annual' }]} />
                                </Form.Item>
                                <Form.Item name='monthlyRate' label='Monthly Rate (GHS)' style={{ flex: 1 }}>
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                            <Form.Item name='createFinalCharges' valuePropName='checked'>
                                <Checkbox>Create final charges during transfer</Checkbox>
                            </Form.Item>
                        </>
                    )}
                    {actionState?.type === 'cancel' && (
                        <Typography.Text type='secondary'>
                            This cancels a planned tenancy.
                        </Typography.Text>
                    )}
                </Form>
            </Modal>
        </PageWrapper>
    )
}

OccupanciesPage.requiredAccess = OrganizationRequired

export default OccupanciesPage
