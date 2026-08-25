const TOKEN_KEY = 'origo-token'

/** Ancien JWT en localStorage : on l’efface, on ne le relit plus (cookie httpOnly). */
export function getToken() {
  return null
}

export function setToken(_token) {
  localStorage.removeItem(TOKEN_KEY)
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
 * Client HTTP vers l’API ORIGO.
 * Session = cookie httpOnly (credentials: include). Pas de JWT dans JS.
 */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, {
    method,
    headers,
    credentials: 'include',
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
