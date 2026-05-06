const _toString = require('lodash/toString')

const REDACTED_VALUE = '***'
const SENSITIVE_HEADERS_REGEX = /^(authorization|proxy-authorization|x-api-key|x-auth-token)$/i
const SENSITIVE_COOKIE_HEADERS_REGEX = /^(cookie|set-cookie)$/i
const BEARER_TOKEN_REGEX = /\bBearer\s+([A-Za-z0-9\-._~+/]+=*)/gi

function toString (value) {
    if (value === null || value === undefined) return value
    if (typeof value === 'object') return JSON.stringify(value)
    return _toString(value)
}

function redactBearerTokensInString (value) {
    if (typeof value !== 'string') return value
    return value.replace(BEARER_TOKEN_REGEX, `Bearer ${REDACTED_VALUE}`)
}

function sanitizeCookieHeaderValue (cookieValue) {
    if (!cookieValue) return cookieValue
    if (Array.isArray(cookieValue)) {
        return cookieValue.map(sanitizeCookieHeaderValue)
    }

    return toString(cookieValue)
        .split(';')
        .map((part, index) => {
            const normalizedPart = part.trim()
            const [name, ...rest] = part.split('=')
            const normalizedName = name?.trim()
            if (!normalizedName || rest.length === 0) return normalizedPart

            if (index === 0) {
                return `${normalizedName}=${REDACTED_VALUE}`
            }

            const normalizedAttribute = normalizedName.toLowerCase()
            const isCookieAttribute = [
                'path',
                'domain',
                'expires',
                'max-age',
                'samesite',
                'priority',
                'partitioned',
            ].includes(normalizedAttribute)

            if (isCookieAttribute) {
                return `${normalizedName}=${rest.join('=')}`
            }

            return `${normalizedName}=${REDACTED_VALUE}`
        })
        .join('; ')
}

function sanitizeHeaderValue (headerName, headerValue) {
    if (headerValue === null || headerValue === undefined) return headerValue
    if (Array.isArray(headerValue)) {
        return headerValue.map((value) => sanitizeHeaderValue(headerName, value))
    }

    if (SENSITIVE_HEADERS_REGEX.test(headerName)) {
        return REDACTED_VALUE
    }

    if (SENSITIVE_COOKIE_HEADERS_REGEX.test(headerName)) {
        return sanitizeCookieHeaderValue(headerValue)
    }

    return redactBearerTokensInString(headerValue)
}

function sanitizeHeaders (headers) {
    if (!headers || typeof headers !== 'object') return headers

    return Object.entries(headers).reduce((acc, [headerName, headerValue]) => {
        acc[headerName] = sanitizeHeaderValue(headerName, headerValue)
        return acc
    }, {})
}

function sanitizeLogValue (value, key) {
    if (value === null || value === undefined) return value

    if (typeof key === 'string' && (SENSITIVE_HEADERS_REGEX.test(key) || SENSITIVE_COOKIE_HEADERS_REGEX.test(key))) {
        return sanitizeHeaderValue(key, value)
    }

    if (typeof value === 'string') {
        return redactBearerTokensInString(value)
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeLogValue(entry, key))
    }

    if (typeof value === 'object') {
        if (typeof key === 'string' && key.toLowerCase() === 'headers') {
            return sanitizeHeaders(value)
        }

        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = sanitizeLogValue(entryValue, entryKey)
            return acc
        }, {})
    }

    return value
}

module.exports = {
    REDACTED_VALUE,
    redactBearerTokensInString,
    sanitizeCookieHeaderValue,
    sanitizeHeaderValue,
    sanitizeHeaders,
    sanitizeLogValue,
}
