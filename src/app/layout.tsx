import "./globals.css";

export const metadata = {
  title: "Quorum — group discussions with a fair record",
  description: "Host a live group discussion, transcribe each speaker, and produce an explainable performance report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
