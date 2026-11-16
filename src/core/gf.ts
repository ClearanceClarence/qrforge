// GF(2^8) arithmetic and Reed-Solomon coding over the QR polynomial 0x11D.

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]
}

function gfDiv(a: number, b: number): number {
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]
}

const divisorCache = new Map<number, Uint8Array>()

/** Generator polynomial of the given degree, highest coefficient (always 1) omitted. */
export function rsDivisor(degree: number): Uint8Array {
  let d = divisorCache.get(degree)
  if (d) return d
  d = new Uint8Array(degree)
  d[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      d[j] = gfMul(d[j], root)
      if (j + 1 < degree) d[j] ^= d[j + 1]
    }
    root = gfMul(root, 2)
  }
  divisorCache.set(degree, d)
  return d
}

/** Error correction codewords for a data block. */
export function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const n = divisor.length
  const out = new Uint8Array(n)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ out[0]
    out.copyWithin(0, 1)
    out[n - 1] = 0
    if (factor !== 0) for (let j = 0; j < n; j++) out[j] ^= gfMul(divisor[j], factor)
  }
  return out
}

/**
 * Corrects a codeword block in place (data followed by `nsym` ECC bytes).
 * Returns the number of corrected byte errors, or -1 if uncorrectable.
 */
export function rsCorrect(block: Uint8Array, nsym: number): number {
  const n = block.length
  const synd = new Uint8Array(nsym)
  let clean = true
  for (let i = 0; i < nsym; i++) {
    const x = EXP[i]
    let v = 0
    for (let j = 0; j < n; j++) v = gfMul(v, x) ^ block[j]
    synd[i] = v
    if (v !== 0) clean = false
  }
  if (clean) return 0

  // Berlekamp-Massey. Polynomials are stored lowest degree first.
  let sigma = new Uint8Array(nsym + 1)
  let prev = new Uint8Array(nsym + 1)
  sigma[0] = 1
  prev[0] = 1
  let L = 0
  let m = 1
  let b = 1
  for (let k = 0; k < nsym; k++) {
    let d = synd[k]
    for (let i = 1; i <= L; i++) d ^= gfMul(sigma[i], synd[k - i])
    if (d === 0) {
      m++
      continue
    }
    const coef = gfDiv(d, b)
    const next = sigma.slice()
    for (let i = 0; i + m <= nsym; i++) next[i + m] ^= gfMul(coef, prev[i])
    if (2 * L <= k) {
      prev = sigma
      L = k + 1 - L
      b = d
      m = 1
    } else {
      m++
    }
    sigma = next
  }
  if (L * 2 > nsym) return -1

  // Chien search: position p (power of x, counted from the last byte) is in error
  // when sigma(alpha^-p) == 0.
  const positions: number[] = []
  for (let p = 0; p < n; p++) {
    const xinv = EXP[(255 - (p % 255)) % 255]
    let v = 0
    for (let i = L; i >= 0; i--) v = gfMul(v, xinv) ^ sigma[i]
    if (v === 0) positions.push(p)
  }
  if (positions.length !== L) return -1

  // Forney: omega = (S * sigma) mod x^nsym; e = X * omega(X^-1) / sigma'(X^-1).
  const omega = new Uint8Array(nsym)
  for (let i = 0; i < nsym; i++) {
    let v = 0
    for (let j = 0; j <= i && j <= L; j++) v ^= gfMul(sigma[j], synd[i - j])
    omega[i] = v
  }
  for (const p of positions) {
    const X = EXP[p % 255]
    const xinv = EXP[(255 - (p % 255)) % 255]
    let num = 0
    for (let i = nsym - 1; i >= 0; i--) num = gfMul(num, xinv) ^ omega[i]
    let den = 0
    for (let i = (L & 1) === 1 ? L : L - 1; i >= 1; i -= 2) den = gfMul(gfMul(den, xinv), xinv) ^ sigma[i]
    if (den === 0) return -1
    block[n - 1 - p] ^= gfMul(X, gfDiv(num, den))
  }
  return L
}
