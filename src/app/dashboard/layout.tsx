import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import Topbar from '@/components/layout/Topbar';
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d1117]">
      <Sidebar/>
      <div className="md:ml-60 flex flex-col min-h-screen">
        <Topbar/>
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</main>
      </div>
      <MobileNav/>
    </div>
  );
}
