import { Outlet } from 'react-router-dom'
import { Layout } from 'antd'
import Sidebar from './Sidebar'
import Header from './Header'

const { Content } = Layout

export default function AppLayout() {
    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sidebar />
            <Layout>
                <Header />
                <Content className="p-6 overflow-auto">
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    )
}