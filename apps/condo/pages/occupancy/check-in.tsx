import { useMutation, useQuery } from '@apollo/client'
import { Alert, Card, DatePicker, Descriptions, Form, Input, InputNumber, Select, Space as AntSpace, Steps, notification } from 'antd'
import dayjs from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Link from 'next/link'
import { useRouter } from 'next/router'
import React, { useEffect, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { PageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
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
    matchesSearch,
} from '@condo/domains/property/components/RentalAdmin/utils'

const GET_CHECK_IN_WIZARD = gql`
    query getOccupancyCheckInWizard ($organizationId: ID!) {
        tenants: allResidents(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            user { id name phone email }
            ghanaCardNumber
            currentOccupancy {
                id
                status
                property { id address addressKey }
                rentalUnit { id name unitType }
            }
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
        rentalUnits: allRentalUnits(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [name_ASC]
            first: 300
        ) {
            id
            name
            unitType
            rentable
            capacity
            defaultMonthlyRate
            property { id address addressKey }
            parent { id name unitType }
        }
        activeOccupancies: allOccupancies(
            where: { organization: { id: $organizationId }, deletedAt: null, status_in: [planned, active] }
            sortBy: [createdAt_DESC]
            first: 300
        ) {
            id
            status
            tenant { id user { id name phone } }
            property { id address addressKey }
            rentalUnit { id name unitType }
        }
    }
`

const CHECK_IN_OCCUPANCY = gql`
    mutation checkInOccupancyFromWizard ($data: CheckInOccupancyInput!) {
        result: checkInOccupancy(data: $data) {
            occupancy { id }
            rentChargeGeneration { createdCount invoiceId }
        }
    }
`

const BILLING_FREQUENCY_OPTIONS = [
    { label: 'Monthly', value: 'monthly' },
    { label: 'Annual', value: 'annual' },
]

const OccupancyCheckInWizardPage: PageComponentType = () => {
    const intl = useIntl()
    const router = useRouter()
    const { organization, link } = useOrganization()
    const organizationId = get(organization, 'id')
    const canManageProperties = get(link, ['role', 'canManageProperties'], false)
    const canManageResidents = get(link, ['role', 'canManageResidents'], false)
    const [form] = Form.useForm()
    const [currentStep, setCurrentStep] = useState(0)
    const [tenantSearch, setTenantSearch] = useState('')
    const [unitSearch, setUnitSearch] = useState('')

    const { data, loading, error } = useQuery(GET_CHECK_IN_WIZARD, {
        variables: { organizationId },
        skip: !organizationId,
        fetchPolicy: 'cache-and-network',
    })
    const [checkInOccupancy, checkInState] = useMutation(CHECK_IN_OCCUPANCY)

    const tenants = get(data, 'tenants', [])
    const properties = get(data, 'properties', [])
    const rentalUnits = get(data, 'rentalUnits', [])
    const activeOccupancies = get(data, 'activeOccupancies', [])

    const tenantId = Form.useWatch('tenantId', form)
    const propertyId = Form.useWatch('propertyId', form)
    const rentalUnitId = Form.useWatch('rentalUnitId', form)

    const selectedTenant = useMemo(() => tenants.find(tenant => tenant.id === tenantId), [tenantId, tenants])
    const selectedProperty = useMemo(() => properties.find(property => property.id === propertyId), [properties, propertyId])
    const selectedRentalUnit = useMemo(() => rentalUnits.find(rentalUnit => rentalUnit.id === rentalUnitId), [rentalUnitId, rentalUnits])

    const activeOccupancyByRentalUnitId = useMemo(() => {
        return activeOccupancies.reduce((map, occupancy) => {
            const unitId = get(occupancy, ['rentalUnit', 'id'])
            if (unitId && !map[unitId]) map[unitId] = occupancy
            return map
        }, {})
    }, [activeOccupancies])

    useEffect(() => {
        const nextTenantId = typeof router.query.tenantId === 'string' ? router.query.tenantId : undefined
        const nextPropertyId = typeof router.query.propertyId === 'string' ? router.query.propertyId : undefined
        const nextValues: Record<string, string> = {}

        if (nextTenantId) {
            nextValues.tenantId = nextTenantId
        }
        if (nextPropertyId) {
            nextValues.propertyId = nextPropertyId
        }

        if (Object.keys(nextValues).length > 0) {
            form.setFieldsValue(nextValues)
        }
    }, [form, router.query.propertyId, router.query.tenantId])

    const tenantOptions = useMemo(() => tenants
        .filter(tenant => matchesSearch(tenantSearch, [
            getTenantName(tenant),
            get(tenant, ['user', 'phone']),
            get(tenant, ['user', 'email']),
            get(tenant, 'ghanaCardNumber'),
        ]))
        .map(tenant => ({
            label: `${getTenantName(tenant)}${get(tenant, ['user', 'phone']) ? ` • ${get(tenant, ['user', 'phone'])}` : ''}`,
            value: tenant.id,
        })), [tenantSearch, tenants])

    const propertyOptions = useMemo(() => properties.map(property => ({
        label: getPropertyName(property),
        value: property.id,
    })), [properties])

    const propertyRentalUnits = useMemo(() => rentalUnits
        .filter(rentalUnit => get(rentalUnit, ['property', 'id']) === propertyId)
        .filter(rentalUnit => matchesSearch(unitSearch, [
            get(rentalUnit, 'name'),
            get(rentalUnit, 'unitType'),
            get(rentalUnit, ['parent', 'name']),
        ]))
        .map(rentalUnit => {
            const activeOccupancy = activeOccupancyByRentalUnitId[rentalUnit.id]
            const isRentable = get(rentalUnit, 'rentable', false)
            const isOccupied = Boolean(activeOccupancy)
            const parentName = get(rentalUnit, ['parent', 'name'])
            const labelParts = [
                parentName ? `${parentName} → ${get(rentalUnit, 'name')}` : get(rentalUnit, 'name'),
                get(rentalUnit, 'unitType'),
                isRentable ? 'rentable' : 'not rentable',
                isOccupied ? `occupied by ${getTenantName(get(activeOccupancy, 'tenant'))}` : 'available',
            ]

            return {
                activeOccupancy,
                disabled: !isRentable || isOccupied,
                label: labelParts.filter(Boolean).join(' • '),
                unit: rentalUnit,
                value: rentalUnit.id,
            }
        }), [activeOccupancyByRentalUnitId, propertyId, rentalUnits, unitSearch])

    const goNext = async () => {
        const fieldGroups = [
            ['tenantId'],
            ['propertyId', 'rentalUnitId'],
            ['startDate', 'billingFrequency', 'monthlyRate'],
        ]
        const currentFields = fieldGroups[currentStep]
        if (currentFields) {
            await form.validateFields(currentFields)
        }
        setCurrentStep(prev => prev + 1)
    }

    const goBack = () => setCurrentStep(prev => prev - 1)

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const result = await checkInOccupancy({
            variables: {
                data: {
                    dv: 1,
                    sender: getClientSideSenderInfo(),
                    organizationId,
                    tenantId: values.tenantId,
                    propertyId: values.propertyId,
                    rentalUnitId: values.rentalUnitId,
                    startDate: values.startDate?.toISOString(),
                    expectedEndDate: values.expectedEndDate?.toISOString(),
                    billingFrequency: values.billingFrequency,
                    monthlyRate: values.monthlyRate ? String(values.monthlyRate) : undefined,
                },
            },
        })

        const occupancyId = get(result, ['data', 'result', 'occupancy', 'id'])
        const createdCharges = get(result, ['data', 'result', 'rentChargeGeneration', 'createdCount'], 0)

        notification.success({
            message: 'Tenant checked in successfully',
            description: createdCharges
                ? `${createdCharges} rent charges were generated by the existing backend flow`
                : 'No rent charges were auto-generated by the current backend flow',
        })

        if (occupancyId) {
            await router.push(`/occupancy/${occupancyId}`)
        }
    }

    return (
        <PageWrapper>
            <PageHeader
                title='Check In Tenant'
                subTitle='Guided occupancy creation without changing rent or ledger logic'
                extra={[
                    <Link key='all-occupancies' href='/occupancy'>
                        <Button type='secondary'>Back to Occupancies</Button>
                    </Link>,
                ]}
            />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        This wizard only calls the existing `checkInOccupancy` mutation. It does not create payments, ledger entries, or custom billing logic on its own.
                    </Typography.Text>
                    <PageError error={error} />
                    <Steps
                        current={currentStep}
                        items={[
                            { title: 'Tenant' },
                            { title: 'Property & Unit' },
                            { title: 'Occupancy Terms' },
                            { title: 'Review' },
                        ]}
                    />
                    <Form
                        form={form}
                        layout='vertical'
                        initialValues={{
                            billingFrequency: 'monthly',
                            startDate: dayjs(),
                        }}
                        onValuesChange={(changedValues) => {
                            if ('propertyId' in changedValues) {
                                form.setFieldsValue({ rentalUnitId: undefined })
                                setUnitSearch('')
                            }
                            if ('rentalUnitId' in changedValues) {
                                const unit = rentalUnits.find(rentalUnit => rentalUnit.id === changedValues.rentalUnitId)
                                if (unit && get(unit, 'defaultMonthlyRate') && !form.getFieldValue('monthlyRate')) {
                                    form.setFieldsValue({ monthlyRate: Number(get(unit, 'defaultMonthlyRate')) })
                                }
                            }
                        }}
                    >
                        {currentStep === 0 && (
                            <Card title='Step 1. Select tenant'>
                                <Space direction='vertical' size={16} width='100%'>
                                    <Alert
                                        type='info'
                                        showIcon
                                        message='Tenant creation is available as a separate safe admin flow'
                                        description='Create a tenant profile first when the person does not exist yet. The new flow creates a tenant record without creating occupancy, payments, ledger entries, or app login credentials.'
                                    />
                                    {canManageResidents && (
                                        <Link href='/tenant/create?redirectTo=/occupancy/check-in'>
                                            <Button type='secondary'>Create Tenant</Button>
                                        </Link>
                                    )}
                                    <Form.Item label='Search tenant'>
                                        <Input
                                            allowClear
                                            value={tenantSearch}
                                            onChange={event => setTenantSearch(event.target.value)}
                                            placeholder='Search by tenant name, phone, email, or Ghana Card'
                                        />
                                    </Form.Item>
                                    <Form.Item name='tenantId' label='Tenant' rules={[{ required: true, message: 'Select a tenant to continue' }]}>
                                        <Select
                                            showSearch
                                            filterOption={false}
                                            options={tenantOptions}
                                            placeholder='Select existing tenant'
                                            onSearch={setTenantSearch}
                                        />
                                    </Form.Item>
                                    {selectedTenant && (
                                        <Descriptions bordered column={1} size='small'>
                                            <Descriptions.Item label='Tenant'>{getTenantName(selectedTenant)}</Descriptions.Item>
                                            <Descriptions.Item label='Phone'>{get(selectedTenant, ['user', 'phone']) || '—'}</Descriptions.Item>
                                            <Descriptions.Item label='Email'>{get(selectedTenant, ['user', 'email']) || '—'}</Descriptions.Item>
                                            <Descriptions.Item label='Current Occupancy'>
                                                {get(selectedTenant, ['currentOccupancy', 'id'])
                                                    ? renderLink(
                                                        `${get(selectedTenant, ['currentOccupancy', 'status']) || 'active'} • ${getRentalUnitName(intl, get(selectedTenant, ['currentOccupancy', 'rentalUnit']))}`,
                                                        `/occupancy/${get(selectedTenant, ['currentOccupancy', 'id'])}`
                                                    )
                                                    : 'No active occupancy'}
                                            </Descriptions.Item>
                                        </Descriptions>
                                    )}
                                    {get(selectedTenant, ['currentOccupancy', 'id']) && (
                                        <Alert
                                            type='warning'
                                            showIcon
                                            message='This tenant already has an active occupancy'
                                            description='Review the existing occupancy before creating a new check-in so you do not duplicate an active stay.'
                                        />
                                    )}
                                </Space>
                            </Card>
                        )}
                        {currentStep === 1 && (
                            <Card title='Step 2. Choose property and rental unit'>
                                <Space direction='vertical' size={16} width='100%'>
                                    <Form.Item name='propertyId' label='Property' rules={[{ required: true, message: 'Select a property' }]}>
                                        <Select showSearch options={propertyOptions} placeholder='Select property' />
                                    </Form.Item>
                                    {propertyId && (
                                        <>
                                            <Form.Item label='Search rental unit'>
                                                <Input
                                                    allowClear
                                                    value={unitSearch}
                                                    onChange={event => setUnitSearch(event.target.value)}
                                                    placeholder='Search room, bed, apartment, or house'
                                                />
                                            </Form.Item>
                                            <Form.Item name='rentalUnitId' label='Rental Unit' rules={[{ required: true, message: 'Select an available rental unit' }]}>
                                                <Select
                                                    showSearch
                                                    filterOption={false}
                                                    options={propertyRentalUnits}
                                                    placeholder='Select rentable and available unit'
                                                />
                                            </Form.Item>
                                            <Alert
                                                type='info'
                                                showIcon
                                                message='Hostel structures'
                                                description='Parent labels are shown inline so rooms and beds remain intelligible when the property uses a room → bed hierarchy.'
                                            />
                                            {selectedRentalUnit && (
                                                <Descriptions bordered column={1} size='small'>
                                                    <Descriptions.Item label='Rental Unit'>{getRentalUnitName(intl, selectedRentalUnit)}</Descriptions.Item>
                                                    <Descriptions.Item label='Type'>{get(selectedRentalUnit, 'unitType') || '—'}</Descriptions.Item>
                                                    <Descriptions.Item label='Parent'>{get(selectedRentalUnit, ['parent', 'name']) || '—'}</Descriptions.Item>
                                                    <Descriptions.Item label='Rentable'>{get(selectedRentalUnit, 'rentable') ? 'Yes' : 'No'}</Descriptions.Item>
                                                    <Descriptions.Item label='Capacity'>{get(selectedRentalUnit, 'capacity') || '—'}</Descriptions.Item>
                                                    <Descriptions.Item label='Default Monthly Rate'>{formatMoney(intl, get(selectedRentalUnit, 'defaultMonthlyRate'))}</Descriptions.Item>
                                                </Descriptions>
                                            )}
                                        </>
                                    )}
                                </Space>
                            </Card>
                        )}
                        {currentStep === 2 && (
                            <Card title='Step 3. Occupancy terms'>
                                <Space direction='vertical' size={16} width='100%'>
                                    <AntSpace size={16} style={{ display: 'flex' }}>
                                        <Form.Item name='startDate' label='Start Date' rules={[{ required: true, message: 'Select start date' }]} style={{ flex: 1 }}>
                                            <DatePicker style={{ width: '100%' }} />
                                        </Form.Item>
                                        <Form.Item name='expectedEndDate' label='Expected End Date' style={{ flex: 1 }}>
                                            <DatePicker style={{ width: '100%' }} />
                                        </Form.Item>
                                    </AntSpace>
                                    <AntSpace size={16} style={{ display: 'flex' }}>
                                        <Form.Item name='billingFrequency' label='Billing Frequency' rules={[{ required: true, message: 'Select billing frequency' }]} style={{ flex: 1 }}>
                                            <Select options={BILLING_FREQUENCY_OPTIONS} />
                                        </Form.Item>
                                        <Form.Item name='monthlyRate' label='Monthly Rate (GHS)' rules={[{ required: true, message: 'Enter the monthly rate' }]} style={{ flex: 1 }}>
                                            <InputNumber min={0} style={{ width: '100%' }} />
                                        </Form.Item>
                                    </AntSpace>
                                    <Alert
                                        type='info'
                                        showIcon
                                        message='Deposit and notes'
                                        description='Deposit, notes, and custom status fields are not shown here because they are not exposed by the safe existing check-in mutation used in this sprint.'
                                    />
                                </Space>
                            </Card>
                        )}
                        {currentStep === 3 && (
                            <Card title='Step 4. Review and submit'>
                                <Space direction='vertical' size={16} width='100%'>
                                    <Descriptions bordered column={1} size='small'>
                                        <Descriptions.Item label='Tenant'>{getTenantName(selectedTenant)}</Descriptions.Item>
                                        <Descriptions.Item label='Phone'>{get(selectedTenant, ['user', 'phone']) || '—'}</Descriptions.Item>
                                        <Descriptions.Item label='Email'>{get(selectedTenant, ['user', 'email']) || '—'}</Descriptions.Item>
                                        <Descriptions.Item label='Property'>{getPropertyName(selectedProperty)}</Descriptions.Item>
                                        <Descriptions.Item label='Rental Unit'>{getRentalUnitName(intl, selectedRentalUnit)}</Descriptions.Item>
                                        <Descriptions.Item label='Unit Type'>{get(selectedRentalUnit, 'unitType') || '—'}</Descriptions.Item>
                                        <Descriptions.Item label='Start Date'>{formatDate(form.getFieldValue('startDate')?.toISOString?.())}</Descriptions.Item>
                                        <Descriptions.Item label='Expected End'>{formatDate(form.getFieldValue('expectedEndDate')?.toISOString?.())}</Descriptions.Item>
                                        <Descriptions.Item label='Billing Frequency'>{form.getFieldValue('billingFrequency') || '—'}</Descriptions.Item>
                                        <Descriptions.Item label='Monthly Rate'>{formatMoney(intl, form.getFieldValue('monthlyRate'))}</Descriptions.Item>
                                    </Descriptions>
                                    <Alert
                                        type='info'
                                        showIcon
                                        message='What happens after submit'
                                        description='You will be redirected to occupancy detail. If rent charges are not auto-generated by backend logic, the detail page will show the occupancy without inventing any billing records in the UI.'
                                    />
                                </Space>
                            </Card>
                        )}
                    </Form>
                    <AntSpace>
                        {currentStep > 0 && (
                            <Button type='secondary' onClick={goBack}>
                                Previous
                            </Button>
                        )}
                        {currentStep < 3 && (
                            <Button type='primary' onClick={goNext} disabled={!canManageProperties}>
                                Next
                            </Button>
                        )}
                        {currentStep === 3 && (
                            <Button type='primary' onClick={handleSubmit} loading={checkInState.loading} disabled={!canManageProperties}>
                                Check In Tenant
                            </Button>
                        )}
                    </AntSpace>
                    {!canManageProperties && (
                        <Alert
                            type='warning'
                            showIcon
                            message='You do not have permission to manage occupancies'
                        />
                    )}
                    {loading && <Typography.Text type='secondary'>Loading tenant and rental data…</Typography.Text>}
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

OccupancyCheckInWizardPage.requiredAccess = OrganizationRequired

export default OccupancyCheckInWizardPage
