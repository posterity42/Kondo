import { useQuery } from '@apollo/client'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'

import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { StatementPage } from '@condo/domains/property/components/RentalAdmin/StatementPage'

const GET_OCCUPANCY_TENANT = gql`
    query getOccupancyStatementRoute ($id: ID!) {
        occupancy: Occupancy(where: { id: $id }) {
            id
            tenant { id }
            property { id }
        }
    }
`

const OccupancyStatementRoute: PageComponentType = () => {
    const { query } = useRouter()
    const occupancyId = get(query, 'id')
    const { data, loading, error } = useQuery(GET_OCCUPANCY_TENANT, {
        variables: { id: occupancyId },
        skip: !occupancyId || Array.isArray(occupancyId),
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Tenancy Statement' loading={loading} error={error?.message} />
    }

    const occupancy = get(data, 'occupancy')
    const tenantId = get(occupancy, ['tenant', 'id'])

    if (!occupancy || !tenantId || Array.isArray(occupancyId)) {
        return <LoadingOrErrorPage title='Tenancy Statement' loading={false} error='Tenancy not found' />
    }

    return (
        <StatementPage
            title='Tenancy Statement'
            subTitle='Ledger-first occupancy statement'
            tenantId={tenantId}
            occupancyId={occupancyId}
            propertyId={get(occupancy, ['property', 'id'])}
            extraLinks={[
                renderLink('Back to tenancy', `/tenancy/${occupancyId}`),
                renderLink('View tenant', `/tenant/${tenantId}`),
            ]}
        />
    )
}

OccupancyStatementRoute.requiredAccess = OrganizationRequired

export default OccupancyStatementRoute
