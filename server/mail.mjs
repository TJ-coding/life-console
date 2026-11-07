// Outgoing email (password resets). Off unless SMTP_URL is set, e.g. smtps://user:pass@smtp.example.com:465
import nodemailer from 'nodemailer'

export function createMailer(cfg, log = console.log) {
  if (!cfg.smtpUrl) return null
  const t = nodemailer.createTransport(cfg.smtpUrl)
  return {
    async send({ to, subject, text }) {
      await t.sendMail({ from: cfg.mailFrom, to, subject, text })
      log(`[mail] sent "${subject}" to ${to.replace(/^(.).*@/, '$1…@')}`)
    },
  }
}
