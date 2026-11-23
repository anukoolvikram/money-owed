// pg currently treats sslmode=prefer/require/verify-ca as verify-full (certificate and
// hostname checked) and warns that a future major version will weaken them to libpq
// semantics. Pin the strict behaviour explicitly so the warning goes away and an
// upgrade can never silently downgrade TLS verification.
export function strictSslUrl(url: string): string {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i, "$1verify-full");
}
