import type { Profile } from '../config/profiles.ts'

interface DeliveryResult {
  channel: 'stdout' | 'whatsapp'
  ok: boolean
  error?: string
}

export async function deliverIntentViaWhatsApp(
  profile: Profile,
  body: {
    action: string
    params: unknown
    token: string
    expiresAt: number
  },
): Promise<DeliveryResult> {
  const phone = profile.delivery?.whatsapp_phone
  const kapsoToken = process.env.V0_CLI_KAPSO_TOKEN
  if (!phone || !kapsoToken) {
    return {
      channel: 'whatsapp',
      ok: false,
      error: 'V0_CLI_KAPSO_TOKEN or profile.delivery.whatsapp_phone missing',
    }
  }
  const expires = new Date(body.expiresAt).toISOString()
  const text = [
    '*v0-cli intent*',
    `action: \`${body.action}\``,
    `expires: ${expires}`,
    '',
    `token: \`${body.token}\``,
  ].join('\n')
  try {
    const res = await fetch('https://api.kapso.com/v1/whatsapp/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${kapsoToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    })
    if (!res.ok) {
      return {
        channel: 'whatsapp',
        ok: false,
        error: `Kapso HTTP ${res.status}: ${await res.text()}`,
      }
    }
    return { channel: 'whatsapp', ok: true }
  } catch (err) {
    return { channel: 'whatsapp', ok: false, error: (err as Error).message }
  }
}
