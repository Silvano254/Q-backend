export interface AuthClaims {
  id: string
  email: string
  role: string
}

export function ownerId(auth: AuthClaims): string {
  return auth.id
}

export function scopeQuery(query: any, auth: AuthClaims) {
  return query.eq('owner_id', ownerId(auth))
}
