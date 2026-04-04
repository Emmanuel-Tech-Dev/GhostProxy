import { Row, Col, Card, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer
} from 'recharts'
import { getOverview, getRequestsOverTime } from '../api/analytics'
import StatCard from '../component/shared/StatCard'
import LogTable from '../component/shared/LogTable'
import { getRecentLogs } from '../api/analytics'

export default function Dashboard() {
    const [interval, setInterval] = useState('all')

    const { data: overview, isLoading: overviewLoading } = useQuery({
        queryKey: ['overview'],
        queryFn: () => getOverview().then((r) => r.data.data),
        refetchInterval: 30000,
    })


    const { data: chart, isLoading: chartLoading } = useQuery({
        queryKey: ['requests-over-time', interval],
        queryFn: () => getRequestsOverTime({ interval }).then((r) => r.data.data),
        refetchInterval: 30000,
    })

    const { data: logs, isLoading: logsLoading } = useQuery({
        queryKey: ['recent-logs-dashboard'],
        queryFn: () => getRecentLogs({ limit: 10 }).then((r) => r.data.data),
        refetchInterval: 15000,
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-white text-xl font-semibold">Dashboard</h1>
                    <p className="text-[#8888AA] text-sm">Last 24 hours</p>
                </div>
            </div>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Total Requests"
                        value={overview?.total_requests?.toLocaleString()}
                        color="#E2E2F0"
                        loading={overviewLoading}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Cache Hit Rate"
                        value={overview?.cache_hit_rate_pct}
                        suffix="%"
                        color="#4ADE80"
                        loading={overviewLoading}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Avg Latency"
                        value={overview?.avg_latency_ms}
                        suffix="ms"
                        color="#60A5FA"
                        loading={overviewLoading}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title="Error Rate"
                        value={overview?.error_rate_pct}
                        suffix="%"
                        color="#F87171"
                        loading={overviewLoading}
                    />
                </Col>
            </Row>

            <Card

                title={
                    <div className="flex items-center justify-between">
                        <span className="text-white text-sm">Request Volume</span>
                        <Select
                            value={interval}
                            onChange={setInterval}
                            size="small"
                            style={{ width: 100 }}
                            options={[
                                { value: 'all', label: 'All Time' },
                                { value: 'minute', label: 'Per minute' },
                                { value: 'hour', label: 'Per hour' },
                                { value: 'day', label: 'Per day' },
                                { value: 'week', label: 'Per week' },
                                { value: 'month', label: 'Per month' },
                            ]}
                        />
                    </div>
                }
                loading={chartLoading}
            >
                <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chart || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#E94560" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#E94560" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="cacheGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4ADE80" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#4ADE80" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2A45" />
                        <XAxis
                            dataKey="bucket"
                            tick={{ fill: '#8888AA', fontSize: 11, fontFamily: 'monospace' }}
                            tickFormatter={(v) => v.slice(11, 16)}
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
                        <Area
                            type="monotone"
                            dataKey="total"
                            stroke="#E94560"
                            fill="url(#totalGrad)"
                            strokeWidth={2}
                            name="Total"
                        />
                        <Area
                            type="monotone"
                            dataKey="cache_hits"
                            stroke="#4ADE80"
                            fill="url(#cacheGrad)"
                            strokeWidth={2}
                            name="Cache Hits"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            <Row gutter={[16, 16]} className='mt-5'>
                <Col xs={24} lg={12}>
                    <Card title={<span className="text-white text-sm">System Health</span>}>
                        <div className="space-y-3">
                            {[
                                {
                                    label: 'LRU Cache Size',
                                    value: `${overview?.lru_cache?.size ?? 0} / ${overview?.lru_cache?.capacity ?? 0}`,
                                    color: '#60A5FA',
                                },
                                {
                                    label: 'Cache Evictions',
                                    value: overview?.lru_cache?.evictions ?? 0,
                                    color: '#FB923C',
                                },
                                {
                                    label: 'Active Rate Limit Buckets',
                                    value: overview?.active_rate_limit_buckets ?? 0,
                                    color: '#A78BFA',
                                },
                                {
                                    label: 'Inflight Requests',
                                    value: overview?.lru_cache?.inflightRequests ?? 0,
                                    color: '#4ADE80',
                                },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="flex items-center justify-between py-2 border-b border-[#2A2A45] last:border-0">
                                    <span className="text-[#8888AA] text-xs uppercase tracking-wider">
                                        {label}
                                    </span>
                                    <span style={{ fontFamily: 'monospace', color, fontSize: 13 }}>
                                        {value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Card>
                </Col>

                <Col xs={24} lg={12}>
                    <Card title={<span className="text-white text-sm">Rate Limited</span>}>
                        <div className="flex flex-col items-center justify-center h-32 gap-2">
                            <span
                                style={{ fontFamily: 'monospace', color: '#F87171', fontSize: 48, fontWeight: 700 }}
                            >
                                {overview?.rate_limited_count ?? 0}
                            </span>
                            <span className="text-[#8888AA] text-xs uppercase tracking-widest">
                                requests blocked in last 24h
                            </span>
                        </div>
                    </Card>
                </Col>
            </Row>

            <Card title={<span className="text-white text-sm">Recent Requests</span>}>
                <LogTable data={logs || []} loading={logsLoading} />
            </Card>
        </div>
    )
}