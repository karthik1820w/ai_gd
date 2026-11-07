import nodemailer from "nodemailer";

export async function sendMail(to: string, subject: string, text: string) {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[email not sent — SMTP_HOST is empty]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    }
    return { sent: false as const };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "Quorum <noreply@localhost>",
    to,
    subject,
    text,
  });
  return { sent: true as const };
}
