import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Row, Col, Table, Select, Tag } from 'antd'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import {
    getByRoute, getStatusCodes, getTopClients
} from '../api/analytics'


const PIE_COLORS = ['#4ADE80', '#60A5FA', '#FB923C', '#F87171', '#A78BFA', '#E94560']

export default function Analytics() {
    const [hours, setHours] = useState(24)

    const params = { hours }

    const { data: byRoute, isLoading: routeLoading } = useQuery({
        queryKey: ['by-route', hours],
        queryFn: () => getByRoute(params).then((r) => r.data.data),
        refetchInterval: 30000,
    })

    const { data: statusCodes, isLoading: statusLoading } = useQuery({
        queryKey: ['status-codes', hours],
        queryFn: () => getStatusCodes(params).then((r) => r.data.data),
        refetchInterval: 30000,
    })

    const { data: topClients, isLoading: clientsLoading } = useQuery({
        queryKey: ['top-clients', hours],
        queryFn: () => getTopClients({ ...params, limit: 10 }).then((r) => r.data.data),
        refetchInterval: 30000,
    })

    const routeColumns = [
        {
            title: 'Route',
            dataIndex: 'route_prefix',
            key: 'route_prefix',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#60A5FA' }}>{v}</span>
            ),
        },
        {
            title: 'Requests',
            dataIndex: 'total_requests',
            key: 'total_requests',
            render: (v) => (
                <span style={{ fontFamily: 'monospace' }}>{v?.toLocaleString()}</span>
            ),
        },
        {
            title: 'Cache Hit',
            dataIndex: 'cache_hit_rate_pct',
            key: 'cache_hit_rate_pct',
            render: (v) => (
                <Tag color={v > 50 ? 'green' : v > 20 ? 'orange' : 'red'}>
                    {v}%
                </Tag>
            ),
        },
        {
            title: 'Avg Latency',
            dataIndex: 'avg_latency_ms',
            key: 'avg_latency_ms',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', color: v > 500 ? '#F87171' : '#4ADE80' }}>
                    {v}ms
                </span>
            ),
        },
        {
            title: 'Error Rate',
            dataIndex: 'error_rate_pct',
            key: 'error_rate_pct',
            render: (v) => (
                <Tag color={v > 5 ? 'red' : v > 1 ? 'orange' : 'green'}>
                    {v}%
                </Tag>
            ),
        },
    ]

    const clientColumns = [
        {
            title: 'IP',
            dataIndex: 'client_ip',
            key: 'client_ip',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
            ),
        },
        {
            title: 'Requests',
            dataIndex: 'total_requests',
            key: 'total_requests',
            render: (v) => (
                <span style={{ fontFamily: 'monospace' }}>{v?.toLocaleString()}</span>
            ),
        },
        {
            title: 'Rate Limited',
            dataIndex: 'times_rate_limited',
            key: 'times_rate_limited',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', color: v > 0 ? '#F87171' : '#8888AA' }}>
                    {v}
                </span>
            ),
        },
        {
            title: 'Avg Latency',
            dataIndex: 'avg_latency_ms',
            key: 'avg_latency_ms',
            render: (v) => (
                <span style={{ fontFamily: 'monospace' }}>{v}ms</span>
            ),
        },
        {
            title: 'Last Seen',
            dataIndex: 'last_seen',
            key: 'last_seen',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8888AA' }}>
                    {new Date(v).toLocaleTimeString()}
                </span>
            ),
        },
    ]

    const timeOptions = [
        { value: 1, label: 'Last 1h' },
        { value: 6, label: 'Last 6h' },
        { value: 24, label: 'Last 24h' },
        { value: 168, label: 'Last 7d' },
    ]

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-white text-xl font-semibold">Analytics</h1>
                    <p className="text-[#8888AA] text-sm">Deep dive into your traffic</p>
                </div>
                <Select
                    value={hours}
                    onChange={setHours}
                    options={timeOptions}
                    style={{ width: 120 }}
                />
            </div>

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                    <Card
                        title={<span className="text-white text-sm">Requests by Route</span>}
                        loading={routeLoading}
                    >
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart
                                data={byRoute || []}
                                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A45" />
                                <XAxis
                                    dataKey="route_prefix"
                                    tick={{ fill: '#8888AA', fontSize: 11, fontFamily: 'monospace' }}
                                />
                                <YAxis tick={{ fill: '#8888AA', fontSize: 11 }} />
                                <Tooltip
                                    contentStyle={{
                                        background: '#1E1E35',
                                        border: '1px solid #2A2A45',
                                        borderRadius: 6,
                                        fontSize: 12,
                                    }}
                                />
                                <Bar dataKey="total_requests" fill="#E94560" radius={[4, 4, 0, 0]} name="Requests" />
                                <Bar dataKey="cache_hits" fill="#4ADE80" radius={[4, 4, 0, 0]} name="Cache Hits" />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>

                <Col xs={24} lg={10}>
                    <Card
                        title={<span className="text-white text-sm">Status Code Distribution</span>}
                        loading={statusLoading}
                    >
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie
                                    data={statusCodes || []}
                                    dataKey="count"
                                    nameKey="status_code"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={({ status_code, percentage }) => `${status_code} (${percentage}%)`}
                                    labelLine={{ stroke: '#8888AA' }}
                                >
                                    {(statusCodes || []).map((_, i) => (
                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: '#1E1E35',
                                        border: '1px solid #2A2A45',
                                        borderRadius: 6,
                                        fontSize: 12,
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>
            </Row>

            <Card
                title={<span className="text-white text-sm">Per Route Breakdown</span>}
                loading={routeLoading}
            >
                <Table
                    columns={routeColumns}
                    dataSource={byRoute || []}
                    rowKey="route_prefix"
                    size="small"
                    pagination={false}
                />
            </Card>

            <Card
                title={<span className="text-white text-sm">Top Clients</span>}
                loading={clientsLoading}
            >
                <Table
                    columns={clientColumns}
                    dataSource={topClients || []}
                    rowKey="client_ip"
                    size="small"
                    pagination={false}
                />
            </Card>
        </div>
    )
}