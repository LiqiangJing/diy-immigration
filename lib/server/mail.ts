import nodemailer from "nodemailer";

/** 通过 SMTP 发邮件。没配置 SMTP_HOST 时 mailConfigured() 为 false，调用方自行决定怎么降级。 */

export const mailConfigured = () => Boolean(process.env.SMTP_HOST);

export async function sendMail(opts: { to: string; subject: string; text: string; replyTo?: string }) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...opts });
}
