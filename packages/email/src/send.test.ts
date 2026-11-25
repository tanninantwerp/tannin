import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `send` reads its SMTP settings from the environment at module load, so each
 * test stubs the env it wants and re-imports the module fresh. Nodemailer is
 * mocked throughout - these tests are about the wiring around it (configured or
 * not, success or failure mapped into a SendResult), never about actually
 * opening a socket.
 */

const MESSAGE = {
  to: 'guest@example.com',
  subject: 'Your table is confirmed',
  html: '<p>See you then.</p>',
  text: 'See you then.',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('nodemailer');
});

function stubSmtpEnv() {
  vi.stubEnv('SMTP_HOST', 'smtp-relay.example.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_USER', 'user@smtp.example');
  vi.stubEnv('SMTP_PASS', 'secret-key');
  vi.stubEnv('BOOKING_FROM_EMAIL', 'bookings@example.com');
}

describe('send', () => {
  it('reports not-configured when the SMTP env is unset', async () => {
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    vi.stubEnv('BOOKING_FROM_EMAIL', '');
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send(MESSAGE);

    expect(result).toEqual({ sent: false, reason: 'not-configured' });
  });

  it('reports not-configured when the sender is missing but the transport is set', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp-relay.example.com');
    vi.stubEnv('SMTP_USER', 'user@smtp.example');
    vi.stubEnv('SMTP_PASS', 'secret-key');
    vi.stubEnv('BOOKING_FROM_EMAIL', '');
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send(MESSAGE);

    expect(result).toEqual({ sent: false, reason: 'not-configured' });
  });

  it('sends through the SMTP transport once configured', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<abc@smtp>' });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    vi.doMock('nodemailer', () => ({ default: { createTransport } }));
    stubSmtpEnv();
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send({ ...MESSAGE, replyTo: 'venue@example.com' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp-relay.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user@smtp.example', pass: 'secret-key' },
      }),
    );
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: 'Your table is confirmed',
        replyTo: 'venue@example.com',
      }),
    );
    expect(result).toEqual({ sent: true, id: '<abc@smtp>' });
  });

  it('maps a transport failure to a failed result rather than throwing', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('mailbox unavailable'));
    vi.doMock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
    stubSmtpEnv();
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send(MESSAGE);

    expect(result).toEqual({ sent: false, reason: 'failed', detail: 'mailbox unavailable' });
  });
});

describe('the gift voucher email', () => {
  it('attaches the card and says what it is worth, in either language', async () => {
    const { giftVoucherEmail } = await import('./gift');
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const en = giftVoucherEmail({
      to: 'jan@example.com',
      code: 'TN-7KQ4-M9XD',
      amountCents: 5000,
      validUntil: '2027-10-28',
      recipientName: 'Marieke <3',
      pdf,
    });
    expect(en.to).toBe('jan@example.com');
    expect(en.subject).toContain('50');
    expect(en.text).toContain('TN-7KQ4-M9XD');
    expect(en.text).toContain('28/10/2027');
    // A name is the buyer's text: escaped in the HTML, never injected.
    expect(en.html).toContain('Marieke &lt;3');
    expect(en.attachments?.[0]?.filename).toBe('ta-nnin-gift-voucher-TN-7KQ4-M9XD.pdf');

    const nl = giftVoucherEmail({ to: 'jan@example.com', code: 'TN-7KQ4-M9XD', amountCents: 5000, validUntil: '2027-10-28', locale: 'nl', pdf });
    expect(nl.subject).toContain('cadeaubon');
  });

  it('sends through the Brevo HTTP API when BREVO_API_KEY is set', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubEnv('BOOKING_FROM_EMAIL', 'bookings@example.com');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: '<api@brevo>' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send({
      ...MESSAGE,
      attachments: [{ filename: 'v.pdf', content: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }],
    });

    expect(result).toEqual({ sent: true, id: '<api@brevo>' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([{ email: 'guest@example.com' }]);
    expect(body.attachment).toEqual([{ name: 'v.pdf', content: 'AQID' }]);
    vi.unstubAllGlobals();
  });

  it('reports a failed Brevo API call without throwing', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubEnv('BOOKING_FROM_EMAIL', 'bookings@example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
    vi.resetModules();

    const { send } = await import('./send');
    const result = await send(MESSAGE);

    expect(result).toMatchObject({ sent: false, reason: 'failed' });
    vi.unstubAllGlobals();
  });
});
