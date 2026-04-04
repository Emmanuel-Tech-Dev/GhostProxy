import { Layout, Dropdown, Avatar, Tag, Button, Tooltip } from 'antd'
import {
    UserOutlined, LogoutOutlined,
    SunOutlined, MoonOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import { logout } from '../../api/auth'

const { Header: AntHeader } = Layout

export default function Header() {
    const navigate = useNavigate()
    const user = useAuthStore((s) => s.user)
    const clearAuth = useAuthStore((s) => s.clearAuth)
    const theme = useAuthStore((s) => s.theme)
    const toggleTheme = useAuthStore((s) => s.toggleTheme)

    const handleLogout = async () => {
        try { await logout() } catch { }
        clearAuth()
        navigate('/login')
    }

    const items = [
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: 'Logout',
            danger: true,
            onClick: handleLogout,
        },
    ]

    return (
        <AntHeader
            style={{ borderBottom: '1px solid #2A2A45', padding: '0 24px' }}
            className="flex items-center justify-between"
        >
            <div />
            <div className="flex items-center gap-3">
                {/* <Tooltip title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                    <Button
                        type="text"
                        size="small"
                        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                        onClick={toggleTheme}
                    />
                </Tooltip> */}

                <Tag
                    style={{ fontFamily: 'monospace' }}
                    color="volcano"
                >
                    {user?.plan_tier}
                </Tag>

                <Dropdown menu={{ items }} placement="bottomRight">
                    <div className="flex items-center gap-2 cursor-pointer">
                        <Avatar
                            size="small"
                            icon={<UserOutlined />}
                            style={{ backgroundColor: '#E94560' }}
                        />
                        <span className="text-sm text-[#8888AA]">
                            {user?.email}
                        </span>
                    </div>
                </Dropdown>
            </div>
        </AntHeader>
    )
}