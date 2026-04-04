import { Layout, Menu } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
    DashboardOutlined,
    ApiOutlined,
    FileTextOutlined,
    BarChartOutlined,
    SettingOutlined,
} from '@ant-design/icons'

const { Sider } = Layout

const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: '/routes', icon: <ApiOutlined />, label: 'Routes' },
    { key: '/logs', icon: <FileTextOutlined />, label: 'Logs' },
    { key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics' },
    { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
]

export default function Sidebar() {
    const navigate = useNavigate()
    const location = useLocation()

    return (
        <Sider
            width={220}
            style={{
                borderRight: '1px solid #2A2A45',
            }}
        >
            <div className="flex items-center gap-2 px-6 py-5 border-b border-[#2A2A45]">
                <div className="w-2 h-2 rounded-full bg-[#E94560]" />
                <span
                    style={{ fontFamily: 'monospace' }}
                    className="text-white font-bold tra cking-widest text-sm"
                >
                    GHOSTPROXY
                </span>
            </div>
            <Menu
                mode="inline"
                selectedKeys={[location.pathname]}
                items={items}
                onClick={({ key }) => navigate(key)}
                style={{ border: 'none', marginTop: 8, backgroundColor: 'transparent' }}
            />
        </Sider>
    )
}