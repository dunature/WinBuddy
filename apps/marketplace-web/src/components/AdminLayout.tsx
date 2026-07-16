import { Boxes, ClipboardCheck, History, LayoutDashboard, Tags, UploadCloud } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/admin', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/admin/skills', label: 'Skills', icon: Boxes },
  { to: '/admin/uploads', label: '上传中心', icon: UploadCloud },
  { to: '/admin/reviews', label: '审核队列', icon: ClipboardCheck },
  { to: '/admin/categories', label: '分类管理', icon: Tags },
  { to: '/admin/audit', label: '审计日志', icon: History },
]

export function AdminLayout(): React.ReactElement {
  return <div className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand-mark"><span>✣</span><strong>Proma</strong><small>Marketplace Admin</small></div><nav>{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link-active' : ''}`}><Icon size={17} />{label}</NavLink>)}</nav><div className="admin-sidebar-user"><span>PE</span><div><strong>Proma 编辑部</strong><small>Editor</small></div></div></aside><section className="admin-workspace"><Outlet /></section></div>
}
