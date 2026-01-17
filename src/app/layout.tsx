import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'goldilex v1.0.0 (goldi)',
  description: 'Patent-protected legal analysis chatbot - hallucination-free',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
