import './globals.css';
export const metadata = { title: 'incheck — AI Agent Security', description: 'Document security, agent sandbox and attack playground' };
export default function RootLayout({ children }) {
  return (<html lang="en"><body className="min-h-screen font-sans">{children}</body></html>);
}
