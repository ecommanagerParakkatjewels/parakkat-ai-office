// The database provider's public CA certificate (PEM). Public, not a secret.
// Empty until the Supabase CA is added: remote connections then verify
// against Node's default roots and will fail rather than connect unverified.
export const BUNDLED_CA = "";
