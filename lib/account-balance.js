/**
 * Account-balance source for the DeepSeek Harness account provider.
 *
 * The shipped balance route reads `GET /user/balance` with the
 * `DEEPSEEK_API_KEY` credential. A harness signed in through the DeepSeek
 * account provider has no such key, but the host already knows how to read the
 * same recharge wallet from the Platform: `ctx.deepseekAccount.getBalance()`
 * (the call behind Settings → Account). This module turns that sanitized
 * reading into the row shape the browser half renders, and degrades to
 * `undefined` on every path where the account is absent, signed out, or the
 * query failed — the caller then falls back to the API-key route.
 *
 * @module dsh-plugin-balance/account-balance
 */

/** Client identity headers are telemetry; the host has no browser build version. */
const DEFAULT_CLIENT = { version: 'unknown', locale: 'en', timezoneOffsetSeconds: 0 }

/**
 * Build the client identity a Platform balance read expects.
 *
 * The Platform's client headers are optional (the balance query answers
 * without them), so a plugin host supplies what it can: the surface language
 * and the browser's UTC offset, both carried by the caller's request URL.
 *
 * @param url - the incoming plugin route URL.
 * @returns client metadata in the shape `deepseekAccount.getBalance` takes.
 */
export function accountClientFor(url) {
  let locale = DEFAULT_CLIENT.locale
  let timezoneOffsetSeconds = -new Date().getTimezoneOffset() * 60
  if (url !== undefined) {
    const requested = url.searchParams.get('locale')
    if (typeof requested === 'string' && requested !== '') locale = requested
    const rawOffset = url.searchParams.get('tz')
    const offset = rawOffset === null || rawOffset === '' ? Number.NaN : Number(rawOffset)
    if (Number.isFinite(offset)) timezoneOffsetSeconds = offset
  }
  return { ...DEFAULT_CLIENT, locale, timezoneOffsetSeconds }
}

/**
 * Normalize one `deepseekAccount.getBalance()` reading into balance rows.
 *
 * The Platform reports the recharge wallet in `value` and granted credit in
 * `bonusWallets`; available credit is their sum per currency, which is what the
 * pill shows. Both arrays keep decimal strings, so they are parsed here and
 * rendered as numbers by the browser.
 *
 * @param result - a ready balance outcome from the account provider.
 * @returns normalized availability flag and balance rows.
 */
export function normalizeAccountBalance(result) {
  const rows = new Map()
  const add = (wallets, bucket) => {
    if (!Array.isArray(wallets)) return
    for (const wallet of wallets) {
      if (wallet === null || typeof wallet !== 'object' || typeof wallet.currency !== 'string') continue
      const amount = Number(wallet.balance)
      const value = Number.isFinite(amount) ? amount : 0
      const row = rows.get(wallet.currency) ?? {
        currency: wallet.currency,
        totalBalance: 0,
        grantedBalance: 0,
        toppedUpBalance: 0,
      }
      row[bucket] += value
      row.totalBalance += value
      rows.set(wallet.currency, row)
    }
  }
  add(result?.value, 'toppedUpBalance')
  add(result?.bonusWallets, 'grantedBalance')
  const balances = [...rows.values()].map((row) => ({
    currency: row.currency,
    totalBalance: row.totalBalance,
    grantedBalance: row.grantedBalance,
    toppedUpBalance: row.toppedUpBalance,
    totalBalanceText: row.totalBalance.toFixed(2),
    grantedBalanceText: row.grantedBalance.toFixed(2),
    toppedUpBalanceText: row.toppedUpBalance.toFixed(2),
  }))
  return {
    isAvailable: balances.some((row) => row.totalBalance > 0),
    balances,
  }
}

/**
 * Read the signed-in account's balance through the account provider.
 *
 * @param ctx - host plugin context.
 * @param client - client identity metadata for the Platform request.
 * @returns normalized rows, or undefined when the account path cannot answer.
 */
export async function readAccountBalance(ctx, client) {
  const account = ctx.get('deepseekAccount')
  if (account === undefined || account === null || typeof account.getBalance !== 'function') return undefined
  let result
  try {
    result = await account.getBalance(client)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-plugin-balance: account balance read failed: ${error?.message ?? error}`)
    return undefined
  }
  if (result === null || result === undefined || result.status !== 'ready') return undefined
  return normalizeAccountBalance(result)
}
