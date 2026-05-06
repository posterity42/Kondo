const { SERIALIZERS } = require('./serializers')

describe('serializers', () => {
    it('redacts sensitive headers and cookies in request logs', () => {
        const req = {
            method: 'GET',
            url: '/api/test',
            headers: {
                authorization: 'Bearer token',
                Authorization: 'Token another',
                cookie: 'keystone.sid=abc123; other=ok',
                'proxy-authorization': 'Proxy token',
                'x-api-key': 'key',
                'x-auth-token': 'auth-token',
                'x-custom-header': 'keep',
            },
        }

        const result = SERIALIZERS.req(req)

        expect(result.headers.authorization).toBe('***')
        expect(result.headers.Authorization).toBe('***')
        expect(result.headers['proxy-authorization']).toBe('***')
        expect(result.headers['x-api-key']).toBe('***')
        expect(result.headers['x-auth-token']).toBe('***')
        expect(result.headers['x-custom-header']).toBe('keep')
        expect(result.headers.cookie).toContain('keystone.sid=***')
        expect(result.headers.cookie).toContain('other=***')
    })

    it('redacts set-cookie values in response logs while keeping attributes', () => {
        const headers = {
            'set-cookie': ['keystone.sid=abc123; Path=/; HttpOnly'],
            'x-custom-header': 'keep',
        }

        const res = {
            statusCode: 200,
            getHeader: (name) => headers[name],
            getHeaders: () => ({ ...headers }),
        }

        const result = SERIALIZERS.res(res)

        expect(result.headers['set-cookie']).toEqual(['keystone.sid=***; Path=/; HttpOnly'])
        expect(result.headers['x-custom-header']).toBe('keep')
    })

    it('redacts standalone headers serializer values and preserves non-sensitive headers', () => {
        const result = SERIALIZERS.headers({
            cookie: 'session=sensitive; theme=dark',
            authorization: 'Bearer top-secret',
            'x-custom-header': 'keep',
        })

        expect(result).toBe(JSON.stringify({
            cookie: 'session=***; theme=***',
            authorization: '***',
            'x-custom-header': 'keep',
        }))
    })

    it('redacts bearer token patterns in log strings', () => {
        expect(SERIALIZERS.msg('Authorization: Bearer very-secret-token')).toBe('Authorization: Bearer ***')
    })
})
