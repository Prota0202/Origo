const TOKEN_KEY = 'origo-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('origo-session')
}

async function parseBody(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Client HTTP vers l'API ORIGO.
 * Base URL : VITE_API_URL ou proxy Vite `/api`.
 */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const data = await parseBody(res)
  if (!res.ok) {
    const message = data?.message || `Erreur ${res.status}`
    const err = new Error(message)
    err.status = res.status
    err.code = data?.error
    err.details = data?.details
    throw err
  }
  return data
}
