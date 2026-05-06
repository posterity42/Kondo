const { normalizeVariables } = require('./normalize')

describe('normalizeVariables', () => {
    it('redacts sensitive keys recursively', () => {
        const input = {
            password: 'secret',
            profile: {
                phone: '+123',
                token: 'keep',
            },
            nested: {
                secrets: {
                    secret: 'hidden',
                },
            },
            list: [
                { phoneNumber: '100' },
                { value: 'ok' },
            ],
        }

        const result = JSON.parse(normalizeVariables(input))

        expect(result.password).toBe('***')
        expect(result.profile.phone).toBe('***')
        expect(result.profile.token).toBe('***')
        expect(result.nested.secrets).toBe('***')
        expect(result.list[0].phoneNumber).toBe('***')
        expect(result.list[1].value).toBe('ok')
    })

    it('keeps groupedReceipts visible by code override', () => {
        const input = {
            groupedReceipts: 'visible',
            nested: {
                groupedReceipts: {
                    id: 'receipt-id',
                },
                receipt: 'hidden',
            },
        }

        const result = JSON.parse(normalizeVariables(input))

        expect(result.groupedReceipts).toBe('visible')
        expect(result.nested.groupedReceipts.id).toBe('receipt-id')
        expect(result.nested.receipt).toBe('***')
    })

    it('still redacts non-overridden sensitive keys', () => {
        const input = {
            token: 'hidden',
            secret: 'hidden',
            receiptToken: 'hidden',
        }

        const result = JSON.parse(normalizeVariables(input))

        expect(result.token).toBe('***')
        expect(result.secret).toBe('***')
        expect(result.receiptToken).toBe('***')
    })

    it('redacts sensitive headers and bearer tokens in nested log payloads', () => {
        const input = {
            headers: {
                authorization: 'Bearer abc123',
                cookie: 'keystone.sid=session-id; theme=dark',
                'x-api-key': 'key',
                'x-custom-header': 'keep',
            },
            message: 'retry with Bearer nested-token',
        }

        const result = JSON.parse(normalizeVariables(input))

        expect(result.headers.authorization).toBe('***')
        expect(result.headers.cookie).toBe('keystone.sid=***; theme=***')
        expect(result.headers['x-api-key']).toBe('***')
        expect(result.headers['x-custom-header']).toBe('keep')
        expect(result.message).toBe('retry with Bearer ***')
    })
})
