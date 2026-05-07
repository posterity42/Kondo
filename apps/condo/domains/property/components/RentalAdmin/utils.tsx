import { Alert, Tag } from 'antd'
import dayjs from 'dayjs'
import get from 'lodash/get'
import React from 'react'

import { Typography } from '@open-condo/ui'

import { getRentalUnitDisplayName } from '@condo/domains/resident/utils/clientSchema/rental'

import type { IntlShape } from 'react-intl'

export const DEFAULT_PAGE_SIZE = 100
export const DEFAULT_CURRENCY = 'GHS'

export function formatDate (value?: string | null): string {
    if (!value) return '—'

    return dayjs(value).format('YYYY-MM-DD')
}

export function formatDateTime (value?: string | null): string {
    if (!value) return '—'

    return dayjs(value).format('YYYY-MM-DD HH:mm')
}

export function formatMoney (intl: IntlShape, amount?: string | number | null, currencyCode: string = DEFAULT_CURRENCY): string {
    if (amount === null || amount === undefined || amount === '') return '—'

    const value = Number(amount)
    if (Number.isNaN(value)) return String(amount)

    return intl.formatNumber(value, {
        style: 'currency',
        currency: currencyCode || DEFAULT_CURRENCY,
    })
}

export function getTenantName (tenant?: Record<string, unknown> | null): string {
    return String(
        get(tenant, ['user', 'name'])
        || get(tenant, ['user', 'phone'])
        || get(tenant, 'ghanaCardNumber')
        || get(tenant, 'id')
        || '—'
    )
}

export function getPropertyName (property?: Record<string, unknown> | null): string {
    return String(
        get(property, 'address')
        || get(property, 'addressKey')
        || get(property, 'id')
        || '—'
    )
}

export function getRentalUnitName (intl: IntlShape, rentalUnit?: Record<string, unknown> | null, fallback?: Record<string, unknown> | null): string {
    const value = getRentalUnitDisplayName(intl, rentalUnit, fallback)

    return String(value || get(rentalUnit, 'name') || get(rentalUnit, 'id') || '—')
}

export function normalizeSearchValue (value?: string | number | null): string {
    return String(value || '').trim().toLowerCase()
}

export function matchesSearch (search: string, values: Array<string | number | null | undefined>): boolean {
    const normalizedSearch = normalizeSearchValue(search)
    if (!normalizedSearch) return true

    return values.some(value => normalizeSearchValue(value).includes(normalizedSearch))
}

export function isDateInRange (value?: string | null, start?: dayjs.Dayjs | null, end?: dayjs.Dayjs | null): boolean {
    if (!start && !end) return true
    if (!value) return false

    const current = dayjs(value)
    if (!current.isValid()) return false

    if (start && current.isBefore(start.startOf('day'))) return false
    if (end && current.isAfter(end.endOf('day'))) return false

    return true
}

export function formatEnumLabel (value?: string | null): string {
    if (!value) return '—'

    return value.replace(/_/g, ' ')
}

const STATUS_COLORS = {
    planned: 'gold',
    active: 'green',
    ended: 'default',
    canceled: 'red',
    draft: 'default',
    invoiced: 'processing',
    partially_paid: 'gold',
    paid: 'green',
    CREATED: 'default',
    PROCESSING: 'processing',
    DONE: 'green',
    ERROR: 'red',
    WITHDRAWN: 'orange',
    REVERSED: 'volcano',
    open: 'green',
    archived: 'default',
} as const

export const StatusTag: React.FC<{ status?: string | null }> = ({ status }) => {
    if (!status) return <Typography.Text>—</Typography.Text>

    return <Tag color={STATUS_COLORS[status] || 'default'}>{status.replace(/_/g, ' ')}</Tag>
}

export const PageError: React.FC<{ error?: Error | null }> = ({ error }) => {
    if (!error) return null

    return (
        <Alert
            showIcon
            type='error'
            message='Unable to load this screen'
            description={error.message}
        />
    )
}
