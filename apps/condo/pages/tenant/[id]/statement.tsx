import get from 'lodash/get'
import { useRouter } from 'next/router'

import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { StatementPage } from '@condo/domains/property/components/RentalAdmin/StatementPage'

const TenantStatementRoute: PageComponentType = () => {
    const { query } = useRouter()
    const tenantId = get(query, 'id')

    if (!tenantId || Array.isArray(tenantId)) return null

    return (
        <StatementPage
            title='Tenant Statement'
            subTitle='Ledger-first tenant statement'
            tenantId={tenantId}
            extraLinks={[
                renderLink('Back to tenant', `/tenant/${tenantId}`),
            ]}
        />
    )
}

TenantStatementRoute.requiredAccess = OrganizationRequired

export default TenantStatementRoute
